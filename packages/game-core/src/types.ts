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

export type TacticCategory = "morale" | "environment" | "guile";

export type TacticCard = {
  id: CardId;
  kind: "tactic";
  category: TacticCategory;
  name: string;
};

export type GamePhase =
  | "setup"
  | "play-card"
  | "resolve-tactic"
  | "optional-claims"
  | "draw-card"
  | "finished";

export type PlayerState = {
  hand: CardId[];
  playedTacticsCount: number;
  hasPlayedLeader: boolean;
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
  environment: CardId[];
};

export type FieldCardRef = {
  flagId: number;
  cardId: CardId;
  owner: PlayerId;
};

export type PendingEffect = {
  tacticId: CardId;
  kind: "scout" | "redeploy" | "deserter" | "traitor";
  step:
    "choose-draw" | "choose-return" | "choose-source" | "choose-destination";
  actor: PlayerId;
  source?: FieldCardRef;
  drawnCards?: CardId[];
};

export type WinResult = {
  player: PlayerId;
  condition: "breakthrough" | "envelopment";
};

export type GameSummary = {
  readonly schemaVersion: 1;
  readonly rulesVersion: number;
  readonly seed: string;
  readonly winner: PlayerId;
  readonly condition: WinResult["condition"];
  readonly winningFlags: readonly number[];
  readonly claimedFlags: Readonly<Record<PlayerId, readonly number[]>>;
  readonly turns: number;
  readonly eventCount: number;
};

export type FormationKind =
  "wedge" | "phalanx" | "battalion" | "skirmish" | "host";

export type Formation = {
  kind: FormationKind;
  strength: number;
  total: number;
  values: number[];
};

export type FormationOptions = {
  fog?: boolean;
};

export type PublicKnowledge = {
  visibleTroops: CardId[];
  possibleTroops: CardId[];
};

export type ClaimReason =
  | "FLAG_ALREADY_CLAIMED"
  | "CLAIMANT_FORMATION_INCOMPLETE"
  | "CLAIMANT_FORMATION_WINS"
  | "OPPONENT_FORMATION_WINS"
  | "NO_POSSIBLE_COUNTER"
  | "OPPONENT_CAN_WIN";

export type ClaimResult = {
  allowed: boolean;
  reason: ClaimReason;
  witness?: CardId[];
  claimantFormation?: Formation;
  opponentFormation?: Formation;
  combinationsChecked: number;
};

export type GameCommand =
  | { type: "play-troop"; player: PlayerId; cardId: CardId; flagId: number }
  | { type: "play-tactic"; player: PlayerId; cardId: CardId; flagId?: number }
  | { type: "choose-scout-draw"; player: PlayerId; piles: DrawPile[] }
  | { type: "choose-scout-return"; player: PlayerId; cardIds: CardId[] }
  | {
      type: "choose-tactic-source";
      player: PlayerId;
      flagId: number;
      cardId: CardId;
    }
  | {
      type: "choose-tactic-destination";
      player: PlayerId;
      flagId?: number;
      discard?: boolean;
    }
  | { type: "cancel-tactic"; player: PlayerId }
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
  | {
      index: number;
      type: "scout-drawn";
      player: PlayerId;
      cards: CardId[];
      piles: DrawPile[];
    }
  | {
      index: number;
      type: "scout-returned";
      player: PlayerId;
      cards: CardId[];
    }
  | {
      index: number;
      type: "field-card-moved";
      player: PlayerId;
      cardId: CardId;
      fromFlagId: number;
      toFlagId?: number;
      discarded: boolean;
    }
  | {
      index: number;
      type: "tactic-cancelled";
      player: PlayerId;
      cardId: CardId;
    }
  | { index: number; type: "tactic-resolved"; player: PlayerId; cardId: CardId }
  | {
      index: number;
      type: "tactic-played";
      player: PlayerId;
      cardId: CardId;
      flagId?: number;
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

export type ReplayArchive = {
  readonly schemaVersion: 1;
  readonly rulesVersion: number;
  readonly seed: string;
  readonly initialState: GameState;
  readonly commands: readonly GameCommand[];
  readonly finalStateHash: string;
};

export type PlayerSummaryView = {
  handCount: number;
  playedTacticsCount: number;
  hasPlayedLeader: boolean;
};

export type DeckCountView = {
  troop: number;
  tactic: number;
};

export type ProjectedPendingEffect = Omit<PendingEffect, "drawnCards"> & {
  drawnCardCount?: number;
  drawnCards?: CardId[];
};

export type ProjectedGameEvent =
  | Omit<Extract<GameEvent, { type: "game-started" }>, "seed">
  | Exclude<
      GameEvent,
      | Extract<GameEvent, { type: "game-started" }>
      | Extract<GameEvent, { type: "scout-drawn" }>
      | Extract<GameEvent, { type: "scout-returned" }>
      | Extract<GameEvent, { type: "card-drawn" }>
    >
  | {
      index: number;
      type: "scout-drawn";
      player: PlayerId;
      cardCount: number;
      piles: DrawPile[];
      cards?: CardId[];
    }
  | {
      index: number;
      type: "scout-returned";
      player: PlayerId;
      cardCount: number;
      cards?: CardId[];
    }
  | {
      index: number;
      type: "card-drawn";
      player: PlayerId;
      pile: DrawPile;
      cardId?: CardId;
    };

export type PublicGameView = {
  projectionVersion: 1;
  stateVersion: number;
  phase: GamePhase;
  activePlayer: PlayerId;
  players: Record<PlayerId, PlayerSummaryView>;
  flags: FlagState[];
  decks: DeckCountView;
  troopDiscard: CardId[];
  tacticDiscard: CardId[];
  pendingEffect?: ProjectedPendingEffect;
  eventIndex: number;
  turn: number;
  events: ProjectedGameEvent[];
  winner?: WinResult;
};

export type PlayerView = PublicGameView & {
  audience: "player";
  viewer: PlayerId;
  hand: CardId[];
  legalCommands: GameCommand[];
};

export type SpectatorView = PublicGameView & {
  audience: "spectator";
};

export type ReplayAccess =
  | { mode: "public" }
  | { mode: "player"; player: PlayerId }
  | { mode: "omniscient" };

export type ReplayView =
  | { audience: "replay"; access: "public"; snapshot: SpectatorView }
  | {
      audience: "replay";
      access: "player";
      viewer: PlayerId;
      snapshot: PlayerView;
    }
  | { audience: "replay"; access: "omniscient"; snapshot: GameState };
