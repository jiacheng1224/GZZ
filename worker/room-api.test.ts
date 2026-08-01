import { describe, expect, it, vi } from "vitest";
import { createCommandEnvelope } from "../packages/game-core/src";
import { handleRoomApi } from "./room-api";
import {
  MemoryRoomRepository,
  RoomRepositoryConflictError,
} from "./room-repository";

const post = (path: string, body: unknown, token?: string) =>
  new Request(`https://game.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path: string, token: string, etag?: string) =>
  new Request(`https://game.test${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(etag ? { "if-none-match": etag } : {}),
    },
  });

function dependencies() {
  let tick = 1_000;
  let byte = 0;
  return {
    repository: new MemoryRoomRepository(),
    now: () => tick++,
    randomBytes: (length: number) =>
      Uint8Array.from({ length }, () => (byte++ * 29 + 17) % 256),
  };
}

async function createAndJoin() {
  const deps = dependencies();
  const created = await handleRoomApi(
    post("/api/rooms", { seed: "api-flow" }),
    deps,
  );
  const host = await created!.json<{
    room: { roomId: string; inviteCode: string };
    session: { token: string };
  }>();
  const joined = await handleRoomApi(
    post("/api/rooms/join", { inviteCode: host.room.inviteCode }),
    deps,
  );
  const guest = await joined!.json<{ session: { token: string } }>();
  return { deps, host, guest };
}

