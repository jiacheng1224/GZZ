import { buildGameSummary } from "./victory";
import {
  PLAYER_IDS,
  type GameReview,
  type GameReviewPlayerStats,
  type GameState,
  type PlayerId,
} from "./types";

const otherPlayer = (player: PlayerId): PlayerId =>
  player === "player-one" ? "player-two" : "player-one";

export function buildGameReview(state: GameState): GameReview {
  const summary = buildGameSummary(state);
  const players = Object.fromEntries(
    PLAYER_IDS.map((player) => [
      player,
      {
        troopDeployments: 0,
        tacticsPlayed: 0,
        cardsDrawn: 0,
        flagsClaimed: 0,
      },
    ]),
  ) as Record<PlayerId, GameReviewPlayerStats>;
  const claims = { "player-one": 0, "player-two": 0 } satisfies Record<
    PlayerId,
    number
  >;
  let firstClaim: GameReview["firstClaim"];
  let decisiveClaim: GameReview["decisiveClaim"] | undefined;
  let lastNonTieLeader: PlayerId | undefined;
  let leadChanges = 0;
  let winnerCameBack = false;

  for (const event of state.events) {
    if (event.type === "troop-played") {
      players[event.player] = {
        ...players[event.player],
        troopDeployments: players[event.player].troopDeployments + 1,
      };
    } else if (event.type === "tactic-played") {
      players[event.player] = {
        ...players[event.player],
        tacticsPlayed: players[event.player].tacticsPlayed + 1,
      };
    } else if (event.type === "card-drawn") {
      players[event.player] = {
        ...players[event.player],
        cardsDrawn: players[event.player].cardsDrawn + 1,
      };
    } else if (event.type === "scout-drawn") {
      players[event.player] = {
        ...players[event.player],
        cardsDrawn: players[event.player].cardsDrawn + event.cards.length,
      };
    } else if (event.type === "flag-claimed") {
      const moment = {
        eventIndex: event.index,
        player: event.player,
        flagId: event.flagId,
      };
      firstClaim ??= moment;
      if (event.player === summary.winner) decisiveClaim = moment;
      claims[event.player] += 1;
      players[event.player] = {
        ...players[event.player],
        flagsClaimed: players[event.player].flagsClaimed + 1,
      };
      if (claims[otherPlayer(summary.winner)] > claims[summary.winner]) {
        winnerCameBack = true;
      }
      const leader =
        claims["player-one"] === claims["player-two"]
          ? undefined
          : claims["player-one"] > claims["player-two"]
            ? "player-one"
            : "player-two";
      if (leader && lastNonTieLeader && leader !== lastNonTieLeader) {
        leadChanges += 1;
      }
      if (leader) lastNonTieLeader = leader;
    }
  }

  if (!decisiveClaim) {
    throw new Error("Finished game is missing the winner's decisive claim.");
  }
  return {
    schemaVersion: 1,
    players,
    ...(firstClaim ? { firstClaim } : {}),
    decisiveClaim,
    leadChanges,
    winnerCameBack,
  };
}
