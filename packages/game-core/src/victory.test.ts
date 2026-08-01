import { describe, expect, it } from "vitest";
import { createEmptyGameState } from "./factories";
import { buildGameSummary, detectVictory } from "./victory";

describe("detectVictory", () => {
  it("detects three adjacent flags before five total", () => {
    const flags = createEmptyGameState().flags;
    for (const id of [3, 4, 5]) flags[id].owner = "player-one";
    expect(detectVictory(flags, "player-one")?.condition).toBe("breakthrough");
  });

  it("detects five non-adjacent flags", () => {
    const flags = createEmptyGameState().flags;
    for (const id of [0, 2, 4, 6, 8]) flags[id].owner = "player-two";
    expect(detectVictory(flags, "player-two")?.condition).toBe("envelopment");
  });

  it("uses breakthrough as the stable priority when both conditions exist", () => {
    const flags = createEmptyGameState().flags;
    for (const id of [0, 2, 3, 4, 8]) flags[id].owner = "player-one";
    expect(detectVictory(flags, "player-one")).toEqual({
      player: "player-one",
      condition: "breakthrough",
    });
  });

  it("builds a detached, JSON-serializable final summary", () => {
    const state = createEmptyGameState("summary-seed");
    for (const id of [2, 3, 4]) state.flags[id].owner = "player-two";
    state.phase = "finished";
    state.winner = { player: "player-two", condition: "breakthrough" };
    state.turn = 18;
    const summary = buildGameSummary(state);
    expect(summary).toMatchObject({
      schemaVersion: 1,
      rulesVersion: 1,
      seed: "summary-seed",
      winner: "player-two",
      condition: "breakthrough",
      winningFlags: [2, 3, 4],
      turns: 18,
    });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.claimedFlags["player-two"])).toBe(true);
    expect(state.flags[8].owner).toBeUndefined();
  });

  it("rejects a summary before the game has finished", () => {
    expect(() => buildGameSummary(createEmptyGameState())).toThrow(
      "requires a finished game",
    );
  });
});
