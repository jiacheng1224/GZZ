import { describe, expect, it } from "vitest";
import { applyCommand, getLegalCommands, validateCommand } from "./engine";
import { createEmptyGameState } from "./factories";
import type { CardId, GameState } from "./types";

function guileState(tacticId: CardId): GameState {
  const state = createEmptyGameState(`fixture:${tacticId}`);
  state.phase = "play-card";
  state.turn = 1;
  state.players["player-one"].hand.push(tacticId);
  return state;
}

function play(state: GameState, cardId: CardId): GameState {
  return applyCommand(state, {
    type: "play-tactic",
    player: "player-one",
    cardId,
  });
}

describe("Scout", () => {
  it("offers only the draw sequence that the remaining decks can satisfy", () => {
    const initial = guileState("tactic-scout");
    initial.tacticDeck.push("tactic-fog", "tactic-mud", "tactic-traitor");
    const legal = getLegalCommands(play(initial, "tactic-scout"), "player-one");
    expect(
      legal.filter((command) => command.type === "choose-scout-draw"),
    ).toEqual([
      {
        type: "choose-scout-draw",
        player: "player-one",
        piles: ["tactic", "tactic", "tactic"],
      },
    ]);
  });

  it("draws three selected cards, returns two by card kind, then resolves", () => {
    const initial = guileState("tactic-scout");
    initial.troopDeck.push("troop-red-1", "troop-red-2");
    initial.tacticDeck.push("tactic-fog", "tactic-mud");

    const pending = play(initial, "tactic-scout");
    expect(pending).toMatchObject({
      phase: "resolve-tactic",
      pendingEffect: { kind: "scout", step: "choose-draw" },
    });
    expect(getLegalCommands(pending, "player-one")).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ type: "claim-flag" }),
        expect.objectContaining({ type: "draw-card" }),
      ]),
    );

    const drawn = applyCommand(pending, {
      type: "choose-scout-draw",
      player: "player-one",
      piles: ["troop", "tactic", "troop"],
    });
    expect(drawn.players["player-one"].hand).toEqual([
      "troop-red-2",
      "tactic-mud",
      "troop-red-1",
    ]);
    expect(drawn.pendingEffect?.step).toBe("choose-return");

    const resolved = applyCommand(drawn, {
      type: "choose-scout-return",
      player: "player-one",
      cardIds: ["troop-red-2", "tactic-mud"],
    });
    expect(resolved.phase).toBe("optional-claims");
    expect(resolved.pendingEffect).toBeUndefined();
    expect(resolved.players["player-one"].hand).toEqual(["troop-red-1"]);
    expect(resolved.troopDeck.at(-1)).toBe("troop-red-2");
    expect(resolved.tacticDeck.at(-1)).toBe("tactic-mud");
    expect(resolved.tacticDiscard).toContain("tactic-scout");
  });

  it("can be cancelled before drawing, but not after drawing", () => {
    const initial = guileState("tactic-scout");
    initial.troopDeck.push("troop-red-1", "troop-red-2", "troop-red-3");
    const pending = play(initial, "tactic-scout");
    const cancelled = applyCommand(pending, {
      type: "cancel-tactic",
      player: "player-one",
    });
    expect(cancelled.phase).toBe("play-card");
    expect(cancelled.players["player-one"].hand).toContain("tactic-scout");
    expect(cancelled.players["player-one"].playedTacticsCount).toBe(0);

    const drawn = applyCommand(pending, {
      type: "choose-scout-draw",
      player: "player-one",
      piles: ["troop", "troop", "troop"],
    });
    expect(
      validateCommand(drawn, {
        type: "cancel-tactic",
        player: "player-one",
      })?.code,
    ).toBe("TACTIC_CANCEL_NOT_ALLOWED");
  });
});

