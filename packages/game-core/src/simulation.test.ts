import { describe, expect, it } from "vitest";
import { formatBattleReport } from "./report";
import { simulateBasicGame, simulateStandardGame } from "./simulation";

describe("random basic-game harness", () => {
  it("completes 1,000 deterministic games without deadlocks or invariant failures", () => {
    for (let index = 0; index < 1_000; index += 1) {
      const { state } = simulateBasicGame(
        `r1-harness-${index}`,
        index % 2 ? "player-one" : "player-two",
      );
      expect(state.phase).toBe("finished");
      expect(state.winner).toBeDefined();
    }
  }, 30_000);

  it("prints a complete text battle report", () => {
    const { state } = simulateBasicGame("report-fixture");
    const report = formatBattleReport(state);
    expect(report).toContain("《古战阵》基础局战报");
    expect(report).toContain("获胜");
  });
});

describe("random complete-rules harness", () => {
  it("replays a standard game deterministically", () => {
    expect(simulateStandardGame("standard-replay")).toEqual(
      simulateStandardGame("standard-replay"),
    );
  });

  it("completes standard games while exercising every tactic", () => {
    const tactics = new Set<string>();
    for (let index = 0; index < 250; index += 1) {
      const { state } = simulateStandardGame(
        `standard-coverage-${index}`,
        index % 2 ? "player-one" : "player-two",
      );
      expect(state.phase).toBe("finished");
      for (const event of state.events) {
        if (event.type === "tactic-played") tactics.add(event.cardId);
      }
    }
    expect(tactics).toEqual(
      new Set([
        "tactic-leader-alexander",
        "tactic-leader-darius",
        "tactic-companion-cavalry",
        "tactic-shield-bearers",
        "tactic-fog",
        "tactic-mud",
        "tactic-scout",
        "tactic-redeploy",
        "tactic-deserter",
        "tactic-traitor",
      ]),
    );
  }, 30_000);
});
