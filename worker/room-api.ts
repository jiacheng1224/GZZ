import {
  createAuthoritativeRoom,
  createReconnectSnapshot,
  disconnectRoomPlayer,
  expireAuthoritativeRoom,
  heartbeatRoomPlayer,
  joinAuthoritativeRoom,
  projectPublicRoom,
  reconnectRoomPlayer,
  RoomServiceError,
  setRoomReady,
  submitRoomCommand,
  voteRoomRematch,
} from "../packages/game-core/src";
import type { AuthoritativeRoom, PlayerId } from "../packages/game-core/src";
import {
  RoomRepositoryConflictError,
  type RoomRepository,
  type StoredRoom,
} from "./room-repository";
import type { RoomRateLimitOperation, RoomRateLimiter } from "./rate-limit";

const MAX_BODY_BYTES = 64 * 1024;
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type RandomBytes = (length: number) => Uint8Array;

export type RoomApiDependencies = {
  readonly repository: RoomRepository;
  readonly now?: () => number;
  readonly randomBytes?: RandomBytes;
  readonly rateLimiter?: RoomRateLimiter;
};

type ActionBody =
  | { readonly action: "ready"; readonly ready: boolean }
  | { readonly action: "heartbeat" }
  | { readonly action: "disconnect" }
  | { readonly action: "reconnect" }
  | { readonly action: "command"; readonly envelope: unknown }
  | { readonly action: "rematch" };

const defaultRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

const roomJson = (body: unknown, revision: number, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      etag: `"${revision}"`,
      "x-room-revision": String(revision),
    },
  });

function randomText(
  length: number,
  alphabet: string,
  randomBytes: RandomBytes,
): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createRoomCredential(randomBytes = defaultRandomBytes): string {
  return base64Url(randomBytes(32));
}

export async function digestRoomCredential(token: string): Promise<string> {
  if (!token || token.length > 256) throw new TypeError("Token is invalid.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return base64Url(new Uint8Array(digest));
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/u.exec(authorization);
  if (!match)
    throw new RoomServiceError(
      "INVALID_CREDENTIAL",
      "A valid room bearer token is required.",
    );
  return match[1];
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES)
    throw new TypeError("Body is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new TypeError("Body is too large.");
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("JSON body must be an object.");
  return value as Record<string, unknown>;
}

function authenticatedPlayer(
  room: AuthoritativeRoom,
  credentialDigest: string,
): PlayerId {
  const entry = Object.entries(room.seats).find(
    ([, seat]) => seat?.credentialDigest === credentialDigest,
  );
  if (!entry)
    throw new RoomServiceError(
      "INVALID_CREDENTIAL",
      "Credential is not bound to this room.",
    );
  return entry[0] as PlayerId;
}

function roomErrorStatus(error: RoomServiceError): number {
  if (error.code === "INVALID_CREDENTIAL") return 401;
  if (
    error.code === "ROOM_EXPIRED" ||
    error.code === "RECONNECT_WINDOW_EXPIRED"
  )
    return 410;
  return 409;
}

function actionBody(value: Record<string, unknown>): ActionBody {
  if (value.action === "ready" && typeof value.ready === "boolean")
    return { action: value.action, ready: value.ready };
  if (
    value.action === "heartbeat" ||
    value.action === "disconnect" ||
    value.action === "reconnect" ||
    value.action === "rematch"
  )
    return { action: value.action };
  if (value.action === "command" && value.envelope !== undefined)
    return { action: value.action, envelope: value.envelope };
  throw new TypeError("Room action is invalid.");
}

async function persistSweep(
  stored: StoredRoom,
  repository: RoomRepository,
  now: number,
): Promise<StoredRoom> {
  const swept = expireAuthoritativeRoom(stored.room, now);
  return swept === stored.room
    ? stored
    : repository.save(swept, stored.revision);
}

async function createRoom(
  request: Request,
  dependencies: RoomApiDependencies,
  now: number,
): Promise<Response> {
  const body = await readObject(request);
  const seed =
    typeof body.seed === "string" && body.seed.trim()
      ? body.seed.trim().slice(0, 128)
      : `online-${now}`;
  const randomBytes = dependencies.randomBytes ?? defaultRandomBytes;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = createRoomCredential(randomBytes);
    const room = createAuthoritativeRoom({
      roomId: `room-${randomText(20, INVITE_ALPHABET, randomBytes)}`,
      inviteCode: randomText(6, INVITE_ALPHABET, randomBytes),
      seed,
      hostCredentialDigest: await digestRoomCredential(token),
      now,
    });
    try {
      const stored = await dependencies.repository.create(room);
      return roomJson(
        {
          room: projectPublicRoom(room),
          session: { playerId: "player-one", token },
        },
        stored.revision,
        201,
      );
    } catch (error) {
      if (!(error instanceof RoomRepositoryConflictError) || attempt === 2)
        throw error;
    }
  }
  throw new RoomRepositoryConflictError("Could not allocate a unique room.");
}

