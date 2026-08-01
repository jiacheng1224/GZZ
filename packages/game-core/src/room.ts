import { createStandardGame } from "./factories";
import {
  createProtocolAuthority,
  createReconnectSnapshot,
  processProtocolCommand,
} from "./protocol";
import type {
  ProtocolAuthority,
  ProtocolCommandResult,
  ProtocolSnapshot,
} from "./protocol";
import type { PlayerId, WinResult } from "./types";

export const ROOM_SCHEMA_VERSION = 1 as const;

export type RoomStatus =
  "waiting" | "ready" | "playing" | "finished" | "expired";

export type RoomErrorCode =
  | "ROOM_EXPIRED"
  | "ROOM_FULL"
  | "PLAYER_ALREADY_JOINED"
  | "INVALID_CREDENTIAL"
  | "PLAYER_DISCONNECTED"
  | "ROOM_NOT_PLAYING"
  | "ROOM_NOT_FINISHED"
  | "RECONNECT_WINDOW_EXPIRED";

export type RoomLifecycleConfig = {
  readonly disconnectRetentionMs: number;
  readonly idleTimeoutMs: number;
};

export type RoomSeat = {
  readonly playerId: PlayerId;
  readonly credentialDigest: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly joinedAt: number;
  readonly lastSeenAt: number;
  readonly reconnectDeadline?: number;
};

export type RoomMetrics = {
  readonly commandsAccepted: number;
  readonly commandsDuplicate: number;
  readonly commandsRejected: number;
  readonly disconnects: number;
  readonly reconnects: number;
  readonly matchesStarted: number;
  readonly matchesCompleted: number;
};

export type AuthoritativeRoom = {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly inviteCode: string;
  readonly seed: string;
  readonly status: RoomStatus;
  readonly generation: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly config: RoomLifecycleConfig;
  readonly seats: Partial<Record<PlayerId, RoomSeat>>;
  readonly authority?: ProtocolAuthority;
  readonly rematchVotes: readonly PlayerId[];
  readonly metrics: RoomMetrics;
};

export type PublicRoomSeat = Omit<RoomSeat, "credentialDigest">;

export type PublicRoomView = {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly inviteCode: string;
  readonly status: RoomStatus;
  readonly generation: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly seats: Partial<Record<PlayerId, PublicRoomSeat>>;
  readonly rematchVotes: readonly PlayerId[];
  readonly winner?: WinResult;
};

export type RoomReconnectResult = {
  readonly room: AuthoritativeRoom;
  readonly view: PublicRoomView;
  readonly snapshot?: ProtocolSnapshot;
};

export type RoomCommandTransition = {
  readonly room: AuthoritativeRoom;
  readonly response: ProtocolCommandResult;
};

