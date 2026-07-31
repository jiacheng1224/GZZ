import type { FlagState, PlayerId, WinResult } from "./types";

export function detectVictory(
  flags: readonly FlagState[],
  player: PlayerId,
): WinResult | undefined {
  const owned = flags
    .filter((flag) => flag.owner === player)
    .map((flag) => flag.id)
    .sort((a, b) => a - b);
  for (let index = 0; index <= owned.length - 3; index += 1) {
    if (
      owned[index + 1] === owned[index] + 1 &&
      owned[index + 2] === owned[index] + 2
    ) {
      return { player, condition: "breakthrough" };
    }
  }
  return owned.length >= 5 ? { player, condition: "envelopment" } : undefined;
}
