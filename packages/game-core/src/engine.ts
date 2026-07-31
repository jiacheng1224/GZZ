import { isTroopCard } from "./cards";
import { RuleError, type RuleErrorCode } from "./errors";
import { compareCompletedSides } from "./formations";
import { assertGameState } from "./invariants";
import {
  PLAYER_IDS,
  type GameCommand,
  type GameEvent,
  type GameState,
  type PlayerId,
} from "./types";
import { detectVictory } from "./victory";

const otherPlayer = (player: PlayerId): PlayerId =>
  player === "player-one" ? "player-two" : "player-one";

const cloneState = (state: GameState): GameState =>
  JSON.parse(JSON.stringify(state)) as GameState;

type NewGameEvent = GameEvent extends infer Event
  ? Event extends GameEvent
    ? Omit<Event, "index">
    : never
  : never;

function fail(code: RuleErrorCode, message: string): never {
  throw new RuleError(code, message);
}

function appendEvent(state: GameState, event: NewGameEvent): void {
  state.eventIndex += 1;
  state.events.push({ ...event, index: state.eventIndex } as GameEvent);
}

function requireTurn(
  state: GameState,
  command: GameCommand,
  phase: GameState["phase"],
): void {
  if (state.phase === "finished")
    fail("GAME_FINISHED", "The game has already finished.");
  if (command.player !== state.activePlayer)
    fail("NOT_ACTIVE_PLAYER", "The command actor is not the active player.");
  if (state.phase !== phase)
    fail("WRONG_PHASE", `Expected phase ${phase}, received ${state.phase}.`);
}

function playTroop(
  state: GameState,
  command: Extract<GameCommand, { type: "play-troop" }>,
): void {
  requireTurn(state, command, "play-card");
  const hand = state.players[command.player].hand;
  const handIndex = hand.indexOf(command.cardId);
  if (handIndex < 0)
    fail("CARD_NOT_IN_HAND", "The selected card is not in the player's hand.");
  if (!isTroopCard(command.cardId))
    fail("NOT_A_TROOP", "R1 only supports troop cards.");
  const flag = state.flags.find((item) => item.id === command.flagId);
  if (!flag) fail("FLAG_NOT_FOUND", `Flag ${command.flagId} does not exist.`);
  if (flag.owner)
    fail("FLAG_ALREADY_CLAIMED", `Flag ${command.flagId} is already claimed.`);
  const side = flag.sides[command.player];
  if (side.cards.length >= flag.capacity)
    fail("FLAG_SIDE_FULL", `Flag ${command.flagId} has no open slot.`);

  hand.splice(handIndex, 1);
  side.cards.push(command.cardId);
  appendEvent(state, {
    type: "troop-played",
    player: command.player,
    cardId: command.cardId,
    flagId: command.flagId,
  });
  if (side.cards.length === flag.capacity)
    side.completedAtEvent = state.eventIndex;
  state.phase = "optional-claims";
}

function availableTroopPlays(
  state: GameState,
  player: PlayerId,
): GameCommand[] {
  return state.players[player].hand.flatMap((cardId) =>
    state.flags
      .filter(
        (flag) =>
          !flag.owner && flag.sides[player].cards.length < flag.capacity,
      )
      .map((flag) => ({
        type: "play-troop" as const,
        player,
        cardId,
        flagId: flag.id,
      })),
  );
}

function skipPlay(
  state: GameState,
  command: Extract<GameCommand, { type: "skip-play" }>,
): void {
  requireTurn(state, command, "play-card");
  if (availableTroopPlays(state, command.player).length > 0) {
    fail(
      "PLAY_AVAILABLE",
      "A troop must be played while a legal deployment exists.",
    );
  }
  state.phase = "optional-claims";
}

function claimFlag(
  state: GameState,
  command: Extract<GameCommand, { type: "claim-flag" }>,
): void {
  requireTurn(state, command, "optional-claims");
  const flag = state.flags.find((item) => item.id === command.flagId);
  if (!flag) fail("FLAG_NOT_FOUND", `Flag ${command.flagId} does not exist.`);
  if (flag.owner)
    fail("FLAG_ALREADY_CLAIMED", `Flag ${command.flagId} is already claimed.`);
  const own = flag.sides[command.player];
  const opponent = flag.sides[otherPlayer(command.player)];
  if (own.cards.length !== flag.capacity)
    fail("FORMATION_INCOMPLETE", "The claiming formation is incomplete.");
  if (opponent.cards.length !== flag.capacity) {
    fail("OPPONENT_FORMATION_INCOMPLETE", "Early claims are deferred to R2.");
  }
  if (compareCompletedSides(own, opponent) <= 0)
    fail("FORMATION_NOT_STRONGER", "The claiming formation does not win.");

  flag.owner = command.player;
  appendEvent(state, {
    type: "flag-claimed",
    player: command.player,
    flagId: command.flagId,
  });
  const winner = detectVictory(state.flags, command.player);
  if (winner) {
    state.winner = winner;
    state.phase = "finished";
    appendEvent(state, {
      type: "game-won",
      player: winner.player,
      condition: winner.condition,
    });
  }
}

