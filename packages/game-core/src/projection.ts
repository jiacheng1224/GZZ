import { getLegalCommands } from "./engine";
import {
  PLAYER_IDS,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerView,
  type ProjectedGameEvent,
  type ProjectedPendingEffect,
  type PublicGameView,
  type ReplayAccess,
  type ReplayView,
  type SpectatorView,
} from "./types";

const clone = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;

function canSeePrivateEvent(
  viewer: PlayerId | undefined,
  event: { player: PlayerId },
): boolean {
  return viewer === event.player;
}

function projectEvent(event: GameEvent, viewer?: PlayerId): ProjectedGameEvent {
  if (event.type === "game-started") {
    return {
      index: event.index,
      type: event.type,
      firstPlayer: event.firstPlayer,
    };
  }
  if (event.type === "scout-drawn") {
    return {
      index: event.index,
      type: event.type,
      player: event.player,
      cardCount: event.cards.length,
      piles: [...event.piles],
      ...(canSeePrivateEvent(viewer, event) ? { cards: [...event.cards] } : {}),
    };
  }
  if (event.type === "scout-returned") {
    return {
      index: event.index,
      type: event.type,
      player: event.player,
      cardCount: event.cards.length,
      ...(canSeePrivateEvent(viewer, event) ? { cards: [...event.cards] } : {}),
    };
  }
  if (event.type === "card-drawn") {
    return {
      index: event.index,
      type: event.type,
      player: event.player,
      pile: event.pile,
      ...(canSeePrivateEvent(viewer, event) ? { cardId: event.cardId } : {}),
    };
  }
  return clone(event);
}

function projectPendingEffect(
  state: GameState,
  viewer?: PlayerId,
): ProjectedPendingEffect | undefined {
  const pending = state.pendingEffect;
  if (!pending) return undefined;
  const { drawnCards, ...visible } = pending;
  return {
    ...clone(visible),
    ...(drawnCards ? { drawnCardCount: drawnCards.length } : {}),
    ...(drawnCards && viewer === pending.actor
      ? { drawnCards: [...drawnCards] }
      : {}),
  };
}

function projectPublicState(
  state: GameState,
  viewer?: PlayerId,
): PublicGameView {
  return {
    projectionVersion: 1,
    stateVersion: state.version,
    phase: state.phase,
    activePlayer: state.activePlayer,
    players: Object.fromEntries(
      PLAYER_IDS.map((player) => [
        player,
        {
          handCount: state.players[player].hand.length,
          playedTacticsCount: state.players[player].playedTacticsCount,
          hasPlayedLeader: state.players[player].hasPlayedLeader,
        },
      ]),
    ) as PublicGameView["players"],
    flags: clone(state.flags),
    decks: {
      troop: state.troopDeck.length,
      tactic: state.tacticDeck.length,
    },
    troopDiscard: [...state.troopDiscard],
    tacticDiscard: [...state.tacticDiscard],
    ...(state.pendingEffect
      ? { pendingEffect: projectPendingEffect(state, viewer) }
      : {}),
    eventIndex: state.eventIndex,
    turn: state.turn,
    events: state.events.map((event) => projectEvent(event, viewer)),
    ...(state.winner ? { winner: clone(state.winner) } : {}),
  };
}

export function projectForPlayer(
  state: GameState,
  player: PlayerId,
): PlayerView {
  return {
    audience: "player",
    viewer: player,
    ...projectPublicState(state, player),
    hand: [...state.players[player].hand],
    legalCommands: clone(getLegalCommands(state, player)),
  };
}

export function projectForSpectator(state: GameState): SpectatorView {
  return {
    audience: "spectator",
    ...projectPublicState(state),
  };
}

export function projectForReplay(
  state: GameState,
  access: ReplayAccess,
): ReplayView {
  if (access.mode === "omniscient") {
    return {
      audience: "replay",
      access: "omniscient",
      snapshot: clone(state),
    };
  }
  if (access.mode === "player") {
    return {
      audience: "replay",
      access: "player",
      viewer: access.player,
      snapshot: projectForPlayer(state, access.player),
    };
  }
  return {
    audience: "replay",
    access: "public",
    snapshot: projectForSpectator(state),
  };
}
