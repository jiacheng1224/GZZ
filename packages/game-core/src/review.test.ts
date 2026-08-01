import { describe, expect, it } from "vitest";
import { createEmptyGameState } from "./factories";
import { buildGameReview } from "./review";

describe("game review", () => {
  it("summarizes player activity and the decisive momentum shift", () => {
    const state = createEmptyGameState("review-summary");
    state.phase = "finished";
    state.turn = 14;
    state.winner = { player: "player-one", condition: "breakthrough" };
    state.flags[2].owner = "player-one";
    state.flags[3].owner = "player-one";
    state.flags[4].owner = "player-one";
    state.flags[7].owner = "player-two";
    state.events = [
      {
        index: 1,
        type: "game-started",
        seed: state.seed,
        firstPlayer: "player-one",
      },
      {
        index: 2,
        type: "troop-played",
        player: "player-one",
        cardId: "troop-red-7",
        flagId: 2,
      },
      {
        index: 3,
        type: "tactic-played",
        player: "player-two",
        cardId: "tactic-scout",
      },
      {
        index: 4,
        type: "scout-drawn",
        player: "player-two",
        cards: ["troop-blue-1", "troop-blue-2", "troop-blue-3"],
        piles: ["troop", "troop", "troop"],
      },
      { index: 5, type: "flag-claimed", player: "player-two", flagId: 7 },
      { index: 6, type: "flag-claimed", player: "player-one", flagId: 2 },
      {
        index: 7,
        type: "card-drawn",
        player: "player-one",
        cardId: "troop-green-4",
        pile: "troop",
      },
      { index: 8, type: "flag-claimed", player: "player-one", flagId: 3 },
      { index: 9, type: "flag-claimed", player: "player-one", flagId: 4 },
      {
        index: 10,
        type: "game-won",
        player: "player-one",
        condition: "breakthrough",
      },
    ];
    state.eventIndex = state.events.length;

    expect(buildGameReview(state)).toEqual({
      schemaVersion: 1,
      players: {
        "player-one": {
          troopDeployments: 1,
          tacticsPlayed: 0,
          cardsDrawn: 1,
          flagsClaimed: 3,
        },
        "player-two": {
          troopDeployments: 0,
          tacticsPlayed: 1,
          cardsDrawn: 3,
          flagsClaimed: 1,
        },
      },
      firstClaim: { eventIndex: 5, player: "player-two", flagId: 7 },
      decisiveClaim: { eventIndex: 9, player: "player-one", flagId: 4 },
      leadChanges: 1,
      winnerCameBack: true,
    });
  });

  it("rejects unfinished games", () => {
    expect(() => buildGameReview(createEmptyGameState())).toThrow(
      "A game summary requires a finished game.",
    );
  });
});