async function joinRoom(
  request: Request,
  dependencies: RoomApiDependencies,
  now: number,
): Promise<Response> {
  const body = await readObject(request);
  const inviteCode =
    typeof body.inviteCode === "string"
      ? body.inviteCode.trim().toUpperCase()
      : "";
  if (!/^[A-Z2-9]{6}$/u.test(inviteCode))
    throw new TypeError("Invite code is invalid.");
  const stored = await dependencies.repository.findByInviteCode(inviteCode);
  if (!stored) return json({ error: "ROOM_NOT_FOUND" }, 404);
  const current = await persistSweep(stored, dependencies.repository, now);
  const token = createRoomCredential(
    dependencies.randomBytes ?? defaultRandomBytes,
  );
  const room = joinAuthoritativeRoom(current.room, {
    guestCredentialDigest: await digestRoomCredential(token),
    now,
  });
  const saved = await dependencies.repository.save(room, current.revision);
  return roomJson(
    {
      room: projectPublicRoom(room),
      session: { playerId: "player-two", token },
    },
    saved.revision,
    201,
  );
}

async function readRoom(
  request: Request,
  roomId: string,
  dependencies: RoomApiDependencies,
  now: number,
): Promise<Response> {
  const initial = await dependencies.repository.findById(roomId);
  if (!initial) return json({ error: "ROOM_NOT_FOUND" }, 404);
  const stored = await persistSweep(initial, dependencies.repository, now);
  const credentialDigest = await digestRoomCredential(bearerToken(request));
  const playerId = authenticatedPlayer(stored.room, credentialDigest);
  if (request.headers.get("if-none-match") === `"${stored.revision}"`)
    return new Response(null, {
      status: 304,
      headers: {
        "cache-control": "no-store",
        etag: `"${stored.revision}"`,
        "x-room-revision": String(stored.revision),
      },
    });
  return roomJson(
    {
      room: projectPublicRoom(stored.room),
      ...(stored.room.authority
        ? {
            snapshot: createReconnectSnapshot(stored.room.authority, playerId),
          }
        : {}),
    },
    stored.revision,
  );
}