describe("field manipulation guile tactics", () => {
  it.each(["tactic-redeploy", "tactic-deserter", "tactic-traitor"] as const)(
    "hides %s when no legal source exists",
    (tacticId) => {
      const initial = guileState(tacticId);
      expect(getLegalCommands(initial, "player-one")).not.toContainEqual(
        expect.objectContaining({ type: "play-tactic", cardId: tacticId }),
      );
      expect(
        validateCommand(initial, {
          type: "play-tactic",
          player: "player-one",
          cardId: tacticId,
        })?.code,
      ).toBe("NO_LEGAL_TACTIC_TARGET");
    },
  );

  it("Redeploy moves an own formation card and clears source completion", () => {
    const initial = guileState("tactic-redeploy");
    initial.flags[0].sides["player-one"] = {
      cards: ["troop-red-1", "troop-red-2", "troop-red-3"],
      completedAtEvent: 7,
    };
    const selected = applyCommand(play(initial, "tactic-redeploy"), {
      type: "choose-tactic-source",
      player: "player-one",
      flagId: 0,
      cardId: "troop-red-2",
    });
    const resolved = applyCommand(selected, {
      type: "choose-tactic-destination",
      player: "player-one",
      flagId: 1,
    });
    expect(resolved.flags[0].sides["player-one"].cards).not.toContain(
      "troop-red-2",
    );
    expect(
      resolved.flags[0].sides["player-one"].completedAtEvent,
    ).toBeUndefined();
    expect(resolved.flags[1].sides["player-one"].cards).toContain(
      "troop-red-2",
    );
    expect(resolved.tacticDiscard).toContain("tactic-redeploy");
  });

  it("Redeploy can discard an own morale card to the tactic discard", () => {
    const initial = guileState("tactic-redeploy");
    initial.flags[0].sides["player-one"].cards.push("tactic-companion-cavalry");
    const selected = applyCommand(play(initial, "tactic-redeploy"), {
      type: "choose-tactic-source",
      player: "player-one",
      flagId: 0,
      cardId: "tactic-companion-cavalry",
    });
    const resolved = applyCommand(selected, {
      type: "choose-tactic-destination",
      player: "player-one",
      discard: true,
    });
    expect(resolved.tacticDiscard).toEqual(
      expect.arrayContaining(["tactic-companion-cavalry", "tactic-redeploy"]),
    );
  });

  it("Deserter removes an opponent formation card", () => {
    const initial = guileState("tactic-deserter");
    initial.flags[3].sides["player-two"].cards.push("troop-blue-8");
    const resolved = applyCommand(play(initial, "tactic-deserter"), {
      type: "choose-tactic-source",
      player: "player-one",
      flagId: 3,
      cardId: "troop-blue-8",
    });
    expect(resolved.flags[3].sides["player-two"].cards).toEqual([]);
    expect(resolved.troopDiscard).toContain("troop-blue-8");
    expect(resolved.phase).toBe("optional-claims");
  });

  it("Traitor transfers only an opponent troop to an open own side", () => {
    const initial = guileState("tactic-traitor");
    initial.flags[2].sides["player-two"].cards.push(
      "troop-purple-10",
      "tactic-shield-bearers",
    );
    const pending = play(initial, "tactic-traitor");
    expect(getLegalCommands(pending, "player-one")).not.toContainEqual(
      expect.objectContaining({ cardId: "tactic-shield-bearers" }),
    );
    const selected = applyCommand(pending, {
      type: "choose-tactic-source",
      player: "player-one",
      flagId: 2,
      cardId: "troop-purple-10",
    });
    const resolved = applyCommand(selected, {
      type: "choose-tactic-destination",
      player: "player-one",
      flagId: 4,
    });
    expect(resolved.flags[2].sides["player-two"].cards).not.toContain(
      "troop-purple-10",
    );
    expect(resolved.flags[4].sides["player-one"].cards).toContain(
      "troop-purple-10",
    );
  });

  it("does not offer a full or claimed destination", () => {
    const initial = guileState("tactic-traitor");
    initial.flags[0].sides["player-two"].cards.push("troop-blue-5");
    initial.flags[1].sides["player-one"].cards.push(
      "troop-red-1",
      "troop-red-2",
      "troop-red-3",
    );
    initial.flags[2].owner = "player-two";
    const selected = applyCommand(play(initial, "tactic-traitor"), {
      type: "choose-tactic-source",
      player: "player-one",
      flagId: 0,
      cardId: "troop-blue-5",
    });
    const legal = getLegalCommands(selected, "player-one");
    expect(legal).not.toContainEqual(expect.objectContaining({ flagId: 1 }));
    expect(legal).not.toContainEqual(expect.objectContaining({ flagId: 2 }));
    expect(
      validateCommand(selected, {
        type: "choose-tactic-destination",
        player: "player-one",
        flagId: 1,
      })?.code,
    ).toBe("INVALID_TACTIC_SELECTION");
  });

  it("does not allow cancellation after a source has been selected", () => {
    const initial = guileState("tactic-redeploy");
    initial.flags[0].sides["player-one"].cards.push("troop-orange-6");
    const selected = applyCommand(play(initial, "tactic-redeploy"), {
      type: "choose-tactic-source",
      player: "player-one",
      flagId: 0,
      cardId: "troop-orange-6",
    });
    expect(
      validateCommand(selected, {
        type: "cancel-tactic",
        player: "player-one",
      })?.code,
    ).toBe("TACTIC_CANCEL_NOT_ALLOWED");
  });

  it("rejects a destination command before selecting a source", () => {
    const initial = guileState("tactic-redeploy");
    initial.flags[0].sides["player-one"].cards.push("troop-green-4");
    expect(
      validateCommand(play(initial, "tactic-redeploy"), {
        type: "choose-tactic-destination",
        player: "player-one",
        flagId: 1,
      })?.code,
    ).toBe("INVALID_TACTIC_STEP");
  });
});
