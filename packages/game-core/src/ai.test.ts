import { describe, expect, it } from "vitest";
import { chooseAiCommand } from "./ai";
import { applyCommand } from "./engine";
import { createStandardGame } from "./factories";
import { assertGameState } from "./invariants";
import { projectForPlayer } from "./projection";
import { stateFingerprint } from "./replay";

function playEasyAiGame(seed: string) {
  let state = createStandardGame(seed);
  for (let step = 0; step < 500 && state.phase !== "finished"; step += 1) {
    const view = projectForPlayer(state, state.activePlayer);
    const decision = chooseAiCommand(view, {
      difficulty: "easy",
      seed: `${seed}:agent`,
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
      fingerprints.push(stateFingerprint(playEasyAiGame(`easy-ai-${game}`)));
    }

    expect(fingerprints).toHaveLength(100);
    expect(stateFingerprint(playEasyAiGame("easy-ai-0"))).toBe(fingerprints[0]);
  });
});
