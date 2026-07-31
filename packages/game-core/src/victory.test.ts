import { describe, expect, it } from "vitest";
import { createEmptyGameState } from "./factories";
import { detectVictory } from "./victory";

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
});
