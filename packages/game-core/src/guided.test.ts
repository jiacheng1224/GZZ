import { describe, expect, it } from "vitest";
import { applyCommand, getLegalCommands } from "./engine";
import { createGuidedGame } from "./factories";
import { assertGameState } from "./invariants";

describe("guided first-flag game", () => {
  it("creates a deterministic, conserved no-tactic position", () => {
    const first = createGuidedGame("guided-fixture");
    const second = createGuidedGame("guided-fixture");
    expect(first).toEqual(second);
    expect(first.tacticDeck).toHaveLength(0);
    expect(first.players["player-one"].hand).toContain("troop-red-10");
    expect(first.flags[0].sides["player-one"].cards).toEqual([
      "troop-red-8",
      "troop-red-9",
    ]);
    expect(() => assertGameState(first)).not.toThrow();
  });

  it("teaches a legal deployment followed by an early claim", () => {
    const initial = createGuidedGame("guided-claim");
    const deployed = applyCommand(initial, {
      type: "play-troop",
      player: "player-one",
      cardId: "troop-red-10",
      flagId: 0,
    });
    expect(getLegalCommands(deployed, "player-one")).toContainEqual({
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    const claimed = applyCommand(deployed, {
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    expect(claimed.flags[0].owner).toBe("player-one");
    expect(() => assertGameState(claimed)).not.toThrow();
  });
});
