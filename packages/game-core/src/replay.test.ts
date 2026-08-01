import { describe, expect, it } from "vitest";
import { applyCommand } from "./engine";
import { createGuidedGame } from "./factories";
import {
  createReplayArchive,
  exportReplay,
  importReplay,
  replayTo,
  ReplayError,
  stateFingerprint,
} from "./replay";
import type { GameCommand } from "./types";

const commands: GameCommand[] = [
  {
    type: "play-troop",
    player: "player-one",
    cardId: "troop-red-10",
    flagId: 0,
  },
  { type: "claim-flag", player: "player-one", flagId: 0 },
  { type: "pass-claims", player: "player-one" },
  { type: "draw-card", player: "player-one", pile: "troop" },
];

describe("versioned replay archives", () => {
  it("replays forward and backward without mutating the archive", () => {
    const initial = createGuidedGame("replay-guided");
    const archive = createReplayArchive(initial, commands);
    const original = structuredClone(archive);

    expect(replayTo(archive, 0)).toEqual(initial);
    expect(replayTo(archive, 1).phase).toBe("optional-claims");
    expect(replayTo(archive, 2).flags[0].owner).toBe("player-one");
    expect(replayTo(archive).activePlayer).toBe("player-two");
    expect(archive).toEqual(original);
  });

  it("round-trips a verified archive and matches direct execution", () => {
    const initial = createGuidedGame("replay-round-trip");
    const archive = importReplay(
      exportReplay(createReplayArchive(initial, commands)),
    );
    const direct = commands.reduce(applyCommand, initial);
    expect(stateFingerprint(replayTo(archive))).toBe(stateFingerprint(direct));
  });

  it("rejects tampered commands, hashes and timeline positions", () => {
    const archive = createReplayArchive(
      createGuidedGame("replay-tamper"),
      commands,
    );
    const badHash = { ...archive, finalStateHash: "fnv1a-deadbeef" };
    expect(() => importReplay(JSON.stringify(badHash))).toThrowError(
      expect.objectContaining<Partial<ReplayError>>({
        code: "FINAL_STATE_MISMATCH",
      }),
    );

    const badCommands = structuredClone(archive.commands) as GameCommand[];
    badCommands[0] = {
      ...badCommands[0],
      player: "player-two",
    } as GameCommand;
    const badCommand = { ...archive, commands: badCommands };
    expect(() => replayTo(badCommand)).toThrowError(
      expect.objectContaining<Partial<ReplayError>>({
        code: "INVALID_COMMAND_STREAM",
      }),
    );
    expect(() => replayTo(archive, archive.commands.length + 1)).toThrowError(
      expect.objectContaining<Partial<ReplayError>>({
        code: "INVALID_COMMAND_INDEX",
      }),
    );
  });
});
