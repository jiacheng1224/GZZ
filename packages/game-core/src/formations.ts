import { parseTroopCard } from "./cards";
import { isLeader } from "./tactics";
import {
  TROOP_COLORS,
  type CardId,
  type FlagSide,
  type Formation,
  type FormationOptions,
  type TroopColor,
} from "./types";

const STRENGTH = {
  host: 1,
  skirmish: 2,
  battalion: 3,
  phalanx: 4,
  wedge: 5,
} as const;

type VirtualTroop = { color: TroopColor; value: number };

function expandCard(cardId: CardId): VirtualTroop[] {
  if (cardId.startsWith("troop-")) {
    const card = parseTroopCard(cardId);
    return [{ color: card.color, value: card.value }];
  }
  if (isLeader(cardId)) {
    return TROOP_COLORS.flatMap((color) =>
      Array.from({ length: 10 }, (_, index) => ({ color, value: index + 1 })),
    );
  }
  if (cardId === "tactic-companion-cavalry") {
    return TROOP_COLORS.map((color) => ({ color, value: 8 }));
  }
  if (cardId === "tactic-shield-bearers") {
    return TROOP_COLORS.flatMap((color) =>
      [1, 2, 3].map((value) => ({ color, value })),
    );
  }
  throw new TypeError(`Card cannot participate in a formation: ${cardId}`);
}

function evaluateConcrete(
  cards: VirtualTroop[],
  options: FormationOptions,
): Formation {
  const values = cards.map((card) => card.value).sort((a, b) => a - b);
  if (options.fog) {
    return {
      kind: "host",
      strength: STRENGTH.host,
      total: values.reduce((sum, value) => sum + value, 0),
      values,
    };
  }
  const sameColor = cards.every((card) => card.color === cards[0].color);
  const sameValue = values.every((value) => value === values[0]);
  const straight = values.every(
    (value, index) => index === 0 || value === values[index - 1] + 1,
  );
  const kind =
    sameColor && straight
      ? "wedge"
      : sameValue
        ? "phalanx"
        : sameColor
          ? "battalion"
          : straight
            ? "skirmish"
            : "host";
  return {
    kind,
    strength: STRENGTH[kind],
    total: values.reduce((sum, value) => sum + value, 0),
    values,
  };
}

function isStronger(left: Formation, right: Formation): boolean {
  return (
    left.strength > right.strength ||
    (left.strength === right.strength && left.total > right.total)
  );
}

export function evaluateFormation(
  cardIds: readonly CardId[],
  options: FormationOptions = {},
): Formation {
  if (cardIds.length !== 3 && cardIds.length !== 4) {
    throw new RangeError("A formation must contain exactly 3 or 4 cards.");
  }

  const choices = cardIds.map(expandCard);
  const selected: VirtualTroop[] = [];
  let best: Formation | undefined;
  const visit = (index: number): void => {
    if (index === choices.length) {
      const result = evaluateConcrete(selected, options);
      if (!best || isStronger(result, best)) best = result;
      return;
    }
    for (const choice of choices[index]) {
      selected.push(choice);
      visit(index + 1);
      selected.pop();
    }
  };
  visit(0);
  return best!;
}

export function compareCompletedSides(
  left: FlagSide,
  right: FlagSide,
  options: FormationOptions = {},
): number {
  const leftFormation = evaluateFormation(left.cards, options);
  const rightFormation = evaluateFormation(right.cards, options);
  if (leftFormation.strength !== rightFormation.strength) {
    return Math.sign(leftFormation.strength - rightFormation.strength);
  }
  if (leftFormation.total !== rightFormation.total) {
    return Math.sign(leftFormation.total - rightFormation.total);
  }
  if (
    left.completedAtEvent === undefined ||
    right.completedAtEvent === undefined
  ) {
    throw new Error(
      "Completed formations must record their completion event index.",
    );
  }
  return left.completedAtEvent < right.completedAtEvent ? 1 : -1;
}
