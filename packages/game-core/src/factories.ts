import { createTroopDeck } from "./cards";
import { createSeededRandom, shuffle } from "./random";
import type { FlagState, GameEvent, GameState, PlayerId } from "./types";

type NewGameEvent = GameEvent extends infer Event
  ? Event extends GameEvent
    ? Omit<Event, "index">
    : never
  : never;

const emptySide = () => ({ cards: [] });

const createFlag = (id: number): FlagState => ({
  id,
  capacity: 3,
  sides: {
    "player-one": emptySide(),
    "player-two": emptySide(),
  },
});

export function createEmptyGameState(
  seed = "development-seed",
  activePlayer: PlayerId = "player-one",
): GameState {
  return {
    version: 1,
    seed,
    phase: "setup",
    activePlayer,
    players: {
      "player-one": { hand: [], playedTacticsCount: 0 },
      "player-two": { hand: [], playedTacticsCount: 0 },
    },
    flags: Array.from({ length: 9 }, (_, id) => createFlag(id)),
    troopDeck: [],
    tacticDeck: [],
    troopDiscard: [],
    tacticDiscard: [],
    cardUniverse: [],
    eventIndex: 0,
    turn: 0,
    events: [],
  };
}

function addInitialEvent(state: GameState, event: NewGameEvent): void {
  state.eventIndex += 1;
  state.events.push({ ...event, index: state.eventIndex } as GameEvent);
}

export function createBasicGame(
  seed = "development-seed",
  firstPlayer: PlayerId = "player-one",
): GameState {
  const state = createEmptyGameState(seed, firstPlayer);
  const random = createSeededRandom(`${seed}:troops`);
  state.troopDeck = shuffle(createTroopDeck(), random);
  state.cardUniverse = [...state.troopDeck];

  for (let round = 0; round < 7; round += 1) {
    state.players["player-one"].hand.push(state.troopDeck.pop()!);
    state.players["player-two"].hand.push(state.troopDeck.pop()!);
  }

  state.phase = "play-card";
  state.turn = 1;
  addInitialEvent(state, { type: "game-started", seed, firstPlayer });
  addInitialEvent(state, {
    type: "turn-started",
    player: firstPlayer,
    turn: 1,
  });
  return state;
}
