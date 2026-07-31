import { describe, expect, it } from "vitest";
import { createEmptyGameState } from "./factories";
import { assertGameState, InvariantError } from "./invariants";

describe("assertGameState", () => {
  it("accepts the R0 empty game state", () => {
    const state = createEmptyGameState("fixed-seed");

    expect(() => assertGameState(state)).not.toThrow();
    expect(state.flags).toHaveLength(9);
  });

  it("rejects a card that exists in two zones", () => {
    const state = createEmptyGameState();
    state.troopDeck.push("troop-red-1");
    state.players["player-one"].hand.push("troop-red-1");

    expect(() => assertGameState(state)).toThrow(InvariantError);
    expect(() => assertGameState(state)).toThrow(/appears in both/);
  });

  it("rejects a side that exceeds its flag capacity", () => {
    const state = createEmptyGameState();
    state.flags[0].sides["player-one"].cards.push("a", "b", "c", "d");

    expect(() => assertGameState(state)).toThrow(/exceeds capacity/);
  });
});
