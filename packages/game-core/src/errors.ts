export type RuleErrorCode =
  | "GAME_FINISHED"
  | "NOT_ACTIVE_PLAYER"
  | "WRONG_PHASE"
  | "CARD_NOT_IN_HAND"
  | "NOT_A_TROOP"
  | "FLAG_NOT_FOUND"
  | "FLAG_ALREADY_CLAIMED"
  | "FLAG_SIDE_FULL"
  | "PLAY_AVAILABLE"
  | "FORMATION_INCOMPLETE"
  | "OPPONENT_FORMATION_INCOMPLETE"
  | "FORMATION_NOT_STRONGER"
  | "DRAW_PILE_EMPTY"
  | "DRAW_AVAILABLE"
  | "TACTICS_DISABLED";

export class RuleError extends Error {
  constructor(
    public readonly code: RuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuleError";
  }
}
