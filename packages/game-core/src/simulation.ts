import { applyCommand, getLegalCommands } from "./engine";
import { createBasicGame, createStandardGame } from "./factories";
import { assertGameState } from "./invariants";
import { createSeededRandom, pickOne } from "./random";
import { getTacticCard } from "./tactics";
import type { GameCommand, GameState, PlayerId } from "./types";

export type SimulationResult = {
  state: GameState;
  commands: GameCommand[];
};

type SimulationOptions = {
  maximumCommands: number;
  preferTactics: boolean;
};

function chooseCommand(
  state: GameState,
  legal: readonly GameCommand[],
  random: () => number,
  options: SimulationOptions,
): GameCommand {
  const claims = legal.filter((command) => command.type === "claim-flag");
  if (claims.length > 0) return pickOne(claims, random);

  const scoutReturns = legal.filter(
    (command) => command.type === "choose-scout-return",
  );
  if (scoutReturns.length > 0) {
    const tacticHeavy = scoutReturns.filter(
      (command) =>
        command.type === "choose-scout-return" &&
        command.cardIds.filter((cardId) => getTacticCard(cardId)).length === 2,
    );
    return pickOne(tacticHeavy.length > 0 ? tacticHeavy : scoutReturns, random);
  }

  const effectSteps = legal.filter(
    (command) => command.type !== "cancel-tactic",
  );
  if (
    legal.some(
      (command) =>
        command.type === "choose-scout-draw" ||
        command.type === "choose-scout-return" ||
        command.type === "choose-tactic-source" ||
        command.type === "choose-tactic-destination",
    ) &&
    effectSteps.length > 0
  ) {
    return pickOne(effectSteps, random);
  }

  if (options.preferTactics) {
    const tactics = legal.filter((command) => command.type === "play-tactic");
    if (tactics.length > 0 && random() < 0.4) return pickOne(tactics, random);
  }

  const troopDraw = legal.find(
    (command) => command.type === "draw-card" && command.pile === "troop",
  );
  const tacticDraw = legal.find(
    (command) => command.type === "draw-card" && command.pile === "tactic",
  );
  if (troopDraw && tacticDraw) {
    const player = state.activePlayer;
    const opponent = player === "player-one" ? "player-two" : "player-one";
    const ownTactics = state.players[player].hand.filter(getTacticCard).length;
    const opponentTactics =
      state.players[opponent].hand.filter(getTacticCard).length;
    return ownTactics <= opponentTactics ? tacticDraw : troopDraw;
  }
  return pickOne(legal, random);
}

function simulate(
  seed: string,
  firstPlayer: PlayerId,
  initial: GameState,
  options: SimulationOptions,
): SimulationResult {
  const random = createSeededRandom(`${seed}:choices`);
  let state = initial;
  const commands: GameCommand[] = [];

  for (
    let step = 0;
    step < options.maximumCommands && state.phase !== "finished";
    step += 1
  ) {
    const legal = getLegalCommands(state, state.activePlayer);
    if (legal.length === 0)
      throw new Error(
        `Simulation deadlocked at turn ${state.turn}, phase ${state.phase}.`,
      );
    const command = chooseCommand(state, legal, random, options);
    commands.push(command);
    state = applyCommand(state, command);
    assertGameState(state);
  }

  if (state.phase !== "finished")
    throw new Error(
      `Simulation ${seed} exceeded the ${options.maximumCommands}-command safety limit at turn ${state.turn}, phase ${state.phase}; deck counts ${state.troopDeck.length}/${state.tacticDeck.length}, hand counts ${state.players["player-one"].hand.length}/${state.players["player-two"].hand.length}.`,
    );
  return { state, commands };
}

export function simulateBasicGame(
  seed: string,
  firstPlayer: PlayerId = "player-one",
): SimulationResult {
  return simulate(seed, firstPlayer, createBasicGame(seed, firstPlayer), {
    maximumCommands: 200,
    preferTactics: false,
  });
}

export function simulateStandardGame(
  seed: string,
  firstPlayer: PlayerId = "player-one",
): SimulationResult {
  return simulate(seed, firstPlayer, createStandardGame(seed, firstPlayer), {
    maximumCommands: 500,
    preferTactics: true,
  });
}
