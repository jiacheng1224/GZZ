import { describe, expect, it } from "vitest";
import { chooseAiCommand } from "./ai";
import { createCommandEnvelope, createReconnectSnapshot } from "./protocol";
import type { CommandEnvelope } from "./protocol";
import {
  createAuthoritativeRoom,
  disconnectRoomPlayer,
  expireAuthoritativeRoom,
  joinAuthoritativeRoom,
  projectPublicRoom,
  reconnectRoomPlayer,
  RoomServiceError,
  setRoomReady,
  submitRoomCommand,
  voteRoomRematch,
} from "./room";
import type { AuthoritativeRoom } from "./room";
import type { PlayerId } from "./types";

const credentials = {
  "player-one": "digest-host-not-a-plaintext-token",
  "player-two": "digest-guest-not-a-plaintext-token",
} as const;

function startedRoom(seed = "room-test"): AuthoritativeRoom {
  let room = createAuthoritativeRoom({
    roomId: `room-${seed}`,
    inviteCode: "ABCD12",
    seed,
    hostCredentialDigest: credentials["player-one"],
    now: 1_000,
    config: { disconnectRetentionMs: 5_000, idleTimeoutMs: 60_000 },
  });
  room = joinAuthoritativeRoom(room, {
    guestCredentialDigest: credentials["player-two"],
    now: 1_001,
  });
  room = setRoomReady(room, {
    playerId: "player-one",
    credentialDigest: credentials["player-one"],
    ready: true,
    now: 1_002,
  });
  return setRoomReady(room, {
    playerId: "player-two",
    credentialDigest: credentials["player-two"],
    ready: true,
    now: 1_003,
  });
}