export class RoomServiceError extends Error {
  constructor(
    public readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoomServiceError";
  }
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const emptyMetrics = (): RoomMetrics => ({
  commandsAccepted: 0,
  commandsDuplicate: 0,
  commandsRejected: 0,
  disconnects: 0,
  reconnects: 0,
  matchesStarted: 0,
  matchesCompleted: 0,
});

function assertText(value: string, name: string): void {
  if (!value || value.length > 128) throw new TypeError(`${name} is invalid.`);
}

function assertDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive integer.`);
}

function ensureLive(room: AuthoritativeRoom, now: number): void {
  if (room.status === "expired" || now >= room.expiresAt)
    throw new RoomServiceError("ROOM_EXPIRED", "Room has expired.");
}

function authenticate(
  room: AuthoritativeRoom,
  playerId: PlayerId,
  credentialDigest: string,
): RoomSeat {
  const seat = room.seats[playerId];
  if (!seat || seat.credentialDigest !== credentialDigest)
    throw new RoomServiceError(
      "INVALID_CREDENTIAL",
      "Credential does not match the requested room seat.",
    );
  return seat;
}

function withActivity(room: AuthoritativeRoom, now: number): AuthoritativeRoom {
  return {
    ...room,
    updatedAt: now,
    expiresAt: now + room.config.idleTimeoutMs,
  };
}

function updateSeat(
  room: AuthoritativeRoom,
  playerId: PlayerId,
  seat: RoomSeat,
): AuthoritativeRoom {
  return { ...room, seats: { ...room.seats, [playerId]: seat } };
}

function startMatch(room: AuthoritativeRoom, now: number): AuthoritativeRoom {
  const generation = room.generation + 1;
  const firstPlayer: PlayerId =
    generation % 2 === 1 ? "player-one" : "player-two";
  const authority = createProtocolAuthority(
    room.roomId,
    createStandardGame(`${room.seed}:match:${generation}`, firstPlayer),
  );
  return withActivity(
    {
      ...room,
      status: "playing",
      generation,
      authority,
      rematchVotes: [],
      metrics: {
        ...room.metrics,
        matchesStarted: room.metrics.matchesStarted + 1,
      },
    },
    now,
  );
}

export function createAuthoritativeRoom(input: {
  roomId: string;
  inviteCode: string;
  seed: string;
  hostCredentialDigest: string;
  now: number;
  config?: Partial<RoomLifecycleConfig>;
}): AuthoritativeRoom {
  assertText(input.roomId, "roomId");
  assertText(input.inviteCode, "inviteCode");
  assertText(input.seed, "seed");
  assertText(input.hostCredentialDigest, "hostCredentialDigest");
  const config: RoomLifecycleConfig = {
    disconnectRetentionMs: input.config?.disconnectRetentionMs ?? 60_000,
    idleTimeoutMs: input.config?.idleTimeoutMs ?? 30 * 60_000,
  };
  assertDuration(config.disconnectRetentionMs, "disconnectRetentionMs");
  assertDuration(config.idleTimeoutMs, "idleTimeoutMs");
  const host: RoomSeat = {
    playerId: "player-one",
    credentialDigest: input.hostCredentialDigest,
    ready: false,
    connected: true,
    joinedAt: input.now,
    lastSeenAt: input.now,
  };
  return {
    schemaVersion: ROOM_SCHEMA_VERSION,
    roomId: input.roomId,
    inviteCode: input.inviteCode,
    seed: input.seed,
    status: "waiting",
    generation: 0,
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: input.now + config.idleTimeoutMs,
    config,
    seats: { "player-one": host },
    rematchVotes: [],
    metrics: emptyMetrics(),
  };
}

export function joinAuthoritativeRoom(
  current: AuthoritativeRoom,
  input: { guestCredentialDigest: string; now: number },
): AuthoritativeRoom {
  ensureLive(current, input.now);
  assertText(input.guestCredentialDigest, "guestCredentialDigest");
  if (
    Object.values(current.seats).some(
      (seat) => seat?.credentialDigest === input.guestCredentialDigest,
    )
  )
    throw new RoomServiceError(
      "PLAYER_ALREADY_JOINED",
      "Credential is already bound to a room seat.",
    );
  if (current.seats["player-two"])
    throw new RoomServiceError("ROOM_FULL", "Room already has two players.");
  const guest: RoomSeat = {
    playerId: "player-two",
    credentialDigest: input.guestCredentialDigest,
    ready: false,
    connected: true,
    joinedAt: input.now,
    lastSeenAt: input.now,
  };
  return withActivity(
    updateSeat({ ...current, status: "ready" }, "player-two", guest),
    input.now,
  );
}

export function setRoomReady(
  current: AuthoritativeRoom,
  input: {
    playerId: PlayerId;
    credentialDigest: string;
    ready: boolean;
    now: number;
  },
): AuthoritativeRoom {
  ensureLive(current, input.now);
  const seat = authenticate(current, input.playerId, input.credentialDigest);
  const next = withActivity(
    updateSeat(current, input.playerId, {
      ...seat,
      ready: input.ready,
      lastSeenAt: input.now,
    }),
    input.now,
  );
  const bothReady = (["player-one", "player-two"] as const).every(
    (player) => next.seats[player]?.ready && next.seats[player]?.connected,
  );
  return bothReady && !next.authority ? startMatch(next, input.now) : next;
}

export function heartbeatRoomPlayer(
  current: AuthoritativeRoom,
  input: {
    playerId: PlayerId;
    credentialDigest: string;
    now: number;
  },
): AuthoritativeRoom {
  ensureLive(current, input.now);
  const seat = authenticate(current, input.playerId, input.credentialDigest);
  if (!seat.connected)
    throw new RoomServiceError(
      "PLAYER_DISCONNECTED",
      "Reconnect before sending a heartbeat.",
    );
  return withActivity(
    updateSeat(current, input.playerId, {
      ...seat,
      lastSeenAt: input.now,
    }),
    input.now,
  );
}

export function disconnectRoomPlayer(
  current: AuthoritativeRoom,
  input: {
    playerId: PlayerId;
    credentialDigest: string;
    now: number;
  },
): AuthoritativeRoom {
  ensureLive(current, input.now);
  const seat = authenticate(current, input.playerId, input.credentialDigest);
  if (!seat.connected) return current;
  return updateSeat(
    {
      ...current,
      updatedAt: input.now,
      metrics: {
        ...current.metrics,
        disconnects: current.metrics.disconnects + 1,
      },
    },
    input.playerId,
    {
      ...seat,
      connected: false,
      lastSeenAt: input.now,
      reconnectDeadline: input.now + current.config.disconnectRetentionMs,
    },
  );
}

export function reconnectRoomPlayer(
  current: AuthoritativeRoom,
  input: {
    playerId: PlayerId;
    credentialDigest: string;
    now: number;
  },
): RoomReconnectResult {
  ensureLive(current, input.now);
  const seat = authenticate(current, input.playerId, input.credentialDigest);
  if (
    seat.reconnectDeadline !== undefined &&
    input.now > seat.reconnectDeadline
  )
    throw new RoomServiceError(
      "RECONNECT_WINDOW_EXPIRED",
      "The reconnect retention window has expired.",
    );
  const next = withActivity(
    updateSeat(current, input.playerId, {
      ...seat,
      connected: true,
      lastSeenAt: input.now,
      reconnectDeadline: undefined,
    }),
    input.now,
  );
  const wasDisconnected = !seat.connected;
  const room = {
    ...next,
    metrics: {
      ...next.metrics,
      reconnects: next.metrics.reconnects + (wasDisconnected ? 1 : 0),
    },
  };
  return {
    room,
    view: projectPublicRoom(room),
    ...(room.authority
      ? { snapshot: createReconnectSnapshot(room.authority, input.playerId) }
      : {}),
  };
}

export function submitRoomCommand(
  current: AuthoritativeRoom,
  input: {
    playerId: PlayerId;
    credentialDigest: string;
    envelope: unknown;
    now: number;
  },
): RoomCommandTransition {
  ensureLive(current, input.now);
  const seat = authenticate(current, input.playerId, input.credentialDigest);
  if (!seat.connected)
    throw new RoomServiceError(
      "PLAYER_DISCONNECTED",
      "Reconnect before submitting commands.",
    );
  if (
    (current.status !== "playing" && current.status !== "finished") ||
    !current.authority
  )
    throw new RoomServiceError(
      "ROOM_NOT_PLAYING",
      "Room is not accepting game commands.",
    );
  const transition = processProtocolCommand(
    current.authority,
    input.envelope,
    input.playerId,
  );
  const responseStatus = transition.response.status;
  const completed =
    current.authority.state.phase !== "finished" &&
    transition.authority.state.phase === "finished";
  let room: AuthoritativeRoom = withActivity(
    {
      ...current,
      authority: transition.authority,
      status: completed ? "finished" : current.status,
      metrics: {
        ...current.metrics,
        commandsAccepted:
          current.metrics.commandsAccepted +
          (responseStatus === "accepted" ? 1 : 0),
        commandsDuplicate:
          current.metrics.commandsDuplicate +
          (responseStatus === "duplicate" ? 1 : 0),
        commandsRejected:
          current.metrics.commandsRejected +
          (responseStatus === "rejected" ? 1 : 0),
        matchesCompleted:
          current.metrics.matchesCompleted + (completed ? 1 : 0),
      },
    },
    input.now,
  );
  room = updateSeat(room, input.playerId, {
    ...room.seats[input.playerId]!,
    lastSeenAt: input.now,
  });
  return { room, response: transition.response };
}

export function voteRoomRematch(
  current: AuthoritativeRoom,
  input: {
    playerId: PlayerId;
    credentialDigest: string;
    now: number;
  },
): AuthoritativeRoom {
  ensureLive(current, input.now);
  authenticate(current, input.playerId, input.credentialDigest);
  if (current.status !== "finished")
    throw new RoomServiceError(
      "ROOM_NOT_FINISHED",
      "Rematch voting is only available after a completed match.",
    );
  const votes = Array.from(new Set([...current.rematchVotes, input.playerId]));
  const next = withActivity({ ...current, rematchVotes: votes }, input.now);
  return votes.length === 2 ? startMatch(next, input.now) : next;
}

export function expireAuthoritativeRoom(
  current: AuthoritativeRoom,
  now: number,
): AuthoritativeRoom {
  if (current.status === "expired") return current;
  const reconnectExpired = Object.values(current.seats).some(
    (seat) =>
      seat &&
      !seat.connected &&
      seat.reconnectDeadline !== undefined &&
      now > seat.reconnectDeadline,
  );
  if (now < current.expiresAt && !reconnectExpired) return current;
  return {
    ...current,
    status: "expired",
    updatedAt: now,
    authority: undefined,
  };
}

export function projectPublicRoom(room: AuthoritativeRoom): PublicRoomView {
  const seats = Object.fromEntries(
    Object.entries(room.seats).map(([player, seat]) => {
      const publicSeat: PublicRoomSeat = {
        playerId: seat!.playerId,
        ready: seat!.ready,
        connected: seat!.connected,
        joinedAt: seat!.joinedAt,
        lastSeenAt: seat!.lastSeenAt,
        ...(seat!.reconnectDeadline === undefined
          ? {}
          : { reconnectDeadline: seat!.reconnectDeadline }),
      };
      return [player, clone(publicSeat)];
    }),
  ) as Partial<Record<PlayerId, PublicRoomSeat>>;
  return {
    schemaVersion: ROOM_SCHEMA_VERSION,
    roomId: room.roomId,
    inviteCode: room.inviteCode,
    status: room.status,
    generation: room.generation,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt,
    seats,
    rematchVotes: [...room.rematchVotes],
    ...(room.authority?.state.winner
      ? { winner: clone(room.authority.state.winner) }
      : {}),
  };
}
