import { describe, expect, it } from "vitest";
import { chooseAiCommand, type AiDifficulty } from "./ai";
import { applyCommand } from "./engine";
import { createStandardGame } from "./factories";
import { assertGameState } from "./invariants";
import { projectForPlayer } from "./projection";
import { stateFingerprint } from "./replay";

function playAiGame(
  seed: string,
  difficulties: Record<"player-one" | "player-two", AiDifficulty>,
) {
  let state = createStandardGame(seed);
  for (let step = 0; step < 500 && state.phase !== "finished"; step += 1) {
    const view = projectForPlayer(state, state.activePlayer);
    const difficulty = difficulties[state.activePlayer];
    const decision = chooseAiCommand(view, {
      difficulty,
      seed: `${seed}:${state.activePlayer}:${difficulty}`,
      decisionIndex: step,
      timeBudgetMs: 50,
    });
    expect(view.legalCommands).toContainEqual(decision.command);
    expect(decision.withinBudget).toBe(true);
    state = applyCommand(state, decision.command);
    assertGameState(state);
  }
  expect(state.phase).toBe("finished");
  return state;
}

const EASY_MATCH = { "player-one": "easy", "player-two": "easy" } as const;
const STANDARD_MATCH = {
  "player-one": "standard",
  "player-two": "standard",
} as const;

describe("easy AI", () => {
  it("is deterministic, legal and does not mutate PlayerView", () => {
    const state = createStandardGame("ai-deterministic");
    const view = projectForPlayer(state, state.activePlayer);
    const original = structuredClone(view);
    const options = {
      difficulty: "easy" as const,
      seed: "ai-choice-seed",
      decisionIndex: 0,
      timeBudgetMs: 50,
    };
    const first = chooseAiCommand(view, options);
    const second = chooseAiCommand(view, options);
    expect(first.command).toEqual(second.command);
    expect(view.legalCommands).toContainEqual(first.command);
    expect(first.withinBudget).toBe(true);
    expect(view).toEqual(original);
  });

  it("operates on a PlayerView with forbidden full-state fields blocked", () => {
    const state = createStandardGame("ai-no-cheating");
    const view = projectForPlayer(state, state.activePlayer);
    const guarded = new Proxy(view, {
      get(target, property, receiver) {
        if (
          property === "troopDeck" ||
          property === "tacticDeck" ||
          property === "cardUniverse" ||
          property === "seed"
        )
          throw new Error(`AI attempted forbidden access: ${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() =>
      chooseAiCommand(guarded, {
        difficulty: "easy",
        seed: "guarded",
        decisionIndex: 0,
      }),
    ).not.toThrow();
  });

  it("completes 100 reproducible AI-only games without illegal commands", () => {
    const fingerprints: string[] = [];
    for (let game = 0; game < 100; game += 1) {
      fingerprints.push(
        stateFingerprint(playAiGame(`easy-ai-${game}`, EASY_MATCH)),
      );
    }

    expect(fingerprints).toHaveLength(100);
    expect(stateFingerprint(playAiGame("easy-ai-0", EASY_MATCH))).toBe(
      fingerprints[0],
    );
  });
});

describe("standard AI", () => {
  it("is deterministic, legal and stays within the PlayerView boundary", () => {
    const state = createStandardGame("standard-ai-no-cheating");
    const view = projectForPlayer(state, state.activePlayer);
    const original = structuredClone(view);
    const guarded = new Proxy(view, {
      get(target, property, receiver) {
        if (
          property === "troopDeck" ||
          property === "tacticDeck" ||
          property === "cardUniverse" ||
          property === "seed"
        )
          throw new Error(`AI attempted forbidden access: ${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const options = {
      difficulty: "standard" as const,
      seed: "standard-choice-seed",
      decisionIndex: 0,
      timeBudgetMs: 50,
    };
    const first = chooseAiCommand(guarded, options);
    const second = chooseAiCommand(guarded, options);
    expect(first.command).toEqual(second.command);
    expect(view.legalCommands).toContainEqual(first.command);
    expect(first.withinBudget).toBe(true);
    expect(view).toEqual(original);
  });

  it("completes 100 reproducible standard AI games", () => {
    const fingerprints = Array.from({ length: 100 }, (_, game) =>
      stateFingerprint(playAiGame(`standard-ai-${game}`, STANDARD_MATCH)),
    );
    expect(new Set(fingerprints).size).toBeGreaterThan(90);
    expect(stateFingerprint(playAiGame("standard-ai-0", STANDARD_MATCH))).toBe(
      fingerprints[0],
    );
  });

  it("beats easy AI at the fixed 120-game strength threshold", () => {
    let standardWins = 0;
    const games = 120;
    for (let game = 0; game < games; game += 1) {
      const standardPlayer = game % 2 === 0 ? "player-one" : "player-two";
      const state = playAiGame(`standard-vs-easy-${game}`, {
        "player-one": standardPlayer === "player-one" ? "standard" : "easy",
        "player-two": standardPlayer === "player-two" ? "standard" : "easy",
      });
      if (state.winner?.player === standardPlayer) standardWins += 1;
    }

    // 70/120 is above the one-sided 95% binomial threshold for p = 0.5.
    expect(standardWins).toBeGreaterThanOrEqual(70);
  });
});
