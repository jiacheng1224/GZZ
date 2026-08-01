import { describe, expect, it } from "vitest";
import { createStandardGame } from "./factories";
import {
  PROTOCOL_VERSION,
  createCommandEnvelope,
  createProtocolAuthority,
  createReconnectSnapshot,
  processProtocolCommand,
} from "./protocol";
import { stateFingerprint } from "./replay";
import type { GameCommand, PlayerId } from "./types";

function setup() {
  const state = createStandardGame("protocol-authority");
  const authority = createProtocolAuthority("room-alpha", state);
  const command: GameCommand = {
    type: "play-troop",
    player: "player-one",
    cardId: state.players["player-one"].hand.find((cardId) =>
      cardId.startsWith("troop-"),
    )!,
    flagId: 0,
  };
  const envelope = createCommandEnvelope({
    roomId: authority.roomId,
    commandId: "command-001",
    sequence: 1,
    playerId: "player-one",
    clientVersion: "1.6.0-r6.m14",
    expectedStateVersion: 0,
    command,
  });
  return { state, authority, command, envelope };
}

describe("M14 protocol authority", () => {
  it("accepts a versioned intent and returns only the player's projection", () => {
    const { state, authority, envelope } = setup();
    const before = stateFingerprint(state);
    const transition = processProtocolCommand(
      authority,
      envelope,
      "player-one",
    );
    expect(transition.response).toMatchObject({
      status: "accepted",
      stateVersion: 1,
      sequence: 1,
    });
    expect(transition.authority.stateVersion).toBe(1);
    expect(transition.authority.nextSequence["player-one"]).toBe(2);
    expect(stateFingerprint(state)).toBe(before);
    const serialized = JSON.stringify(transition.response);
    expect(serialized).not.toContain(state.players["player-two"].hand[0]);
    expect(serialized).not.toContain(state.troopDeck[0]);
    expect(serialized).not.toContain(state.seed);
  });

  it("ignores client-supplied state and applies only the decoded intent", () => {
    const { authority, envelope } = setup();
    const transition = processProtocolCommand(
      authority,
      {
        ...envelope,
        state: { phase: "finished", winner: { player: "player-one" } },
        command: {
          ...envelope.command,
          injectedState: { troopDeck: [] },
        },
      },
      "player-one",
    );
    expect(transition.response.status).toBe("accepted");
    expect(transition.authority.state.phase).toBe("optional-claims");
    expect(transition.authority.state.winner).toBeUndefined();
    expect(transition.authority.state.troopDeck.length).toBeGreaterThan(0);
  });

  it("treats an identical command ID as idempotent without applying twice", () => {
    const { authority, envelope } = setup();
    const accepted = processProtocolCommand(authority, envelope, "player-one");
    const fingerprint = stateFingerprint(accepted.authority.state);
    const duplicate = processProtocolCommand(
      accepted.authority,
      envelope,
      "player-one",
    );
    expect(duplicate.response.status).toBe("duplicate");
    expect(duplicate.authority).toBe(accepted.authority);
    expect(stateFingerprint(duplicate.authority.state)).toBe(fingerprint);
    expect(duplicate.authority.stateVersion).toBe(1);
  });

  it("rejects reuse of a command ID with altered content", () => {
    const { authority, envelope } = setup();
    const accepted = processProtocolCommand(authority, envelope, "player-one");
    const altered = {
      ...envelope,
      command: { ...envelope.command, flagId: 1 },
    };
    const conflict = processProtocolCommand(
      accepted.authority,
      altered,
      "player-one",
    );
    expect(conflict.response).toMatchObject({
      status: "rejected",
      code: "COMMAND_ID_CONFLICT",
    });
    expect(conflict.authority).toBe(accepted.authority);
  });

  it.each([
    ["STALE_STATE_VERSION", { expectedStateVersion: 3 }],
    ["OUT_OF_ORDER_COMMAND", { sequence: 2 }],
  ] as const)("rejects %s without changing authority", (code, change) => {
    const { authority, envelope } = setup();
    const transition = processProtocolCommand(
      authority,
      { ...envelope, ...change },
      "player-one",
    );
    expect(transition.response).toMatchObject({ status: "rejected", code });
    expect(transition.authority).toBe(authority);
  });

  it("returns an explicit upgrade response for unsupported protocol versions", () => {
    const { authority, envelope } = setup();
    const transition = processProtocolCommand(
      authority,
      { ...envelope, protocolVersion: PROTOCOL_VERSION + 1 },
      "player-one",
    );
    expect(transition.response).toMatchObject({
      status: "rejected",
      code: "UNSUPPORTED_PROTOCOL",
      requiredProtocolVersion: PROTOCOL_VERSION,
    });
  });

  it.each([
    ["ROOM_MISMATCH", { roomId: "room-other" }, "player-one"],
    ["PLAYER_MISMATCH", {}, "player-two"],
    [
      "COMMAND_ACTOR_MISMATCH",
      { command: { type: "skip-play", player: "player-two" } },
      "player-one",
    ],
  ] as const)("rejects identity tampering with %s", (code, change, actor) => {
    const { authority, envelope } = setup();
    const transition = processProtocolCommand(
      authority,
      { ...envelope, ...change },
      actor as PlayerId,
    );
    expect(transition.response).toMatchObject({ status: "rejected", code });
    expect(transition.response).not.toHaveProperty("snapshot");
  });

  it("rejects malformed and rule-invalid commands without consuming sequence", () => {
    const { authority, envelope } = setup();
    const malformed = processProtocolCommand(
      authority,
      { ...envelope, command: { type: "replace-state", player: "player-one" } },
      "player-one",
    );
    expect(malformed.response).toMatchObject({
      status: "rejected",
      code: "INVALID_ENVELOPE",
    });
    const illegal = processProtocolCommand(
      authority,
      {
        ...envelope,
        commandId: "command-illegal",
        command: { type: "end-turn", player: "player-one" },
      },
      "player-one",
    );
    expect(illegal.response).toMatchObject({
      status: "rejected",
      code: "RULE_REJECTED",
    });
    expect(illegal.authority.nextSequence["player-one"]).toBe(1);
  });

  it("creates a reconnect snapshot consistent with the latest accepted state", () => {
    const { state, authority, envelope } = setup();
    const accepted = processProtocolCommand(authority, envelope, "player-one");
    const reconnect = createReconnectSnapshot(accepted.authority, "player-one");
    expect(reconnect).toMatchObject({
      messageType: "snapshot",
      stateVersion: 1,
      nextSequence: 2,
      recipient: "player-one",
    });
    expect(reconnect.snapshot).toEqual(
      accepted.response.status === "accepted"
        ? accepted.response.snapshot
        : undefined,
    );
    const serialized = JSON.stringify(reconnect);
    expect(serialized).not.toContain(state.players["player-two"].hand[0]);
    expect(serialized).not.toContain(state.troopDeck[0]);
  });
});