function passClaims(
  state: GameState,
  command: Extract<GameCommand, { type: "pass-claims" }>,
): void {
  requireTurn(state, command, "optional-claims");
  state.phase = "draw-card";
}

function drawCard(
  state: GameState,
  command: Extract<GameCommand, { type: "draw-card" }>,
): void {
  requireTurn(state, command, "draw-card");
  if (command.pile === "tactic")
    fail("TACTICS_DISABLED", "Tactics are disabled in the R1 ruleset.");
  const cardId = state.troopDeck.pop();
  if (!cardId) fail("DRAW_PILE_EMPTY", "The troop deck is empty.");
  state.players[command.player].hand.push(cardId);
  appendEvent(state, {
    type: "card-drawn",
    player: command.player,
    cardId,
    pile: "troop",
  });
  startNextTurn(state, command.player);
}

function startNextTurn(state: GameState, previousPlayer: PlayerId): void {
  state.activePlayer = otherPlayer(previousPlayer);
  state.turn += 1;
  state.phase = "play-card";
  appendEvent(state, {
    type: "turn-started",
    player: state.activePlayer,
    turn: state.turn,
  });
}

function endTurn(
  state: GameState,
  command: Extract<GameCommand, { type: "end-turn" }>,
): void {
  requireTurn(state, command, "draw-card");
  if (state.troopDeck.length > 0 || state.tacticDeck.length > 0) {
    fail(
      "DRAW_AVAILABLE",
      "A card must be drawn while a draw pile is available.",
    );
  }
  startNextTurn(state, command.player);
}

export function applyCommand(
  current: GameState,
  command: GameCommand,
): GameState {
  const state = cloneState(current);
  if (command.type === "play-troop") playTroop(state, command);
  else if (command.type === "skip-play") skipPlay(state, command);
  else if (command.type === "claim-flag") claimFlag(state, command);
  else if (command.type === "pass-claims") passClaims(state, command);
  else if (command.type === "draw-card") drawCard(state, command);
  else endTurn(state, command);
  assertGameState(state);
  return state;
}

function canClaim(state: GameState, player: PlayerId, flagId: number): boolean {
  const flag = state.flags.find((item) => item.id === flagId);
  if (!flag || flag.owner) return false;
  const own = flag.sides[player];
  const opponent = flag.sides[otherPlayer(player)];
  return (
    own.cards.length === flag.capacity &&
    opponent.cards.length === flag.capacity &&
    compareCompletedSides(own, opponent) > 0
  );
}

export function getLegalCommands(
  state: GameState,
  player: PlayerId,
): GameCommand[] {
  if (state.phase === "finished" || state.activePlayer !== player) return [];
  if (state.phase === "play-card") {
    const plays = availableTroopPlays(state, player);
    return plays.length > 0 ? plays : [{ type: "skip-play", player }];
  }
  if (state.phase === "optional-claims") {
    const claims = state.flags
      .filter((flag) => !flag.owner && canClaim(state, player, flag.id))
      .map((flag) => ({
        type: "claim-flag" as const,
        player,
        flagId: flag.id,
      }));
    return [...claims, { type: "pass-claims", player }];
  }
  if (state.phase === "draw-card" && state.troopDeck.length > 0) {
    return [{ type: "draw-card", player, pile: "troop" }];
  }
  if (
    state.phase === "draw-card" &&
    state.troopDeck.length === 0 &&
    state.tacticDeck.length === 0
  ) {
    return [{ type: "end-turn", player }];
  }
  return [];
}

export function validateCommand(
  state: GameState,
  command: GameCommand,
): RuleError | undefined {
  try {
    applyCommand(state, command);
    return undefined;
  } catch (error) {
    if (error instanceof RuleError) return error;
    throw error;
  }
}

export function getPlayerIds(): readonly PlayerId[] {
  return PLAYER_IDS;
}
