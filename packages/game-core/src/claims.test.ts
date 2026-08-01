import { describe, expect, it } from "vitest";
import {
  buildPublicKnowledge,
  canFormationBeat,
  evaluateClaim,
} from "./claims";
import { applyCommand, getLegalCommands, validateCommand } from "./engine";
import { createEmptyGameState } from "./factories";
import { evaluateFormation } from "./formations";
import type { CardId, GameState } from "./types";

const cards = (...ids: string[]): CardId[] => ids.map((id) => `troop-${id}`);

function claimState(
  ownCards: CardId[],
  opponentCards: CardId[] = [],
): GameState {
  const state = createEmptyGameState("claim-solver");
  state.phase = "optional-claims";
  state.eventIndex = 20;
  state.flags[0].sides["player-one"] = {
    cards: ownCards,
    completedAtEvent: ownCards.length === 3 ? 10 : undefined,
  };
  state.flags[0].sides["player-two"] = {
    cards: opponentCards,
    completedAtEvent: opponentCards.length === 3 ? 15 : undefined,
  };
  return state;
}

describe("public knowledge", () => {
  it("removes public table and discard cards but never hidden hands", () => {
    const state = claimState(
      cards("blue-7", "blue-8", "blue-9"),
      cards("red-8", "red-9"),
    );
    state.players["player-one"].hand.push("troop-red-10");
    state.troopDiscard.push("troop-purple-10");
    state.flags[1].sides["player-two"].cards.push("troop-orange-1");

    const knowledge = buildPublicKnowledge(state);
    expect(knowledge.visibleTroops).toContain("troop-purple-10");
    expect(knowledge.possibleTroops).not.toContain("troop-purple-10");
    expect(knowledge.possibleTroops).not.toContain("troop-orange-1");
    expect(knowledge.possibleTroops).toContain("troop-red-10");
  });
});

describe("early claim solver", () => {
  it("finds a winning completion and returns it as a witness", () => {
    const state = claimState(
      cards("blue-7", "blue-8", "blue-9"),
      cards("red-8", "red-9"),
    );
    state.players["player-one"].hand.push("troop-red-10");

    const result = evaluateClaim(state, "player-one", 0);
    expect(result).toMatchObject({
      allowed: false,
      reason: "OPPONENT_CAN_WIN",
      witness: ["troop-red-10"],
    });
    expect(result.opponentFormation?.kind).toBe("wedge");
  });

  it("allows the maximum wedge against an empty opponent after exhaustive proof", () => {
    const state = claimState(cards("blue-8", "blue-9", "blue-10"));
    const result = evaluateClaim(state, "player-one", 0);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("NO_POSSIBLE_COUNTER");
    expect(result.combinationsChecked).toBeGreaterThan(20_000);
  });

  it("supports an opponent with one card", () => {
    const state = claimState(
      cards("blue-8", "blue-9", "blue-10"),
      cards("red-10"),
    );
    expect(evaluateClaim(state, "player-one", 0).allowed).toBe(true);
  });

  it("uses public discard information to eliminate the only stronger completion", () => {
    const state = claimState(
      cards("blue-7", "blue-8", "blue-9"),
      cards("red-8", "red-9"),
    );
    state.troopDiscard.push("troop-red-10");
    expect(evaluateClaim(state, "player-one", 0)).toMatchObject({
      allowed: true,
      reason: "NO_POSSIBLE_COUNTER",
    });
  });

  it("lets the earlier completed formation win an exact completed tie", () => {
    const state = claimState(
      cards("blue-8", "blue-9", "blue-10"),
      cards("red-8", "red-9", "red-10"),
    );
    expect(evaluateClaim(state, "player-one", 0)).toMatchObject({
      allowed: true,
      reason: "CLAIMANT_FORMATION_WINS",
    });
  });

  it("does not treat a later theoretical exact tie as a counter", () => {
    const incumbent = evaluateFormation(cards("blue-8", "blue-9", "blue-10"));
    const challenger = evaluateFormation(cards("red-8", "red-9", "red-10"));
    expect(canFormationBeat(challenger, incumbent)).toBe(false);
  });
});

describe("claim command integration", () => {
  it("exposes and executes a proven early claim", () => {
    const state = claimState(cards("blue-8", "blue-9", "blue-10"));
    expect(getLegalCommands(state, "player-one")).toContainEqual({
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    const next = applyCommand(state, {
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    expect(next.flags[0].owner).toBe("player-one");
  });

  it("returns the counterexample on an illegal early claim", () => {
    const state = claimState(
      cards("blue-7", "blue-8", "blue-9"),
      cards("red-8", "red-9"),
    );
    const error = validateCommand(state, {
      type: "claim-flag",
      player: "player-one",
      flagId: 0,
    });
    expect(error?.code).toBe("CLAIM_NOT_PROVEN");
    expect(error?.details?.witness).toEqual(["troop-red-10"]);
  });
});
