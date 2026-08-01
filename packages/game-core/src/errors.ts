export type RuleErrorCode =
  | "GAME_FINISHED"
  | "NOT_ACTIVE_PLAYER"
  | "WRONG_PHASE"
  | "CARD_NOT_IN_HAND"
  | "NOT_A_TROOP"
  | "NOT_A_TACTIC"
  | "FLAG_NOT_FOUND"
  | "FLAG_ALREADY_CLAIMED"
  | "FLAG_SIDE_FULL"
  | "PLAY_AVAILABLE"
  | "TACTIC_LIMIT_REACHED"
  | "LEADER_LIMIT_REACHED"
  | "ENVIRONMENT_ALREADY_PRESENT"
  | "NO_LEGAL_TACTIC_TARGET"
  | "INVALID_TACTIC_STEP"
  | "INVALID_TACTIC_SELECTION"
  | "SCOUT_DRAW_UNAVAILABLE"
  | "SCOUT_RETURN_INVALID"
  | "TACTIC_CANCEL_NOT_ALLOWED"
  | "FORMATION_INCOMPLETE"
  | "CLAIM_NOT_PROVEN"
  | "FORMATION_NOT_STRONGER"
  | "DRAW_PILE_EMPTY"
  | "DRAW_AVAILABLE"
  | "TACTICS_DISABLED";

export type RuleErrorDetails = {
  witness?: string[];
};

export class RuleError extends Error {
  constructor(
    public readonly code: RuleErrorCode,
    message: string,
    public readonly details?: RuleErrorDetails,
  ) {
    super(message);
    this.name = "RuleError";
  }
}
