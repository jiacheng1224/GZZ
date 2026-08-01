import { describe, expect, it } from "vitest";
import { createStandardGame } from "./factories";
import {
  projectForPlayer,
  projectForReplay,
  projectForSpectator,
} from "./projection";
import type { GameState } from "./types";

function projectionFixture(): GameState {
  const state = createStandardGame("projection-secret-seed");
  const ownDraw = state.players["player-one"].hand[0];
  const opponentDraw = state.players["player-two"].hand[0];
  state.events.push(
    {
      index: 3,
      type: "card-drawn",
      player: "player-one",
      cardId: ownDraw,
      pile: "troop",
    },
    {
      index: 4,
      type: "card-drawn",
      player: "player-two",
      cardId: opponentDraw,
      pile: "troop",
    },
    {
      index: 5,
      type: "scout-drawn",
      player: "player-two",
      cards: [opponentDraw, "tactic-fog", "troop-purple-10"],
      piles: ["troop", "tactic", "troop"],
    },
    {
      index: 6,
      type: "scout-returned",
      player: "player-two",
      cards: [opponentDraw, "tactic-fog"],
    },
  );
  state.eventIndex = 6;
  return state;
}

describe("player projection", () => {
  it("exposes only the viewer hand and redacts opponent private events", () => {
    const state = projectionFixture();
    const ownSecret = state.players["player-one"].hand[0];
    const opponentSecret = state.players["player-two"].hand[0];
    const deckSecret = state.troopDeck[0];
    const view = projectForPlayer(state, "player-one");
    const serialized = JSON.stringify(view);

    expect(view.hand).toEqual(state.players["player-one"].hand);
    expect(view.players["player-two"].handCount).toBe(7);
    expect(serialized).toContain(ownSecret);
    expect(serialized).not.toContain(opponentSecret);
    expect(serialized).not.toContain(deckSecret);
    expect(serialized).not.toContain(state.seed);
    expect(view).not.toHaveProperty("seed");
    expect(view).not.toHaveProperty("cardUniverse");
    expect(view).not.toHaveProperty("troopDeck");
    expect(view).not.toHaveProperty("tacticDeck");

    const ownEvent = view.events.find(
      (event) => event.type === "card-drawn" && event.player === "player-one",
    );
    const opponentEvent = view.events.find(
      (event) => event.type === "card-drawn" && event.player === "player-two",
    );
    expect(ownEvent).toHaveProperty("cardId", ownSecret);
    expect(opponentEvent).not.toHaveProperty("cardId");
  });

  it("shows Scout private choices only to the acting player", () => {
    const state = createStandardGame("pending-scout");
    const drawnCards = ["troop-red-1", "tactic-fog", "troop-blue-2"];
    state.phase = "resolve-tactic";
    state.activePlayer = "player-two";
    state.pendingEffect = {
      tacticId: "tactic-scout",
      kind: "scout",
      step: "choose-return",
      actor: "player-two",
      drawnCards,
    };

    const actorView = projectForPlayer(state, "player-two");
    const opponentView = projectForPlayer(state, "player-one");
    expect(actorView.pendingEffect).toMatchObject({
      drawnCardCount: 3,
      drawnCards,
    });
    expect(opponentView.pendingEffect).toMatchObject({ drawnCardCount: 3 });
    expect(opponentView.pendingEffect).not.toHaveProperty("drawnCards");
    expect(opponentView.legalCommands).toEqual([]);
  });

  it("returns detached DTO data rather than references into GameState", () => {
    const state = createStandardGame("detached-view");
    state.flags[0].sides["player-one"].cards.push("troop-red-1");
    const view = projectForPlayer(state, "player-one");
    view.flags[0].sides["player-one"].cards.push("troop-red-2");
    view.hand.length = 0;
    expect(state.flags[0].sides["player-one"].cards).toEqual(["troop-red-1"]);
    expect(state.players["player-one"].hand).toHaveLength(7);
  });
});

describe("spectator and replay projection", () => {
  it("produces a stable public snapshot with counts instead of hidden arrays", () => {
    const state = projectionFixture();
    const view = projectForSpectator(state);
    expect({
      audience: view.audience,
      projectionVersion: view.projectionVersion,
      stateVersion: view.stateVersion,
      phase: view.phase,
      activePlayer: view.activePlayer,
      handCounts: {
        one: view.players["player-one"].handCount,
        two: view.players["player-two"].handCount,
      },
      decks: view.decks,
      firstEvent: view.events[0],
    }).toMatchInlineSnapshot(`
      {
        "activePlayer": "player-one",
        "audience": "spectator",
        "decks": {
          "tactic": 10,
          "troop": 46,
        },
        "firstEvent": {
          "firstPlayer": "player-one",
          "index": 1,
          "type": "game-started",
        },
        "handCounts": {
          "one": 7,
          "two": 7,
        },
        "phase": "play-card",
        "projectionVersion": 1,
        "stateVersion": 1,
      }
    `);
    const serialized = JSON.stringify(view);
    for (const cardId of [
      ...state.players["player-one"].hand,
      ...state.players["player-two"].hand,
      ...state.troopDeck,
      ...state.tacticDeck,
    ]) {
      expect(serialized).not.toContain(cardId);
    }
    expect(serialized).not.toContain(state.seed);
  });

  it("requires explicit replay access for hidden information", () => {
    const state = projectionFixture();
    const publicReplay = projectForReplay(state, { mode: "public" });
    const playerReplay = projectForReplay(state, {
      mode: "player",
      player: "player-one",
    });
    const omniscientReplay = projectForReplay(state, { mode: "omniscient" });

    expect(JSON.stringify(publicReplay)).not.toContain(state.seed);
    expect(JSON.stringify(playerReplay)).not.toContain(
      state.players["player-two"].hand[0],
    );
    expect(omniscientReplay.snapshot).toEqual(state);
    expect(omniscientReplay.snapshot).not.toBe(state);
  });
});
