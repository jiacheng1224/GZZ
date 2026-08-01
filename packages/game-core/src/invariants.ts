import { isTroopCard } from "./cards";
import { isEnvironment, isMorale } from "./tactics";
import { PLAYER_IDS, type CardId, type GameState } from "./types";

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

function collectCardLocations(state: GameState): Array<[CardId, string]> {
  const locations: Array<[CardId, string]> = [];
  const add = (cards: CardId[], location: string) => {
    cards.forEach((card) => locations.push([card, location]));
  };

  add(state.troopDeck, "troop-deck");
  add(state.tacticDeck, "tactic-deck");
  add(state.troopDiscard, "troop-discard");
  add(state.tacticDiscard, "tactic-discard");

  for (const playerId of PLAYER_IDS)
    add(state.players[playerId].hand, `${playerId}.hand`);
  for (const flag of state.flags) {
    add(flag.environment, `flag-${flag.id}.environment`);
    for (const playerId of PLAYER_IDS) {
      add(flag.sides[playerId].cards, `flag-${flag.id}.${playerId}`);
    }
  }
  if (state.pendingEffect)
    add([state.pendingEffect.tacticId], "pending-effect");
  return locations;
}

export function assertGameState(state: GameState): void {
  if (state.flags.length !== 9)
    throw new InvariantError(
      `Expected 9 flags, received ${state.flags.length}.`,
    );
  if (!Number.isInteger(state.eventIndex) || state.eventIndex < 0) {
    throw new InvariantError("eventIndex must be a non-negative integer.");
  }
  if (!Number.isInteger(state.turn) || state.turn < 0) {
    throw new InvariantError("turn must be a non-negative integer.");
  }
  if (
    state.events.at(-1)?.index !== state.eventIndex &&
    state.events.length > 0
  ) {
    throw new InvariantError("eventIndex must match the last event.");
  }

  const flagIds = new Set<number>();
  for (const flag of state.flags) {
    if (flag.id < 0 || flag.id > 8 || flagIds.has(flag.id)) {
      throw new InvariantError(`Flag id ${flag.id} is invalid or duplicated.`);
    }
    flagIds.add(flag.id);
    for (const playerId of PLAYER_IDS) {
      if (flag.sides[playerId].cards.length > flag.capacity) {
        throw new InvariantError(
          `Flag ${flag.id} exceeds capacity for ${playerId}.`,
        );
      }
      if (
        flag.sides[playerId].cards.some(
          (card) => !isTroopCard(card) && !isMorale(card),
        )
      ) {
        throw new InvariantError(
          `Flag ${flag.id} contains a card that cannot join a formation.`,
        );
      }
    }
    if (flag.environment.some((card) => !isEnvironment(card))) {
      throw new InvariantError(
        `Flag ${flag.id} contains an invalid environment card.`,
      );
    }
    if (flag.capacity === 4 && !flag.environment.includes("tactic-mud")) {
      throw new InvariantError(`Flag ${flag.id} has capacity 4 without Mud.`);
    }
  }

  const seen = new Map<CardId, string>();
  for (const [card, location] of collectCardLocations(state)) {
    const previous = seen.get(card);
    if (previous)
      throw new InvariantError(
        `Card ${card} appears in both ${previous} and ${location}.`,
      );
    seen.set(card, location);
  }

  if (new Set(state.cardUniverse).size !== state.cardUniverse.length) {
    throw new InvariantError("cardUniverse contains duplicate card ids.");
  }
  if (state.cardUniverse.length > 0) {
    const missing = state.cardUniverse.filter((card) => !seen.has(card));
    const unknown = [...seen.keys()].filter(
      (card) => !state.cardUniverse.includes(card),
    );
    if (missing.length || unknown.length) {
      throw new InvariantError(
        `Card conservation failed: ${missing.length} missing, ${unknown.length} unknown.`,
      );
    }
  }

  if (state.phase === "finished" && !state.winner)
    throw new InvariantError("A finished game must have a winner.");
  if (state.phase !== "finished" && state.winner)
    throw new InvariantError("A running game cannot already have a winner.");
  if (state.phase === "resolve-tactic" && !state.pendingEffect)
    throw new InvariantError("resolve-tactic requires a pending effect.");
  if (state.phase !== "resolve-tactic" && state.pendingEffect)
    throw new InvariantError("A pending effect requires resolve-tactic phase.");
}
