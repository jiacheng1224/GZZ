import { isTroopCard } from "./cards";
import { evaluateClaim } from "./claims";
import { RuleError, type RuleErrorCode } from "./errors";
import { assertGameState } from "./invariants";
import { getTacticCard, isEnvironment, isLeader, isMorale } from "./tactics";
import {
  PLAYER_IDS,
  type CardId,
  type DrawPile,
  type FieldCardRef,
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

function fail(
  code: RuleErrorCode,
  message: string,
  details?: { witness?: string[] },
): never {
  throw new RuleError(code, message, details);
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

function tacticCountAllows(state: GameState, player: PlayerId): boolean {
  return (
    state.players[player].playedTacticsCount <=
    state.players[otherPlayer(player)].playedTacticsCount
  );
}

const isFormationCard = (cardId: CardId): boolean =>
  isTroopCard(cardId) || isMorale(cardId);

function formationCards(
  state: GameState,
  owner: PlayerId,
  troopsOnly = false,
): FieldCardRef[] {
  return state.flags.flatMap((flag) =>
    flag.owner
      ? []
      : flag.sides[owner].cards
          .filter((cardId) => !troopsOnly || isTroopCard(cardId))
          .map((cardId) => ({ flagId: flag.id, cardId, owner })),
  );
}

function openDestinations(state: GameState, player: PlayerId): number[] {
  return state.flags
    .filter(
      (flag) => !flag.owner && flag.sides[player].cards.length < flag.capacity,
    )
    .map((flag) => flag.id);
}

function guileHasLegalEffect(
  state: GameState,
  player: PlayerId,
  cardId: CardId,
): boolean {
  if (cardId === "tactic-scout")
    return state.troopDeck.length + state.tacticDeck.length >= 3;
  if (cardId === "tactic-redeploy")
    return formationCards(state, player).length > 0;
  if (cardId === "tactic-deserter")
    return formationCards(state, otherPlayer(player)).length > 0;
  if (cardId === "tactic-traitor")
    return (
      formationCards(state, otherPlayer(player), true).length > 0 &&
      openDestinations(state, player).length > 0
    );
  return false;
}

function canTargetWithTactic(
  state: GameState,
  player: PlayerId,
  cardId: string,
  flagId: number,
): boolean {
  const flag = state.flags.find((item) => item.id === flagId);
  if (!flag || flag.owner || !tacticCountAllows(state, player)) return false;
  if (isLeader(cardId) && state.players[player].hasPlayedLeader) return false;
  if (isMorale(cardId)) return flag.sides[player].cards.length < flag.capacity;
  if (isEnvironment(cardId)) return !flag.environment.includes(cardId);
  return false;
}

function playTactic(
  state: GameState,
  command: Extract<GameCommand, { type: "play-tactic" }>,
): void {
  requireTurn(state, command, "play-card");
  const hand = state.players[command.player].hand;
  const handIndex = hand.indexOf(command.cardId);
  if (handIndex < 0)
    fail("CARD_NOT_IN_HAND", "The selected card is not in the player's hand.");
  const tactic = getTacticCard(command.cardId);
  if (!tactic) fail("NOT_A_TACTIC", "The selected card is not a tactic.");
  if (!tacticCountAllows(state, command.player)) {
    fail(
      "TACTIC_LIMIT_REACHED",
      "A player cannot have played more than one tactic above the opponent.",
    );
  }
  if (tactic.category === "guile") {
    if (!guileHasLegalEffect(state, command.player, command.cardId)) {
      fail(
        "NO_LEGAL_TACTIC_TARGET",
        "The selected guile tactic has no legal effect in this position.",
      );
    }
    hand.splice(handIndex, 1);
    state.players[command.player].playedTacticsCount += 1;
    appendEvent(state, {
      type: "tactic-played",
      player: command.player,
      cardId: command.cardId,
    });
    state.pendingEffect = {
      tacticId: command.cardId,
      kind: command.cardId.slice("tactic-".length) as
        "scout" | "redeploy" | "deserter" | "traitor",
      step: command.cardId === "tactic-scout" ? "choose-draw" : "choose-source",
      actor: command.player,
    };
    state.phase = "resolve-tactic";
    return;
  }
  if (
    isLeader(command.cardId) &&
    state.players[command.player].hasPlayedLeader
  ) {
    fail(
      "LEADER_LIMIT_REACHED",
      "Each player may play only one Leader per game.",
    );
  }
  const flag = state.flags.find((item) => item.id === command.flagId);
  if (!flag) fail("FLAG_NOT_FOUND", `Flag ${command.flagId} does not exist.`);
  if (flag.owner)
    fail("FLAG_ALREADY_CLAIMED", `Flag ${command.flagId} is already claimed.`);
  if (
    isMorale(command.cardId) &&
    flag.sides[command.player].cards.length >= flag.capacity
  ) {
    fail("FLAG_SIDE_FULL", `Flag ${command.flagId} has no open slot.`);
  }
  if (
    isEnvironment(command.cardId) &&
    flag.environment.includes(command.cardId)
  ) {
    fail(
      "ENVIRONMENT_ALREADY_PRESENT",
      "That environment is already on the flag.",
    );
  }

  hand.splice(handIndex, 1);
  state.players[command.player].playedTacticsCount += 1;
  if (isLeader(command.cardId))
    state.players[command.player].hasPlayedLeader = true;
  if (isMorale(command.cardId))
    flag.sides[command.player].cards.push(command.cardId);
  else flag.environment.push(command.cardId);

  appendEvent(state, {
    type: "tactic-played",
    player: command.player,
    cardId: command.cardId,
    flagId: command.flagId,
  });

  if (command.cardId === "tactic-mud") {
    flag.capacity = 4;
    for (const player of PLAYER_IDS) {
      if (flag.sides[player].cards.length < 4) {
        flag.sides[player].completedAtEvent = undefined;
      }
    }
  }
  const side = flag.sides[command.player];
  if (isMorale(command.cardId) && side.cards.length === flag.capacity) {
    side.completedAtEvent = state.eventIndex;
  }
  state.phase = "optional-claims";
}

function availableTroopPlays(
  state: GameState,
  player: PlayerId,
): GameCommand[] {
  return state.players[player].hand.flatMap((cardId) =>
    isTroopCard(cardId)
      ? state.flags
          .filter(
            (flag) =>
              !flag.owner && flag.sides[player].cards.length < flag.capacity,
          )
          .map((flag) => ({
            type: "play-troop" as const,
            player,
            cardId,
            flagId: flag.id,
          }))
      : [],
  );
}

function availableTacticPlays(
  state: GameState,
  player: PlayerId,
): GameCommand[] {
  if (!tacticCountAllows(state, player)) return [];
  return state.players[player].hand.flatMap((cardId) => {
    const tactic = getTacticCard(cardId);
    if (!tactic) return [];
    if (tactic.category === "guile") {
      return guileHasLegalEffect(state, player, cardId)
        ? [{ type: "play-tactic" as const, player, cardId }]
        : [];
    }
    return state.flags
      .filter((flag) => canTargetWithTactic(state, player, cardId, flag.id))
      .map((flag) => ({
        type: "play-tactic" as const,
        player,
        cardId,
        flagId: flag.id,
      }));
  });
}

function requirePending(state: GameState, player: PlayerId) {
  if (state.phase === "finished")
    fail("GAME_FINISHED", "The game has already finished.");
  if (player !== state.activePlayer)
    fail("NOT_ACTIVE_PLAYER", "The command actor is not the active player.");
  if (state.phase !== "resolve-tactic" || !state.pendingEffect)
    fail("WRONG_PHASE", "There is no tactic effect awaiting resolution.");
  return state.pendingEffect;
}

function finishGuileEffect(state: GameState): void {
  const pending = state.pendingEffect;
  if (!pending)
    fail("INVALID_TACTIC_STEP", "There is no pending tactic to resolve.");
  state.tacticDiscard.push(pending.tacticId);
  appendEvent(state, {
    type: "tactic-resolved",
    player: pending.actor,
    cardId: pending.tacticId,
  });
  state.pendingEffect = undefined;
  state.phase = "optional-claims";
}

function refreshCompletion(
  state: GameState,
  flagId: number,
  player: PlayerId,
): void {
  const flag = state.flags.find((item) => item.id === flagId);
  const side = flag?.sides[player];
  if (!flag || !side) return;
  if (side.cards.length < flag.capacity) side.completedAtEvent = undefined;
  else if (side.completedAtEvent === undefined)
    side.completedAtEvent = state.eventIndex;
}

function chooseScoutDraw(
  state: GameState,
  command: Extract<GameCommand, { type: "choose-scout-draw" }>,
): void {
  const pending = requirePending(state, command.player);
  if (pending.kind !== "scout" || pending.step !== "choose-draw")
    fail("INVALID_TACTIC_STEP", "Scout is not waiting for draw choices.");
  if (command.piles.length !== 3)
    fail("INVALID_TACTIC_SELECTION", "Scout must draw exactly three cards.");

  const drawn: CardId[] = [];
  for (const pile of command.piles) {
    const deck = pile === "troop" ? state.troopDeck : state.tacticDeck;
    const cardId = deck.pop();
    if (!cardId)
      fail(
        "SCOUT_DRAW_UNAVAILABLE",
        `The ${pile} deck cannot satisfy the selected Scout draw sequence.`,
      );
    drawn.push(cardId);
  }
  state.players[command.player].hand.push(...drawn);
  pending.drawnCards = drawn;
  pending.step = "choose-return";
  appendEvent(state, {
    type: "scout-drawn",
    player: command.player,
    cards: drawn,
    piles: [...command.piles],
  });
}

function chooseScoutReturn(
  state: GameState,
  command: Extract<GameCommand, { type: "choose-scout-return" }>,
): void {
  const pending = requirePending(state, command.player);
  if (pending.kind !== "scout" || pending.step !== "choose-return")
    fail("INVALID_TACTIC_STEP", "Scout is not waiting for returned cards.");
  if (command.cardIds.length !== 2 || new Set(command.cardIds).size !== 2)
    fail("SCOUT_RETURN_INVALID", "Scout must return two distinct cards.");
  const hand = state.players[command.player].hand;
  if (command.cardIds.some((cardId) => !hand.includes(cardId)))
    fail("SCOUT_RETURN_INVALID", "A returned Scout card is not in hand.");

  for (const cardId of command.cardIds) {
    hand.splice(hand.indexOf(cardId), 1);
    (isTroopCard(cardId) ? state.troopDeck : state.tacticDeck).push(cardId);
  }
  appendEvent(state, {
    type: "scout-returned",
    player: command.player,
    cards: [...command.cardIds],
  });
  finishGuileEffect(state);
}

function findSource(
  state: GameState,
  owner: PlayerId,
  flagId: number,
  cardId: CardId,
  troopsOnly: boolean,
): FieldCardRef | undefined {
  const flag = state.flags.find((item) => item.id === flagId);
  if (
    !flag ||
    flag.owner ||
    !flag.sides[owner].cards.includes(cardId) ||
    !isFormationCard(cardId) ||
    (troopsOnly && !isTroopCard(cardId))
  )
    return undefined;
  return { flagId, cardId, owner };
}

function removeFieldCard(state: GameState, source: FieldCardRef): void {
  const flag = state.flags.find((item) => item.id === source.flagId);
  if (!flag)
    fail("INVALID_TACTIC_SELECTION", "The source flag no longer exists.");
  const cards = flag.sides[source.owner].cards;
  cards.splice(cards.indexOf(source.cardId), 1);
  refreshCompletion(state, source.flagId, source.owner);
}

function discardFormationCard(state: GameState, cardId: CardId): void {
  (isTroopCard(cardId) ? state.troopDiscard : state.tacticDiscard).push(cardId);
}

function chooseTacticSource(
  state: GameState,
  command: Extract<GameCommand, { type: "choose-tactic-source" }>,
): void {
  const pending = requirePending(state, command.player);
  if (pending.step !== "choose-source" || pending.kind === "scout")
    fail("INVALID_TACTIC_STEP", "The tactic is not waiting for a source.");
  const owner =
    pending.kind === "redeploy" ? command.player : otherPlayer(command.player);
  const source = findSource(
    state,
    owner,
    command.flagId,
    command.cardId,
    pending.kind === "traitor",
  );
  if (!source)
    fail("INVALID_TACTIC_SELECTION", "The selected source is not legal.");

  if (pending.kind === "deserter") {
    removeFieldCard(state, source);
    discardFormationCard(state, source.cardId);
    appendEvent(state, {
      type: "field-card-moved",
      player: command.player,
      cardId: source.cardId,
      fromFlagId: source.flagId,
      discarded: true,
    });
    finishGuileEffect(state);
    return;
  }
  pending.source = source;
  pending.step = "choose-destination";
}

function chooseTacticDestination(
  state: GameState,
  command: Extract<GameCommand, { type: "choose-tactic-destination" }>,
): void {
  const pending = requirePending(state, command.player);
  if (
    pending.step !== "choose-destination" ||
    (pending.kind !== "redeploy" && pending.kind !== "traitor") ||
    !pending.source
  )
    fail("INVALID_TACTIC_STEP", "The tactic is not waiting for a destination.");
  const source = pending.source;

  if (command.discard === true) {
    if (pending.kind !== "redeploy" || command.flagId !== undefined)
      fail("INVALID_TACTIC_SELECTION", "This card cannot be discarded here.");
    removeFieldCard(state, source);
    discardFormationCard(state, source.cardId);
    appendEvent(state, {
      type: "field-card-moved",
      player: command.player,
      cardId: source.cardId,
      fromFlagId: source.flagId,
      discarded: true,
    });
    finishGuileEffect(state);
    return;
  }

  if (command.flagId === undefined)
    fail("INVALID_TACTIC_SELECTION", "A destination flag is required.");
  const target = state.flags.find((flag) => flag.id === command.flagId);
  if (
    !target ||
    target.owner ||
    target.sides[command.player].cards.length >= target.capacity ||
    (pending.kind === "redeploy" && target.id === source.flagId)
  )
    fail("INVALID_TACTIC_SELECTION", "The selected destination is not legal.");

  removeFieldCard(state, source);
  target.sides[command.player].cards.push(source.cardId);
  appendEvent(state, {
    type: "field-card-moved",
    player: command.player,
    cardId: source.cardId,
    fromFlagId: source.flagId,
    toFlagId: target.id,
    discarded: false,
  });
  refreshCompletion(state, target.id, command.player);
  finishGuileEffect(state);
}

function cancelTactic(
  state: GameState,
  command: Extract<GameCommand, { type: "cancel-tactic" }>,
): void {
  const pending = requirePending(state, command.player);
  const cancellable =
    pending.step === "choose-source" ||
    (pending.kind === "scout" && pending.step === "choose-draw");
  if (!cancellable)
    fail(
      "TACTIC_CANCEL_NOT_ALLOWED",
      "The tactic cannot be cancelled after its effect changes game state.",
    );
  state.players[command.player].hand.push(pending.tacticId);
  state.players[command.player].playedTacticsCount -= 1;
  appendEvent(state, {
    type: "tactic-cancelled",
    player: command.player,
    cardId: pending.tacticId,
  });
  state.pendingEffect = undefined;
  state.phase = "play-card";
}

function skipPlay(
  state: GameState,
  command: Extract<GameCommand, { type: "skip-play" }>,
): void {
  requireTurn(state, command, "play-card");
  if (
    availableTroopPlays(state, command.player).length > 0 ||
    availableTacticPlays(state, command.player).length > 0
  ) {
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
  if (own.cards.length !== flag.capacity)
    fail("FORMATION_INCOMPLETE", "The claiming formation is incomplete.");
  const decision = evaluateClaim(state, command.player, command.flagId);
  if (!decision.allowed) {
    if (decision.reason === "OPPONENT_CAN_WIN") {
      fail(
        "CLAIM_NOT_PROVEN",
        "The opponent still has a possible winning completion.",
        { witness: decision.witness },
      );
    }
    fail("FORMATION_NOT_STRONGER", "The claiming formation does not win.");
  }

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
  const deck = command.pile === "troop" ? state.troopDeck : state.tacticDeck;
  const cardId = deck.pop();
  if (!cardId) fail("DRAW_PILE_EMPTY", `The ${command.pile} deck is empty.`);
  state.players[command.player].hand.push(cardId);
  appendEvent(state, {
    type: "card-drawn",
    player: command.player,
    cardId,
    pile: command.pile,
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
  else if (command.type === "play-tactic") playTactic(state, command);
  else if (command.type === "choose-scout-draw")
    chooseScoutDraw(state, command);
  else if (command.type === "choose-scout-return")
    chooseScoutReturn(state, command);
  else if (command.type === "choose-tactic-source")
    chooseTacticSource(state, command);
  else if (command.type === "choose-tactic-destination")
    chooseTacticDestination(state, command);
  else if (command.type === "cancel-tactic") cancelTactic(state, command);
  else if (command.type === "skip-play") skipPlay(state, command);
  else if (command.type === "claim-flag") claimFlag(state, command);
  else if (command.type === "pass-claims") passClaims(state, command);
  else if (command.type === "draw-card") drawCard(state, command);
  else if (command.type === "end-turn") endTurn(state, command);
  assertGameState(state);
  return state;
}

function scoutDrawCommands(state: GameState, player: PlayerId): GameCommand[] {
  const commands: GameCommand[] = [];
  const visit = (
    piles: DrawPile[],
    troopRemaining: number,
    tacticRemaining: number,
  ) => {
    if (piles.length === 3) {
      commands.push({ type: "choose-scout-draw", player, piles });
      return;
    }
    if (troopRemaining > 0)
      visit([...piles, "troop"], troopRemaining - 1, tacticRemaining);
    if (tacticRemaining > 0)
      visit([...piles, "tactic"], troopRemaining, tacticRemaining - 1);
  };
  visit([], state.troopDeck.length, state.tacticDeck.length);
  return commands;
}

function pendingEffectCommands(
  state: GameState,
  player: PlayerId,
): GameCommand[] {
  const pending = state.pendingEffect;
  if (!pending) return [];
  if (pending.kind === "scout" && pending.step === "choose-draw")
    return [
      ...scoutDrawCommands(state, player),
      { type: "cancel-tactic", player },
    ];
  if (pending.kind === "scout" && pending.step === "choose-return") {
    const hand = state.players[player].hand;
    return hand.flatMap((first, firstIndex) =>
      hand.flatMap((second, secondIndex) =>
        firstIndex === secondIndex
          ? []
          : [
              {
                type: "choose-scout-return" as const,
                player,
                cardIds: [first, second],
              },
            ],
      ),
    );
  }
  if (pending.step === "choose-source") {
    const owner = pending.kind === "redeploy" ? player : otherPlayer(player);
    const sources = formationCards(
      state,
      owner,
      pending.kind === "traitor",
    ).map((source) => ({
      type: "choose-tactic-source" as const,
      player,
      flagId: source.flagId,
      cardId: source.cardId,
    }));
    return [...sources, { type: "cancel-tactic", player }];
  }
  if (pending.step === "choose-destination" && pending.source) {
    const destinations: GameCommand[] = openDestinations(state, player)
      .filter(
        (flagId) =>
          pending.kind !== "redeploy" || flagId !== pending.source?.flagId,
      )
      .map((flagId) => ({
        type: "choose-tactic-destination" as const,
        player,
        flagId,
      }));
    if (pending.kind === "redeploy")
      destinations.push({
        type: "choose-tactic-destination",
        player,
        discard: true,
      });
    return destinations;
  }
  return [];
}

function canClaim(state: GameState, player: PlayerId, flagId: number): boolean {
  return evaluateClaim(state, player, flagId).allowed;
}

export function getLegalCommands(
  state: GameState,
  player: PlayerId,
): GameCommand[] {
  if (state.phase === "finished" || state.activePlayer !== player) return [];
  if (state.phase === "resolve-tactic")
    return pendingEffectCommands(state, player);
  if (state.phase === "play-card") {
    const plays = [
      ...availableTroopPlays(state, player),
      ...availableTacticPlays(state, player),
    ];
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
  if (state.phase === "draw-card") {
    const draws: GameCommand[] = [];
    if (state.troopDeck.length > 0)
      draws.push({ type: "draw-card", player, pile: "troop" });
    if (state.tacticDeck.length > 0)
      draws.push({ type: "draw-card", player, pile: "tactic" });
    if (draws.length > 0) return draws;
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