describe("M15 authoritative room lifecycle", () => {
  it("creates, joins, readies, and starts a versioned authority", () => {
    const room = startedRoom();
    expect(room).toMatchObject({
      status: "playing",
      generation: 1,
      metrics: { matchesStarted: 1 },
    });
    expect(room.authority?.roomId).toBe(room.roomId);
    expect(room.authority?.state.activePlayer).toBe("player-one");
  });

  it("keeps credentials and authoritative state out of public room views", () => {
    const room = startedRoom("redaction");
    const serialized = JSON.stringify(projectPublicRoom(room));
    expect(serialized).not.toContain(credentials["player-one"]);
    expect(serialized).not.toContain(credentials["player-two"]);
    expect(serialized).not.toContain(room.authority!.state.seed);
    expect(serialized).not.toContain(room.authority!.state.troopDeck[0]);
    expect(projectPublicRoom(room)).not.toHaveProperty("authority");
  });

  it("rejects credential impersonation before the protocol sees a command", () => {
    const room = startedRoom("auth");
    expect(() =>
      submitRoomCommand(room, {
        playerId: "player-one",
        credentialDigest: credentials["player-two"],
        envelope: {},
        now: 2_000,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RoomServiceError>>({
        code: "INVALID_CREDENTIAL",
      }),
    );
  });

  it("retains a disconnected seat and restores only its latest projection", () => {
    let room = startedRoom("reconnect");
    const hiddenCard = room.authority!.state.players["player-two"].hand[0];
    room = disconnectRoomPlayer(room, {
      playerId: "player-one",
      credentialDigest: credentials["player-one"],
      now: 2_000,
    });
    expect(room.seats["player-one"]).toMatchObject({
      connected: false,
      reconnectDeadline: 7_000,
    });
    const result = reconnectRoomPlayer(room, {
      playerId: "player-one",
      credentialDigest: credentials["player-one"],
      now: 6_999,
    });
    expect(result.snapshot).toMatchObject({
      recipient: "player-one",
      stateVersion: 0,
    });
    expect(JSON.stringify(result.view)).not.toContain(`"${hiddenCard}"`);
    expect(JSON.stringify(result.snapshot)).not.toContain(`"${hiddenCard}"`);
    expect(result.room.metrics).toMatchObject({
      disconnects: 1,
      reconnects: 1,
    });
  });

  it("expires rooms after the reconnect retention window", () => {
    let room = startedRoom("expiry");
    room = disconnectRoomPlayer(room, {
      playerId: "player-two",
      credentialDigest: credentials["player-two"],
      now: 2_000,
    });
    room = expireAuthoritativeRoom(room, 7_001);
    expect(room.status).toBe("expired");
    expect(room.authority).toBeUndefined();
    expect(() =>
      reconnectRoomPlayer(room, {
        playerId: "player-two",
        credentialDigest: credentials["player-two"],
        now: 7_002,
      }),
    ).toThrowError(expect.objectContaining({ code: "ROOM_EXPIRED" }));
  });

  it("runs 50 complete authority matches with reconnect synchronization", () => {
    for (let game = 0; game < 50; game += 1) {
      let room = startedRoom(`sync-${game}`);
      let step = 0;
      let lastSubmission:
        | { player: PlayerId; envelope: CommandEnvelope; now: number }
        | undefined;
      while (room.status === "playing" && step < 500) {
        const authority = room.authority!;
        const player = authority.state.activePlayer;
        if (step > 0 && step % 17 === 0) {
          room = disconnectRoomPlayer(room, {
            playerId: player,
            credentialDigest: credentials[player],
            now: 2_000 + step * 3,
          });
          const reconnected = reconnectRoomPlayer(room, {
            playerId: player,
            credentialDigest: credentials[player],
            now: 2_001 + step * 3,
          });
          room = reconnected.room;
          expect(reconnected.snapshot?.stateVersion).toBe(
            room.authority!.stateVersion,
          );
          expect(JSON.stringify(reconnected.snapshot)).not.toContain(
            `"${
              room.authority!.state.players[
                player === "player-one" ? "player-two" : "player-one"
              ].hand[0]
            }"`,
          );
        }
        const current = room.authority!;
        const view = createReconnectSnapshot(current, player).snapshot;
        const decision = chooseAiCommand(view, {
          difficulty: "standard",
          seed: `room-ai-${game}`,
          decisionIndex: step,
        });
        const envelope = createCommandEnvelope({
          roomId: room.roomId,
          commandId: `g${game}-c${step}`,
          sequence: current.nextSequence[player],
          playerId: player,
          clientVersion: "1.7.0-r6.m15",
          expectedStateVersion: current.stateVersion,
          command: decision.command,
        });
        const transition = submitRoomCommand(room, {
          playerId: player,
          credentialDigest: credentials[player],
          envelope,
          now: 2_002 + step * 3,
        });
        expect(transition.response.status).toBe("accepted");
        lastSubmission = {
          player,
          envelope,
          now: 2_002 + step * 3,
        };
        room = transition.room;
        step += 1;
      }
      expect(room.status, `game ${game} did not finish`).toBe("finished");
      expect(room.metrics.matchesCompleted).toBe(1);
      expect(step).toBeLessThan(500);
      const duplicate = submitRoomCommand(room, {
        playerId: lastSubmission!.player,
        credentialDigest: credentials[lastSubmission!.player],
        envelope: lastSubmission!.envelope,
        now: lastSubmission!.now + 1,
      });
      expect(duplicate.response.status).toBe("duplicate");
      expect(duplicate.room.status).toBe("finished");
      expect(duplicate.room.metrics.commandsDuplicate).toBe(1);
      room = duplicate.room;
      const firstVote = voteRoomRematch(room, {
        playerId: "player-one",
        credentialDigest: credentials["player-one"],
        now: 50_000,
      });
      const rematch = voteRoomRematch(firstVote, {
        playerId: "player-two",
        credentialDigest: credentials["player-two"],
        now: 50_001,
      });
      expect(rematch).toMatchObject({ status: "playing", generation: 2 });
      expect(rematch.authority?.state.activePlayer).toBe("player-two");
    }
  });
});
