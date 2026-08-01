import type {
  FlagState,
  GameState,
  GameSummary,
  PlayerId,
  WinResult,
} from "./types";

function ownedFlagIds(flags: readonly FlagState[], player: PlayerId): number[] {
  return flags
    .filter((flag) => flag.owner === player)
    .map((flag) => flag.id)
    .sort((a, b) => a - b);
}

function breakthroughFlags(owned: readonly number[]): number[] | undefined {
  for (let index = 0; index <= owned.length - 3; index += 1) {
    if (
      owned[index + 1] === owned[index] + 1 &&
      owned[index + 2] === owned[index] + 2
    ) {
      return owned.slice(index, index + 3);
    }
  }
  return undefined;
}

export function detectVictory(
  flags: readonly FlagState[],
  player: PlayerId,
): WinResult | undefined {
  const owned = ownedFlagIds(flags, player);
  if (breakthroughFlags(owned)) return { player, condition: "breakthrough" };
  return owned.length >= 5 ? { player, condition: "envelopment" } : undefined;
}

export function buildGameSummary(state: GameState): GameSummary {
  if (state.phase !== "finished" || !state.winner) {
    throw new RangeError("A game summary requires a finished game.");
  }
  const one = ownedFlagIds(state.flags, "player-one");
  const two = ownedFlagIds(state.flags, "player-two");
  const winnerFlags = state.winner.player === "player-one" ? one : two;
  const winningFlags =
    state.winner.condition === "breakthrough"
      ? breakthroughFlags(winnerFlags)
      : winnerFlags.slice(0, 5);
  if (!winningFlags)
    throw new RangeError(
      "The final flags do not support the recorded victory.",
    );

  const claimedFlags = Object.freeze({
    "player-one": Object.freeze(one),
    "player-two": Object.freeze(two),
  });
  return Object.freeze({
    schemaVersion: 1,
    rulesVersion: state.version,
    seed: state.seed,
    winner: state.winner.player,
    condition: state.winner.condition,
    winningFlags: Object.freeze(winningFlags),
    claimedFlags,
    turns: state.turn,
    eventCount: state.events.length,
  });
}
