import type { CardId, TacticCard } from "./types";

export const TACTIC_IDS = [
  "tactic-leader-alexander",
  "tactic-leader-darius",
  "tactic-companion-cavalry",
  "tactic-shield-bearers",
  "tactic-fog",
  "tactic-mud",
  "tactic-scout",
  "tactic-redeploy",
  "tactic-deserter",
  "tactic-traitor",
] as const;

const registry: Record<(typeof TACTIC_IDS)[number], TacticCard> = {
  "tactic-leader-alexander": {
    id: "tactic-leader-alexander",
    kind: "tactic",
    category: "morale",
    name: "Leader Alexander",
  },
  "tactic-leader-darius": {
    id: "tactic-leader-darius",
    kind: "tactic",
    category: "morale",
    name: "Leader Darius",
  },
  "tactic-companion-cavalry": {
    id: "tactic-companion-cavalry",
    kind: "tactic",
    category: "morale",
    name: "Companion Cavalry",
  },
  "tactic-shield-bearers": {
    id: "tactic-shield-bearers",
    kind: "tactic",
    category: "morale",
    name: "Shield Bearers",
  },
  "tactic-fog": {
    id: "tactic-fog",
    kind: "tactic",
    category: "environment",
    name: "Fog",
  },
  "tactic-mud": {
    id: "tactic-mud",
    kind: "tactic",
    category: "environment",
    name: "Mud",
  },
  "tactic-scout": {
    id: "tactic-scout",
    kind: "tactic",
    category: "guile",
    name: "Scout",
  },
  "tactic-redeploy": {
    id: "tactic-redeploy",
    kind: "tactic",
    category: "guile",
    name: "Redeploy",
  },
  "tactic-deserter": {
    id: "tactic-deserter",
    kind: "tactic",
    category: "guile",
    name: "Deserter",
  },
  "tactic-traitor": {
    id: "tactic-traitor",
    kind: "tactic",
    category: "guile",
    name: "Traitor",
  },
};

export function createTacticDeck(): CardId[] {
  return [...TACTIC_IDS];
}

export function getTacticCard(cardId: CardId): TacticCard | undefined {
  return registry[cardId as keyof typeof registry];
}

export function isTacticCard(cardId: CardId): boolean {
  return getTacticCard(cardId) !== undefined;
}

export function isLeader(cardId: CardId): boolean {
  return (
    cardId === "tactic-leader-alexander" || cardId === "tactic-leader-darius"
  );
}

export function isMorale(cardId: CardId): boolean {
  return getTacticCard(cardId)?.category === "morale";
}

export function isEnvironment(cardId: CardId): boolean {
  return getTacticCard(cardId)?.category === "environment";
}

export function listTactics(): TacticCard[] {
  return TACTIC_IDS.map((id) => registry[id]);
}
