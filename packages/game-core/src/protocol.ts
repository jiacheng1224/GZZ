import { applyCommand } from "./engine";
import { assertGameState } from "./invariants";
import { projectForPlayer } from "./projection";
import type {
  DrawPile,
  GameCommand,
  GameState,
  PlayerId,
  PlayerView,
  ProjectedGameEvent,
} from "./types";

export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_SCHEMA_VERSION = 1 as const;

export type ProtocolErrorCode =
  | "INVALID_ENVELOPE"
  | "UNSUPPORTED_PROTOCOL"
  | "ROOM_MISMATCH"
  | "PLAYER_MISMATCH"
  | "COMMAND_ACTOR_MISMATCH"
  | "COMMAND_ID_CONFLICT"
  | "OUT_OF_ORDER_COMMAND"
  | "STALE_STATE_VERSION"
  | "RULE_REJECTED";

export type CommandEnvelope = {
  readonly schemaVersion: 1;
  readonly protocolVersion: number;
  readonly messageType: "command";
  readonly roomId: string;
  readonly commandId: string;
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly clientVersion: string;
  readonly expectedStateVersion: number;
  readonly command: GameCommand;
};

export type ProtocolSnapshot = {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly messageType: "snapshot";
  readonly roomId: string;
  readonly recipient: PlayerId;
  readonly stateVersion: number;
  readonly eventCursor: number;
  readonly nextSequence: number;
  readonly snapshot: PlayerView;
};

export type ProtocolCommandAccepted = {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly messageType: "command-result";
  readonly roomId: string;
  readonly commandId: string;
  readonly sequence: number;
  readonly status: "accepted" | "duplicate";
  readonly stateVersion: number;
  readonly eventCursor: number;
  readonly events: readonly ProjectedGameEvent[];
  readonly snapshot: PlayerView;
};

export type ProtocolCommandRejected = {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly messageType: "command-result";
  readonly roomId: string;
  readonly commandId: string;
  readonly sequence?: number;
  readonly status: "rejected";
  readonly code: ProtocolErrorCode;
  readonly message: string;
  readonly stateVersion: number;
  readonly expectedSequence?: number;
  readonly requiredProtocolVersion?: number;
  readonly snapshot?: PlayerView;
};

export type ProtocolCommandResult =
  ProtocolCommandAccepted | ProtocolCommandRejected;

type ProcessedCommand = {
  readonly fingerprint: string;
  readonly playerId: PlayerId;
  readonly sequence: number;
};

export type ProtocolAuthority = {
  readonly roomId: string;
  readonly state: GameState;
  readonly stateVersion: number;
  readonly nextSequence: Readonly<Record<PlayerId, number>>;
  readonly processedCommands: Readonly<Record<string, ProcessedCommand>>;
};

export type ProtocolTransition = {
  readonly authority: ProtocolAuthority;
  readonly response: ProtocolCommandResult;
};

export class ProtocolError extends Error {
  constructor(
    public readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const isPlayerId = (value: unknown): value is PlayerId =>
  value === "player-one" || value === "player-two";

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9._:-]+$/.test(value);

const isInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum;

function invalid(message: string): never {
  throw new ProtocolError("INVALID_ENVELOPE", message);
}

function decodePiles(value: unknown): DrawPile[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((pile) => pile !== "troop" && pile !== "tactic")
  )
    invalid("Command piles must contain only troop or tactic values.");
  return [...value] as DrawPile[];
}

function decodeCardIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((cardId) => typeof cardId !== "string" || cardId.length > 128)
  )
    invalid("Command cardIds must be an array of strings.");
  return [...value] as string[];
}

function decodeCommand(value: unknown): GameCommand {
  if (!value || typeof value !== "object")
    invalid("Command must be an object.");
  const command = value as Record<string, unknown>;
  if (typeof command.type !== "string" || !isPlayerId(command.player))
    invalid("Command type and player are required.");
  const player = command.player;
  const cardId = () => {
    if (
      typeof command.cardId !== "string" ||
      command.cardId.length === 0 ||
      command.cardId.length > 128
    )
      invalid("Command cardId is required.");
    return command.cardId;
  };
  const flagId = () => {
    if (!isInteger(command.flagId))
      invalid("Command flagId must be a non-negative integer.");
    return command.flagId;
  };

  if (command.type === "play-troop")
    return { type: command.type, player, cardId: cardId(), flagId: flagId() };
  if (command.type === "play-tactic") {
    if (command.flagId !== undefined && !isInteger(command.flagId))
      invalid("Tactic flagId must be a non-negative integer when present.");
    return {
      type: command.type,
      player,
      cardId: cardId(),
      ...(command.flagId === undefined ? {} : { flagId: command.flagId }),
    };
  }
  if (command.type === "choose-scout-draw")
    return { type: command.type, player, piles: decodePiles(command.piles) };
  if (command.type === "choose-scout-return")
    return {
      type: command.type,
      player,
      cardIds: decodeCardIds(command.cardIds),
    };
  if (command.type === "choose-tactic-source")
    return { type: command.type, player, flagId: flagId(), cardId: cardId() };
  if (command.type === "choose-tactic-destination") {
    if (command.flagId !== undefined && !isInteger(command.flagId))
      invalid(
        "Destination flagId must be a non-negative integer when present.",
      );
    if (command.discard !== undefined && typeof command.discard !== "boolean")
      invalid("Destination discard must be a boolean when present.");
    return {
      type: command.type,
      player,
      ...(command.flagId === undefined ? {} : { flagId: command.flagId }),
      ...(command.discard === undefined ? {} : { discard: command.discard }),
    };
  }
  if (
    command.type === "cancel-tactic" ||
    command.type === "skip-play" ||
    command.type === "pass-claims" ||
    command.type === "end-turn"
  )
    return { type: command.type, player };
  if (command.type === "claim-flag")
    return { type: command.type, player, flagId: flagId() };
  if (command.type === "draw-card") {
    if (command.pile !== "troop" && command.pile !== "tactic")
      invalid("Draw pile must be troop or tactic.");
    return { type: command.type, player, pile: command.pile };
  }
  invalid(`Unknown command type: ${command.type}.`);
}

