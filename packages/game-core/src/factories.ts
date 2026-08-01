import { createTroopDeck } from "./cards";
import { createSeededRandom, shuffle } from "./random";
import { createTacticDeck } from "./tactics";
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
  environment: [],
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
      "player-one": { hand: [], playedTacticsCount: 0, hasPlayedLeader: false },
      "player-two": { hand: [], playedTacticsCount: 0, hasPlayedLeader: false },
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

export function createStandardGame(
  seed = "development-seed",
  firstPlayer: PlayerId = "player-one",
): GameState {
  const state = createBasicGame(seed, firstPlayer);
  state.tacticDeck = shuffle(
    createTacticDeck(),
    createSeededRandom(`${seed}:tactics`),
  );
  state.cardUniverse.push(...state.tacticDeck);
  return state;
}

export function createGuidedGame(
  seed = "guided-first-flag",
  firstPlayer: PlayerId = "player-one",
): GameState {
  const state = createEmptyGameState(seed, firstPlayer);
  const opponent: PlayerId =
    firstPlayer === "player-one" ? "player-two" : "player-one";
  const actorFormation = ["troop-red-8", "troop-red-9"];
  const opponentFormation = ["troop-blue-1", "troop-blue-3"];
  const actorHand = [
    "troop-red-10",
    "troop-orange-1",
    "troop-orange-2",
    "troop-orange-3",
    "troop-orange-4",
    "troop-orange-5",
    "troop-orange-6",
  ];
  const opponentHand = [
    "troop-green-1",
    "troop-green-2",
    "troop-green-3",
    "troop-green-4",
    "troop-green-5",
    "troop-green-6",
    "troop-green-7",
  ];
  const reserved = new Set([
    ...actorFormation,
    ...opponentFormation,
    ...actorHand,
    ...opponentHand,
  ]);

  state.cardUniverse = createTroopDeck();
  state.troopDeck = shuffle(
    state.cardUniverse.filter((cardId) => !reserved.has(cardId)),
    createSeededRandom(`${seed}:guided-rest`),
  );
  state.players[firstPlayer].hand = actorHand;
  state.players[opponent].hand = opponentHand;
  state.flags[0].sides[firstPlayer].cards = actorFormation;
  state.flags[0].sides[opponent].cards = opponentFormation;
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
