import {
  TROOP_COLORS,
  type CardId,
  type TroopCard,
  type TroopColor,
} from "./types";

const TROOP_ID_PATTERN =
  /^troop-(red|orange|yellow|green|blue|purple)-(10|[1-9])$/;

export function createTroopCard(color: TroopColor, value: number): TroopCard {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new RangeError(
      `Troop value must be an integer from 1 to 10: ${value}`,
    );
  }
  return { id: `troop-${color}-${value}`, kind: "troop", color, value };
}

export function createTroopDeck(): CardId[] {
  return TROOP_COLORS.flatMap((color) =>
    Array.from(
      { length: 10 },
      (_, index) => createTroopCard(color, index + 1).id,
    ),
  );
}

export function parseTroopCard(cardId: CardId): TroopCard {
  const match = TROOP_ID_PATTERN.exec(cardId);
  if (!match) {
    throw new TypeError(`Card is not a valid troop: ${cardId}`);
  }
  return createTroopCard(match[1] as TroopColor, Number(match[2]));
}

export function isTroopCard(cardId: CardId): boolean {
  return TROOP_ID_PATTERN.test(cardId);
}
