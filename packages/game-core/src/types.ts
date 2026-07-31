export const PLAYER_IDS = ["player-one", "player-two"] as const;
export type PlayerId = (typeof PLAYER_IDS)[number];

export const TROOP_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
] as const;
export type TroopColor = (typeof TROOP_COLORS)[number];

export type CardKind = "troop" | "tactic";
export type CardId = string;
export type DrawPile = CardKind;

export type TroopCard = {
  id: CardId;
  kind: "troop";
  color: TroopColor;
  value: number;
};

export type GamePhase =
  "setup" | "play-card" | "optional-claims" | "draw-card" | "finished";

export type PlayerState = {
  hand: CardId[];
  playedTacticsCount: number;
};

export type FlagSide = {
  cards: CardId[];
  completedAtEvent?: number;
};

export type FlagState = {
  id: number;
  owner?: PlayerId;
  capacity: 3 | 4;
  sides: Record<PlayerId, FlagSide>;
};

export type PendingEffect = {
  tacticId: CardId;
  step: string;
  actor: PlayerId;
};

export type WinResult = {
  player: PlayerId;
  condition: "breakthrough" | "envelopment";
};

export type FormationKind =
  "wedge" | "phalanx" | "battalion" | "skirmish" | "host";

export type Formation = {
  kind: FormationKind;
  strength: number;
  total: number;
  values: number[];
};

export type GameCommand =
  | { type: "play-troop"; player: PlayerId; cardId: CardId; flagId: number }
  | { type: "skip-play"; player: PlayerId }
  | { type: "claim-flag"; player: PlayerId; flagId: number }
  | { type: "pass-claims"; player: PlayerId }
  | { type: "draw-card"; player: PlayerId; pile: DrawPile }
  | { type: "end-turn"; player: PlayerId };

export type GameEvent =
  | { index: number; type: "game-started"; seed: string; firstPlayer: PlayerId }
  | {
      index: number;
      type: "troop-played";
      player: PlayerId;
      cardId: CardId;
      flagId: number;
    }
  | { index: number; type: "flag-claimed"; player: PlayerId; flagId: number }
  | {
      index: number;
      type: "card-drawn";
      player: PlayerId;
      cardId: CardId;
      pile: DrawPile;
    }
  | { index: number; type: "turn-started"; player: PlayerId; turn: number }
  | {
      index: number;
      type: "game-won";
      player: PlayerId;
      condition: WinResult["condition"];
    };

export type GameState = {
  version: number;
  seed: string;
  phase: GamePhase;
  activePlayer: PlayerId;
  players: Record<PlayerId, PlayerState>;
  flags: FlagState[];
  troopDeck: CardId[];
  tacticDeck: CardId[];
  troopDiscard: CardId[];
  tacticDiscard: CardId[];
  cardUniverse: CardId[];
  pendingEffect?: PendingEffect;
  eventIndex: number;
  turn: number;
  events: GameEvent[];
  winner?: WinResult;
};
