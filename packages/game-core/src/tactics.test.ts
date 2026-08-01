import { describe, expect, it } from "vitest";
import { applyCommand, getLegalCommands, validateCommand } from "./engine";
import { createEmptyGameState, createStandardGame } from "./factories";
import { compareCompletedSides, evaluateFormation } from "./formations";
import { createTacticDeck, listTactics } from "./tactics";
import type { CardId, GameState } from "./types";

const cards = (...ids: string[]): CardId[] => ids.map((id) => `troop-${id}`);

function tacticState(cardId: CardId): GameState {
  const state = createEmptyGameState("tactic-fixture");
  state.phase = "play-card";
  state.turn = 1;
  state.players["player-one"].hand.push(cardId);
  return state;
}

describe("tactic registry and deck", () => {
  it("registers exactly ten unique tactics in three categories", () => {
    expect(createTacticDeck()).toHaveLength(10);
    expect(new Set(createTacticDeck())).toHaveLength(10);
    expect(new Set(listTactics().map((card) => card.category))).toEqual(
      new Set(["morale", "environment", "guile"]),
    );
  });

  it("creates a deterministic standard game with separate tactic deck", () => {
    const first = createStandardGame("standard-seed");
    const second = createStandardGame("standard-seed");
    expect(first).toEqual(second);
    expect(first.tacticDeck).toHaveLength(10);
    expect(first.cardUniverse).toHaveLength(70);
    expect(first.players["player-one"].hand).toHaveLength(7);
  });

  it("allows drawing from either non-empty deck", () => {
    const state = createStandardGame("draw-tactic");
    state.phase = "draw-card";
    const legal = getLegalCommands(state, "player-one");
    expect(legal).toContainEqual({
      type: "draw-card",
      player: "player-one",
      pile: "tactic",
    });
    const next = applyCommand(state, {
      type: "draw-card",
      player: "player-one",
      pile: "tactic",
    });
    expect(next.players["player-one"].hand).toHaveLength(8);
    expect(next.tacticDeck).toHaveLength(9);
  });
});

describe("morale formation resolution", () => {
  it("resolves a Leader as any color and value", () => {
    expect(
      evaluateFormation([
        ...cards("red-8", "red-9"),
        "tactic-leader-alexander",
      ]),
    ).toMatchObject({ kind: "wedge", total: 27 });
  });

  it("resolves Companion Cavalry as value 8 in any color", () => {
    expect(
      evaluateFormation([
        ...cards("red-7", "red-9"),
        "tactic-companion-cavalry",
      ]),
    ).toMatchObject({ kind: "wedge", total: 24 });
  });

  it("resolves Shield Bearers as value 1, 2, or 3 in any color", () => {
    expect(
      evaluateFormation([...cards("red-4", "red-5"), "tactic-shield-bearers"]),
    ).toMatchObject({ kind: "wedge", total: 12 });
  });
});

describe("environment tactics", () => {
  it("makes Fog compare only card totals", () => {
    const lowWedge = {
      cards: cards("red-1", "red-2", "red-3"),
      completedAtEvent: 2,
    };
    const highHost = {
      cards: cards("blue-8", "green-9", "purple-10"),
      completedAtEvent: 3,
    };
    expect(compareCompletedSides(lowWedge, highHost)).toBe(1);
    expect(compareCompletedSides(lowWedge, highHost, { fog: true })).toBe(-1);
  });

  it("makes Mud increase both capacities and invalidate three-card completion", () => {
    const state = tacticState("tactic-mud");
    state.flags[0].sides["player-one"] = {
      cards: cards("red-1", "red-2", "red-3"),
      completedAtEvent: 8,
    };
    state.flags[0].sides["player-two"] = {
      cards: cards("blue-1", "green-2", "purple-3"),
      completedAtEvent: 9,
    };
    const next = applyCommand(state, {
      type: "play-tactic",
      player: "player-one",
      cardId: "tactic-mud",
      flagId: 0,
    });
    expect(next.flags[0].capacity).toBe(4);
    expect(next.flags[0].environment).toContain("tactic-mud");
    expect(next.flags[0].sides["player-one"].completedAtEvent).toBeUndefined();
    expect(next.flags[0].sides["player-two"].completedAtEvent).toBeUndefined();
  });
});

describe("tactic command restrictions", () => {
  it("plays a morale tactic into a formation slot", () => {
    const state = tacticState("tactic-companion-cavalry");
    const command = {
      type: "play-tactic" as const,
      player: "player-one" as const,
      cardId: "tactic-companion-cavalry",
      flagId: 0,
    };
    expect(getLegalCommands(state, "player-one")).toContainEqual(command);
    const next = applyCommand(state, command);
    expect(next.flags[0].sides["player-one"].cards).toContain(command.cardId);
    expect(next.players["player-one"].playedTacticsCount).toBe(1);
  });

  it("enforces the one-tactic lead limit", () => {
    const state = tacticState("tactic-fog");
    state.players["player-one"].playedTacticsCount = 1;
    expect(
      validateCommand(state, {
        type: "play-tactic",
        player: "player-one",
        cardId: "tactic-fog",
        flagId: 0,
      })?.code,
    ).toBe("TACTIC_LIMIT_REACHED");
  });

  it("allows only one Leader per player", () => {
    const state = tacticState("tactic-leader-darius");
    state.players["player-one"].hasPlayedLeader = true;
    expect(
      validateCommand(state, {
        type: "play-tactic",
        player: "player-one",
        cardId: "tactic-leader-darius",
        flagId: 0,
      })?.code,
    ).toBe("LEADER_LIMIT_REACHED");
  });

  it("hides a guile tactic when it has no legal effect", () => {
    const state = tacticState("tactic-scout");
    expect(getLegalCommands(state, "player-one")).not.toContainEqual(
      expect.objectContaining({ type: "play-tactic", cardId: "tactic-scout" }),
    );
    expect(
      validateCommand(state, {
        type: "play-tactic",
        player: "player-one",
        cardId: "tactic-scout",
      })?.code,
    ).toBe("NO_LEGAL_TACTIC_TARGET");
  });
});