export function decodeCommandEnvelope(value: unknown): CommandEnvelope {
  if (!value || typeof value !== "object")
    invalid("Envelope must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== PROTOCOL_SCHEMA_VERSION)
    invalid("Envelope schemaVersion is unsupported.");
  if (!isInteger(candidate.protocolVersion, 1))
    invalid("Envelope protocolVersion must be a positive integer.");
  if (candidate.messageType !== "command")
    invalid("Envelope messageType must be command.");
  if (!isIdentifier(candidate.roomId)) invalid("Envelope roomId is invalid.");
  if (!isIdentifier(candidate.commandId))
    invalid("Envelope commandId is invalid.");
  if (!isInteger(candidate.sequence, 1))
    invalid("Envelope sequence must be a positive integer.");
  if (!isPlayerId(candidate.playerId)) invalid("Envelope playerId is invalid.");
  if (
    typeof candidate.clientVersion !== "string" ||
    candidate.clientVersion.length === 0 ||
    candidate.clientVersion.length > 64
  )
    invalid("Envelope clientVersion is invalid.");
  if (!isInteger(candidate.expectedStateVersion))
    invalid("Envelope expectedStateVersion must be a non-negative integer.");
  return {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    protocolVersion: candidate.protocolVersion,
    messageType: "command",
    roomId: candidate.roomId,
    commandId: candidate.commandId,
    sequence: candidate.sequence,
    playerId: candidate.playerId,
    clientVersion: candidate.clientVersion,
    expectedStateVersion: candidate.expectedStateVersion,
    command: decodeCommand(candidate.command),
  };
}

export function createCommandEnvelope(
  input: Omit<
    CommandEnvelope,
    "schemaVersion" | "protocolVersion" | "messageType"
  > & {
    protocolVersion?: number;
  },
): CommandEnvelope {
  return decodeCommandEnvelope({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    protocolVersion: input.protocolVersion ?? PROTOCOL_VERSION,
    messageType: "command",
    ...input,
  });
}

export function createProtocolAuthority(
  roomId: string,
  state: GameState,
): ProtocolAuthority {
  if (!isIdentifier(roomId)) invalid("Authority roomId is invalid.");
  assertGameState(state);
  return {
    roomId,
    state: clone(state),
    stateVersion: 0,
    nextSequence: { "player-one": 1, "player-two": 1 },
    processedCommands: {},
  };
}

function protocolView(
  authority: ProtocolAuthority,
  player: PlayerId,
): PlayerView {
  return {
    ...projectForPlayer(authority.state, player),
    stateVersion: authority.stateVersion,
  };
}

export function createReconnectSnapshot(
  authority: ProtocolAuthority,
  player: PlayerId,
): ProtocolSnapshot {
  return {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    messageType: "snapshot",
    roomId: authority.roomId,
    recipient: player,
    stateVersion: authority.stateVersion,
    eventCursor: authority.state.eventIndex,
    nextSequence: authority.nextSequence[player],
    snapshot: protocolView(authority, player),
  };
}

function rejected(
  authority: ProtocolAuthority,
  code: ProtocolErrorCode,
  message: string,
  details: {
    commandId?: string;
    sequence?: number;
    player?: PlayerId;
    expectedSequence?: number;
    requiredProtocolVersion?: number;
  } = {},
): ProtocolCommandRejected {
  return {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    messageType: "command-result",
    roomId: authority.roomId,
    commandId: details.commandId ?? "unknown",
    ...(details.sequence === undefined ? {} : { sequence: details.sequence }),
    status: "rejected",
    code,
    message,
    stateVersion: authority.stateVersion,
    ...(details.expectedSequence === undefined
      ? {}
      : { expectedSequence: details.expectedSequence }),
    ...(details.requiredProtocolVersion === undefined
      ? {}
      : { requiredProtocolVersion: details.requiredProtocolVersion }),
    ...(details.player
      ? { snapshot: protocolView(authority, details.player) }
      : {}),
  };
}

function rawIdentifier(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = (value as Record<string, unknown>)[field];
  return typeof item === "string" ? item : undefined;
}

export function processProtocolCommand(
  current: ProtocolAuthority,
  rawEnvelope: unknown,
  authenticatedPlayer: PlayerId,
): ProtocolTransition {
  let envelope: CommandEnvelope;
  try {
    envelope = decodeCommandEnvelope(rawEnvelope);
  } catch (error) {
    return {
      authority: current,
      response: rejected(
        current,
        "INVALID_ENVELOPE",
        error instanceof Error ? error.message : "Envelope is invalid.",
        { commandId: rawIdentifier(rawEnvelope, "commandId") },
      ),
    };
  }

  const details = {
    commandId: envelope.commandId,
    sequence: envelope.sequence,
  };
  if (envelope.protocolVersion !== PROTOCOL_VERSION)
    return {
      authority: current,
      response: rejected(
        current,
        "UNSUPPORTED_PROTOCOL",
        `Protocol ${envelope.protocolVersion} is unsupported; upgrade to ${PROTOCOL_VERSION}.`,
        { ...details, requiredProtocolVersion: PROTOCOL_VERSION },
      ),
    };
  if (envelope.roomId !== current.roomId)
    return {
      authority: current,
      response: rejected(
        current,
        "ROOM_MISMATCH",
        "Command room does not match authority.",
        details,
      ),
    };
  if (envelope.playerId !== authenticatedPlayer)
    return {
      authority: current,
      response: rejected(
        current,
        "PLAYER_MISMATCH",
        "Envelope player does not match authenticated player.",
        details,
      ),
    };
  if (envelope.command.player !== authenticatedPlayer)
    return {
      authority: current,
      response: rejected(
        current,
        "COMMAND_ACTOR_MISMATCH",
        "Command actor does not match authenticated player.",
        details,
      ),
    };

  const fingerprint = JSON.stringify(envelope);
  const processed = current.processedCommands[envelope.commandId];
  if (processed) {
    if (processed.fingerprint !== fingerprint)
      return {
        authority: current,
        response: rejected(
          current,
          "COMMAND_ID_CONFLICT",
          "Command ID was already used with different content.",
          details,
        ),
      };
    const snapshot = protocolView(current, authenticatedPlayer);
    return {
      authority: current,
      response: {
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        messageType: "command-result",
        roomId: current.roomId,
        commandId: envelope.commandId,
        sequence: envelope.sequence,
        status: "duplicate",
        stateVersion: current.stateVersion,
        eventCursor: current.state.eventIndex,
        events: [],
        snapshot,
      },
    };
  }

  const expectedSequence = current.nextSequence[authenticatedPlayer];
  if (envelope.sequence !== expectedSequence)
    return {
      authority: current,
      response: rejected(
        current,
        "OUT_OF_ORDER_COMMAND",
        `Expected sequence ${expectedSequence}, received ${envelope.sequence}.`,
        {
          ...details,
          player: authenticatedPlayer,
          expectedSequence,
        },
      ),
    };
  if (envelope.expectedStateVersion !== current.stateVersion)
    return {
      authority: current,
      response: rejected(
        current,
        "STALE_STATE_VERSION",
        `Expected state version ${current.stateVersion}, received ${envelope.expectedStateVersion}.`,
        {
          ...details,
          player: authenticatedPlayer,
        },
      ),
    };

  const previousEventIndex = current.state.eventIndex;
  let nextState: GameState;
  try {
    nextState = applyCommand(current.state, envelope.command);
  } catch (error) {
    return {
      authority: current,
      response: rejected(
        current,
        "RULE_REJECTED",
        error instanceof Error
          ? error.message
          : "Rule engine rejected command.",
        { ...details, player: authenticatedPlayer },
      ),
    };
  }
  const nextAuthority: ProtocolAuthority = {
    roomId: current.roomId,
    state: nextState,
    stateVersion: current.stateVersion + 1,
    nextSequence: {
      ...current.nextSequence,
      [authenticatedPlayer]: expectedSequence + 1,
    },
    processedCommands: {
      ...current.processedCommands,
      [envelope.commandId]: {
        fingerprint,
        playerId: authenticatedPlayer,
        sequence: envelope.sequence,
      },
    },
  };
  const snapshot = protocolView(nextAuthority, authenticatedPlayer);
  return {
    authority: nextAuthority,
    response: {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      messageType: "command-result",
      roomId: nextAuthority.roomId,
      commandId: envelope.commandId,
      sequence: envelope.sequence,
      status: "accepted",
      stateVersion: nextAuthority.stateVersion,
      eventCursor: nextAuthority.state.eventIndex,
      events: snapshot.events.filter(
        (event) => event.index > previousEventIndex,
      ),
      snapshot,
    },
  };
}
