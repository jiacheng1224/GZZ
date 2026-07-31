import { describe, expect, it } from "vitest";
import { compareCompletedSides, evaluateFormation } from "./formations";
import type { CardId, FormationKind } from "./types";

const cards = (...ids: string[]): CardId[] => ids.map((id) => `troop-${id}`);

describe.each<[FormationKind, CardId[]]>([
  ["wedge", cards("red-3", "red-4", "red-5")],
  ["phalanx", cards("red-8", "blue-8", "green-8")],
  ["battalion", cards("blue-2", "blue-7", "blue-9")],
  ["skirmish", cards("red-4", "blue-5", "green-6")],
  ["host", cards("red-2", "blue-5", "green-9")],
])("formation %s", (kind, formationCards) => {
  it("classifies the fixture", () =>
    expect(evaluateFormation(formationCards).kind).toBe(kind));
});

describe("formation comparison", () => {
  it("uses category before total", () => {
    const wedge = {
      cards: cards("red-1", "red-2", "red-3"),
      completedAtEvent: 8,
    };
    const phalanx = {
      cards: cards("red-10", "blue-10", "green-10"),
      completedAtEvent: 7,
    };
    expect(compareCompletedSides(wedge, phalanx)).toBe(1);
  });

  it("uses total within a category", () => {
    const high = {
      cards: cards("red-6", "blue-6", "green-6"),
      completedAtEvent: 8,
    };
    const low = {
      cards: cards("red-5", "blue-5", "green-5"),
      completedAtEvent: 7,
    };
    expect(compareCompletedSides(high, low)).toBe(1);
  });

  it("uses the earlier completion event for an exact tie", () => {
    const early = {
      cards: cards("red-1", "blue-5", "green-9"),
      completedAtEvent: 7,
    };
    const late = {
      cards: cards("orange-1", "yellow-5", "purple-9"),
      completedAtEvent: 8,
    };
    expect(compareCompletedSides(early, late)).toBe(1);
  });

  it("supports four-card formations for the future Mud rule", () => {
    expect(
      evaluateFormation(cards("red-3", "red-4", "red-5", "red-6")).kind,
    ).toBe("wedge");
  });
});