describe("M15-B room HTTP adapter", () => {
  it("creates strong opaque credentials and never persists plaintext tokens", async () => {
    const deps = dependencies();
    const response = await handleRoomApi(
      post("/api/rooms", { seed: "secure-room" }),
      deps,
    );
    expect(response?.status).toBe(201);
    const body = await response!.json<{
      room: { roomId: string; inviteCode: string };
      session: { playerId: string; token: string };
    }>();
    expect(body.session).toMatchObject({ playerId: "player-one" });
    expect(body.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const stored = await deps.repository.findById(body.room.roomId);
    expect(JSON.stringify(stored)).not.toContain(body.session.token);
    expect(body.room.inviteCode).toHaveLength(6);
  });

  it("joins, prepares both seats, and submits an authenticated intent", async () => {
    const { deps, host, guest } = await createAndJoin();
    const hostReady = await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "ready", ready: true },
        host.session.token,
      ),
      deps,
    );
    expect(hostReady?.status).toBe(200);
    const guestReady = await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "ready", ready: true },
        guest.session.token,
      ),
      deps,
    );
    const readyBody = await guestReady!.json<{
      room: { status: string };
      snapshot: {
        stateVersion: number;
        snapshot: { legalCommands: unknown[] };
      };
    }>();
    expect(readyBody.room.status).toBe("playing");
    const stored = await deps.repository.findById(host.room.roomId);
    const command = stored!.room.authority!.state.players[
      "player-one"
    ].hand.find((cardId) => cardId.startsWith("troop-"))!;
    const envelope = createCommandEnvelope({
      roomId: host.room.roomId,
      commandId: "api-command-1",
      sequence: 1,
      playerId: "player-one",
      clientVersion: "1.8.0-r6.m15b1",
      expectedStateVersion: 0,
      command: {
        type: "play-troop",
        player: "player-one",
        cardId: command,
        flagId: 0,
      },
    });
    const played = await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "command", envelope },
        host.session.token,
      ),
      deps,
    );
    const playedBody = await played!.json<{
      result: { status: string; stateVersion: number; snapshot: unknown };
    }>();
    expect(playedBody.result).toMatchObject({
      status: "accepted",
      stateVersion: 1,
    });
    expect(JSON.stringify(playedBody)).not.toContain(guest.session.token);
  });

  it("restores a disconnected player and rejects a forged bearer token", async () => {
    const { deps, host } = await createAndJoin();
    const forged = await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "heartbeat" },
        "x".repeat(43),
      ),
      deps,
    );
    expect(forged?.status).toBe(401);

    const disconnected = await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "disconnect" },
        host.session.token,
      ),
      deps,
    );
    expect(disconnected?.status).toBe(200);
    const reconnected = await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "reconnect" },
        host.session.token,
      ),
      deps,
    );
    const body = await reconnected!.json<{
      room: { seats: { "player-one": { connected: boolean } } };
    }>();
    expect(body.room.seats["player-one"].connected).toBe(true);
  });

  it("syncs a private snapshot and returns 304 for an unchanged revision", async () => {
    const { deps, host } = await createAndJoin();
    const synced = await handleRoomApi(
      get(`/api/rooms/${host.room.roomId}`, host.session.token),
      deps,
    );
    expect(synced?.status).toBe(200);
    const etag = synced!.headers.get("etag");
    expect(etag).toMatch(/^"\d+"$/u);
    const body = await synced!.json<{
      room: { roomId: string };
      snapshot?: unknown;
    }>();
    expect(body.room.roomId).toBe(host.room.roomId);
    expect(body.snapshot).toBeUndefined();

    const unchanged = await handleRoomApi(
      get(`/api/rooms/${host.room.roomId}`, host.session.token, etag!),
      deps,
    );
    expect(unchanged?.status).toBe(304);
    expect(await unchanged!.text()).toBe("");
  });

  it("enforces optimistic revisions so parallel writers cannot overwrite", async () => {
    const deps = dependencies();
    const response = await handleRoomApi(
      post("/api/rooms", { seed: "revision-room" }),
      deps,
    );
    const body = await response!.json<{ room: { roomId: string } }>();
    const first = await deps.repository.findById(body.room.roomId);
    const second = await deps.repository.findById(body.room.roomId);
    await deps.repository.save(first!.room, first!.revision);
    await expect(
      deps.repository.save(second!.room, second!.revision),
    ).rejects.toBeInstanceOf(RoomRepositoryConflictError);
  });

  it("returns 429 with retry guidance when the shared limiter rejects", async () => {
    const deps = dependencies();
    const allow = vi.fn().mockResolvedValue(false);
    const response = await handleRoomApi(
      post("/api/rooms", { seed: "limited-room" }),
      { ...deps, rateLimiter: { allow } },
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    await expect(response!.json()).resolves.toMatchObject({
      error: "RATE_LIMITED",
    });
    expect(allow).toHaveBeenCalledWith(
      "create",
      expect.any(Request),
      expect.any(Number),
    );
  });

  it("cleans expired authority records in bounded batches", async () => {
    const deps = dependencies();
    const response = await handleRoomApi(
      post("/api/rooms", { seed: "cleanup-room" }),
      deps,
    );
    const body = await response!.json<{ room: { roomId: string } }>();
    const stored = await deps.repository.findById(body.room.roomId);
    await deps.repository.save(
      { ...stored!.room, expiresAt: 500 },
      stored!.revision,
    );
    expect(await deps.repository.deleteExpired(501, 10)).toBe(1);
    expect(await deps.repository.findById(body.room.roomId)).toBeNull();
  });

  it("resolves concurrent identical commands through conflict then idempotent retry", async () => {
    const { deps, host, guest } = await createAndJoin();
    await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "ready", ready: true },
        host.session.token,
      ),
      deps,
    );
    await handleRoomApi(
      post(
        `/api/rooms/${host.room.roomId}/actions`,
        { action: "ready", ready: true },
        guest.session.token,
      ),
      deps,
    );
    const stored = await deps.repository.findById(host.room.roomId);
    const cardId = stored!.room.authority!.state.players[
      "player-one"
    ].hand.find((card) => card.startsWith("troop-"))!;
    const envelope = createCommandEnvelope({
      roomId: host.room.roomId,
      commandId: "parallel-command",
      sequence: 1,
      playerId: "player-one",
      clientVersion: "2.0.0-r6.rc1",
      expectedStateVersion: 0,
      command: {
        type: "play-troop",
        player: "player-one",
        cardId,
        flagId: 0,
      },
    });
    const submit = () =>
      handleRoomApi(
        post(
          `/api/rooms/${host.room.roomId}/actions`,
          { action: "command", envelope },
          host.session.token,
        ),
        deps,
      );
    const concurrent = await Promise.all([submit(), submit()]);
    expect(concurrent.map((response) => response?.status).sort()).toEqual([
      200, 409,
    ]);
    const retry = await submit();
    const retryBody = await retry!.json<{
      result: { status: string };
    }>();
    expect(retryBody.result.status).toBe("duplicate");
  });

  it("caps request bodies and returns structured logs without secrets", async () => {
    const deps = dependencies();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await handleRoomApi(
      post("/api/rooms", { seed: "log-room" }),
      deps,
    );
    const body = await response!.json<{ session: { token: string } }>();
    const logs = info.mock.calls.flat().join(" ");
    expect(logs).toContain('"event":"room-api"');
    expect(logs).not.toContain(body.session.token);
    info.mockRestore();

    const oversized = await handleRoomApi(
      post("/api/rooms", { seed: "x".repeat(70_000) }),
      deps,
    );
    expect(oversized?.status).toBe(400);
  });
});
