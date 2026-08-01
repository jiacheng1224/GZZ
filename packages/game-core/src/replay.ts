import { applyCommand } from "./engine";
import { assertGameState } from "./invariants";
import type { GameCommand, GameState, ReplayArchive } from "./types";

export type ReplayErrorCode =
  | "INVALID_REPLAY"
  | "INVALID_COMMAND_INDEX"
  | "INVALID_COMMAND_STREAM"
  | "FINAL_STATE_MISMATCH";

export class ReplayError extends Error {
  constructor(
    public readonly code: ReplayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

const clone = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;

export function stateFingerprint(state: GameState): string {
  const value = JSON.stringify(state);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validateArchiveShape(value: unknown): asserts value is ReplayArchive {
  if (!value || typeof value !== "object")
    throw new ReplayError("INVALID_REPLAY", "Replay must be an object.");
  const candidate = value as Partial<ReplayArchive>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.rulesVersion !== "number" ||
    typeof candidate.seed !== "string" ||
    !candidate.initialState ||
    !Array.isArray(candidate.commands) ||
    typeof candidate.finalStateHash !== "string"
  ) {
    throw new ReplayError(
      "INVALID_REPLAY",
      "Replay schema or required fields are invalid.",
    );
  }
}

export function replayTo(
  archive: ReplayArchive,
  commandCount = archive.commands.length,
): GameState {
  validateArchiveShape(archive);
  if (
    !Number.isInteger(commandCount) ||
    commandCount < 0 ||
    commandCount > archive.commands.length
  ) {
    throw new ReplayError(
      "INVALID_COMMAND_INDEX",
      `Command index ${commandCount} is outside the replay timeline.`,
    );
  }

  let state = clone(archive.initialState);
  assertGameState(state);
  for (let index = 0; index < commandCount; index += 1) {
    try {
      state = applyCommand(state, clone(archive.commands[index]));
    } catch (error) {
      throw new ReplayError(
        "INVALID_COMMAND_STREAM",
        `Replay command ${index + 1} is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  assertGameState(state);
  return state;
}

export function createReplayArchive(
  initialState: GameState,
  commands: readonly GameCommand[],
): ReplayArchive {
  assertGameState(initialState);
  const draft = {
    schemaVersion: 1,
    rulesVersion: initialState.version,
    seed: initialState.seed,
    initialState: clone(initialState),
    commands: clone(commands),
    finalStateHash: "",
  } as const;
  const finalState = replayTo(draft);
  return {
    ...draft,
    finalStateHash: stateFingerprint(finalState),
  };
}

export function exportReplay(archive: ReplayArchive): string {
  const verified = importReplay(JSON.stringify(archive));
  return JSON.stringify(verified, null, 2);
}

export function importReplay(serialized: string): ReplayArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ReplayError("INVALID_REPLAY", "Replay is not valid JSON.");
  }
  validateArchiveShape(parsed);
  if (parsed.rulesVersion !== parsed.initialState.version)
    throw new ReplayError(
      "INVALID_REPLAY",
      "Replay rules version does not match its initial state.",
    );
  if (parsed.seed !== parsed.initialState.seed)
    throw new ReplayError(
      "INVALID_REPLAY",
      "Replay seed does not match its initial state.",
    );
  const archive = clone(parsed);
  const finalState = replayTo(archive);
  if (stateFingerprint(finalState) !== archive.finalStateHash)
    throw new ReplayError(
      "FINAL_STATE_MISMATCH",
      "Replay final state fingerprint does not match.",
    );
  return archive;
}
