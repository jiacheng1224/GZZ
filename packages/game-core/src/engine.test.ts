import { describe, expect, it } from "vitest";
import { applyCommand, getLegalCommands, validateCommand } from "./engine";
import { createBasicGame, createEmptyGameState } from "./factories";
import { assertGameState } from "./invariants";

describe("basic turn engine", () => {
  it("deals seven cards each and preserves all 60 cards", () => {
    const state = createBasicGame("deal-seed");
    expect(state.players["player-one"].hand).toHaveLength(7);
    expect(state.players["player-two"].hand).toHaveLength(7);
    expect(state.troopDeck).toHaveLength(46);
    expect(() => assertGameState(state)).not.toThrow();
  });

  it("plays, passes claims, draws, and changes the active player", () => {
    let state = createBasicGame("turn-seed");
    const cardId = state.players["player-one"].hand[0];
    state = applyCommand(state, {
      type: "play-troop",
      player: "player-one",
      cardId,
      flagId: 0,
    });
    expect(state.phase).toBe("optional-claims");
    state = applyCommand(state, { type: "pass-claims", player: "player-one" });
    state = applyCommand(state, {
      type: "draw-card",
      player: "player-one",
      pile: "troop",
    });
    expect(state.activePlayer).toBe("player-two");
    expect(state.players["player-one"].hand).toHaveLength(7);
  });

  it("returns stable errors without changing the input state", () => {
    const state = createBasicGame("error-seed");
    const before = JSON.stringify(state);
    const error = validateCommand(state, {
      type: "play-troop",
      player: "player-two",
      cardId: state.players["player-two"].hand[0],
      flagId: 0,
    });
    expect(error?.code).toBe("NOT_ACTIVE_PLAYER");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("replays an identical command sequence deterministically", () => {
    const initial = createBasicGame("replay-seed");
    const command = getLegalCommands(initial, "player-one")[0];
    expect(applyCommand(initial, command)).toEqual(
      applyCommand(createBasicGame("replay-seed"), command),
    );
  });
});

describe("basic flag claim", () => {
  it("claims a fully contested flag for the stronger formation", () => {
    const state = createEmptyGameState("claim");
    state.phase = "optional-claims";
    state.eventIndex = 10;
    state.flags[0].sides["player-one"] = {
      cards: ["troop-red-3", "troop-red-4", "troop-red-5"],
      completedAtEvent: 6,
    };
    state.flags[0].sides["player-two"] = {
      cards: ["troop-blue-2", "troop-green-5", "troop-purple-9"],
      completedAtEvent: 9,
    };
    const next = applyCommand(state, {
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    expect(next.flags[0].owner).toBe("player-one");
    expect(next.phase).toBe("optional-claims");
  });

  it("rejects an unproven early claim with a stable error", () => {
    const state = createEmptyGameState("early");
    state.phase = "optional-claims";
    state.flags[0].sides["player-one"] = {
      cards: ["troop-red-3", "troop-red-4", "troop-red-5"],
      completedAtEvent: 3,
    };
    const error = validateCommand(state, {
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    expect(error?.code).toBe("CLAIM_NOT_PROVEN");
    expect(error?.details?.witness).toBeDefined();
  });
});