async function runAction(
  request: Request,
  roomId: string,
  dependencies: RoomApiDependencies,
  now: number,
): Promise<Response> {
  const initial = await dependencies.repository.findById(roomId);
  if (!initial) return json({ error: "ROOM_NOT_FOUND" }, 404);
  const stored = await persistSweep(initial, dependencies.repository, now);
  const token = bearerToken(request);
  const credentialDigest = await digestRoomCredential(token);
  const playerId = authenticatedPlayer(stored.room, credentialDigest);
  const action = actionBody(await readObject(request));
  let room = stored.room;
  const payload: Record<string, unknown> = {};

  if (action.action === "ready") {
    room = setRoomReady(room, {
      playerId,
      credentialDigest,
      ready: action.ready,
      now,
    });
    if (room.authority)
      payload.snapshot = createReconnectSnapshot(room.authority, playerId);
  } else if (action.action === "heartbeat") {
    room = heartbeatRoomPlayer(room, { playerId, credentialDigest, now });
  } else if (action.action === "disconnect") {
    room = disconnectRoomPlayer(room, { playerId, credentialDigest, now });
  } else if (action.action === "reconnect") {
    const result = reconnectRoomPlayer(room, {
      playerId,
      credentialDigest,
      now,
    });
    room = result.room;
    if (result.snapshot) payload.snapshot = result.snapshot;
  } else if (action.action === "rematch") {
    room = voteRoomRematch(room, { playerId, credentialDigest, now });
    if (room.authority)
      payload.snapshot = createReconnectSnapshot(room.authority, playerId);
  } else {
    const transition = submitRoomCommand(room, {
      playerId,
      credentialDigest,
      envelope: action.envelope,
      now,
    });
    room = transition.room;
    payload.result = transition.response;
  }

  const saved = await dependencies.repository.save(room, stored.revision);
  return roomJson(
    { room: projectPublicRoom(room), ...payload },
    saved.revision,
  );
}

export async function handleRoomApi(
  request: Request,
  dependencies: RoomApiDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/rooms")) return null;
  const startedAt = performance.now();
  const now = (dependencies.now ?? Date.now)();
  let operation = "unknown";
  try {
    let response: Response;
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      operation = "create";
      if (
        !(await allowRequest(dependencies.rateLimiter, "create", request, now))
      )
        return rateLimited("create");
      response = await createRoom(request, dependencies, now);
    } else if (
      request.method === "POST" &&
      url.pathname === "/api/rooms/join"
    ) {
      operation = "join";
      if (!(await allowRequest(dependencies.rateLimiter, "join", request, now)))
        return rateLimited("join");
      response = await joinRoom(request, dependencies, now);
    } else {
      const roomMatch = /^\/api\/rooms\/([A-Za-z0-9._:-]+)$/u.exec(
        url.pathname,
      );
      if (roomMatch && request.method === "GET") {
        operation = "sync";
        response = await readRoom(request, roomMatch[1], dependencies, now);
      } else {
        const match = /^\/api\/rooms\/([A-Za-z0-9._:-]+)\/actions$/u.exec(
          url.pathname,
        );
        if (!match || request.method !== "POST")
          return json({ error: "ROOM_ROUTE_NOT_FOUND" }, 404);
        operation = "action";
        if (
          !(await allowRequest(
            dependencies.rateLimiter,
            "action",
            request,
            now,
          ))
        )
          return rateLimited("action");
        response = await runAction(request, match[1], dependencies, now);
      }
    }
    console.info(
      JSON.stringify({
        event: "room-api",
        operation,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    return response;
  } catch (error) {
    const status =
      error instanceof RoomServiceError
        ? roomErrorStatus(error)
        : error instanceof RoomRepositoryConflictError
          ? 409
          : error instanceof SyntaxError || error instanceof TypeError
            ? 400
            : 500;
    const code =
      error instanceof RoomServiceError
        ? error.code
        : error instanceof RoomRepositoryConflictError
          ? error.name
          : status === 400
            ? "INVALID_REQUEST"
            : "ROOM_SERVICE_UNAVAILABLE";
    console.error(
      JSON.stringify({
        event: "room-api-error",
        operation,
        status,
        code,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    return json(
      {
        error: code,
        message:
          status === 500 ? "Room service is unavailable." : String(error),
      },
      status,
    );
  }
}

async function allowRequest(
  limiter: RoomRateLimiter | undefined,
  operation: RoomRateLimitOperation,
  request: Request,
  now: number,
): Promise<boolean> {
  return limiter ? limiter.allow(operation, request, now) : true;
}

function rateLimited(operation: RoomRateLimitOperation): Response {
  console.warn(
    JSON.stringify({ event: "room-rate-limited", operation, status: 429 }),
  );
  return Response.json(
    {
      error: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试。",
    },
    {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    },
  );
}
