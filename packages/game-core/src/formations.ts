import { parseTroopCard } from "./cards";
import type { CardId, FlagSide, Formation } from "./types";

const STRENGTH = {
  host: 1,
  skirmish: 2,
  battalion: 3,
  phalanx: 4,
  wedge: 5,
} as const;

export function evaluateFormation(cardIds: readonly CardId[]): Formation {
  if (cardIds.length !== 3 && cardIds.length !== 4) {
    throw new RangeError(
      "A formation must contain exactly 3 or 4 troop cards.",
    );
  }
  const cards = cardIds.map(parseTroopCard);
  const values = cards.map((card) => card.value).sort((a, b) => a - b);
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

export function compareCompletedSides(left: FlagSide, right: FlagSide): number {
  const leftFormation = evaluateFormation(left.cards);
  const rightFormation = evaluateFormation(right.cards);
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
