import { createTroopDeck, isTroopCard } from "./cards";
import { compareCompletedSides, evaluateFormation } from "./formations";
import {
  PLAYER_IDS,
  type CardId,
  type ClaimResult,
  type Formation,
  type FormationOptions,
  type GameState,
  type PlayerId,
  type PublicKnowledge,
} from "./types";

const otherPlayer = (player: PlayerId): PlayerId =>
  player === "player-one" ? "player-two" : "player-one";

export function buildPublicKnowledge(state: GameState): PublicKnowledge {
  const visibleTroops: CardId[] = [...state.troopDiscard];
  for (const flag of state.flags) {
    for (const player of PLAYER_IDS) {
      visibleTroops.push(...flag.sides[player].cards);
    }
  }
  const troopOnly = visibleTroops.filter(isTroopCard);
  const visibleSet = new Set(troopOnly);
  return {
    visibleTroops: troopOnly,
    possibleTroops: createTroopDeck().filter(
      (cardId) => !visibleSet.has(cardId),
    ),
  };
}

export function canFormationBeat(
  challenger: Formation,
  incumbent: Formation,
): boolean {
  return (
    challenger.strength > incumbent.strength ||
    (challenger.strength === incumbent.strength &&
      challenger.total > incumbent.total)
  );
}

function findWinningCompletion(
  existingCards: readonly CardId[],
  availableCards: readonly CardId[],
  required: number,
  incumbent: Formation,
  options: FormationOptions,
): { witness?: CardId[]; formation?: Formation; checked: number } {
  let checked = 0;
  const chosen: CardId[] = [];

  const visit = (
    start: number,
  ): { witness: CardId[]; formation: Formation } | undefined => {
    if (chosen.length === required) {
      checked += 1;
      const formation = evaluateFormation(
        [...existingCards, ...chosen],
        options,
      );
      return canFormationBeat(formation, incumbent)
        ? { witness: [...chosen], formation }
        : undefined;
    }

    const remaining = required - chosen.length;
    for (
      let index = start;
      index <= availableCards.length - remaining;
      index += 1
    ) {
      chosen.push(availableCards[index]);
      const result = visit(index + 1);
      chosen.pop();
      if (result) return result;
    }
    return undefined;
  };

  const result = visit(0);
  return { ...result, checked };
}

export function evaluateClaim(
  state: GameState,
  claimant: PlayerId,
  flagId: number,
): ClaimResult {
  const flag = state.flags.find((item) => item.id === flagId);
  if (!flag) throw new RangeError(`Flag ${flagId} does not exist.`);
  if (flag.owner) {
    return {
      allowed: false,
      reason: "FLAG_ALREADY_CLAIMED",
      combinationsChecked: 0,
    };
  }

  const claimantSide = flag.sides[claimant];
  if (claimantSide.cards.length !== flag.capacity) {
    return {
      allowed: false,
      reason: "CLAIMANT_FORMATION_INCOMPLETE",
      combinationsChecked: 0,
    };
  }

  const options = { fog: flag.environment.includes("tactic-fog") };
  const claimantFormation = evaluateFormation(claimantSide.cards, options);
  const opponentSide = flag.sides[otherPlayer(claimant)];
  if (opponentSide.cards.length === flag.capacity) {
    const opponentFormation = evaluateFormation(opponentSide.cards, options);
    const allowed =
      compareCompletedSides(claimantSide, opponentSide, options) > 0;
    return {
      allowed,
      reason: allowed ? "CLAIMANT_FORMATION_WINS" : "OPPONENT_FORMATION_WINS",
      claimantFormation,
      opponentFormation,
      combinationsChecked: 1,
    };
  }

  const required = flag.capacity - opponentSide.cards.length;
  const publicKnowledge = buildPublicKnowledge(state);
  const counter = findWinningCompletion(
    opponentSide.cards,
    publicKnowledge.possibleTroops,
    required,
    claimantFormation,
    options,
  );

  if (counter.witness) {
    return {
      allowed: false,
      reason: "OPPONENT_CAN_WIN",
      witness: counter.witness,
      claimantFormation,
      opponentFormation: counter.formation,
      combinationsChecked: counter.checked,
    };
  }
  return {
    allowed: true,
    reason: "NO_POSSIBLE_COUNTER",
    claimantFormation,
    combinationsChecked: counter.checked,
  };
}
