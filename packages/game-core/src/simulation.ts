import { applyCommand, getLegalCommands } from "./engine";
import { createBasicGame } from "./factories";
import { assertGameState } from "./invariants";
import { createSeededRandom, pickOne } from "./random";
import type { GameCommand, GameState, PlayerId } from "./types";

export type SimulationResult = {
  state: GameState;
  commands: GameCommand[];
};

export function simulateBasicGame(
  seed: string,
  firstPlayer: PlayerId = "player-one",
): SimulationResult {
  const random = createSeededRandom(`${seed}:choices`);
  let state = createBasicGame(seed, firstPlayer);
  const commands: GameCommand[] = [];

  for (let step = 0; step < 200 && state.phase !== "finished"; step += 1) {
    const legal = getLegalCommands(state, state.activePlayer);
    if (legal.length === 0)
      throw new Error(
        `Simulation deadlocked at turn ${state.turn}, phase ${state.phase}.`,
      );
    const claims = legal.filter((command) => command.type === "claim-flag");
    const command =
      claims.length > 0 ? pickOne(claims, random) : pickOne(legal, random);
    commands.push(command);
    state = applyCommand(state, command);
    assertGameState(state);
  }

  if (state.phase !== "finished")
    throw new Error("Simulation exceeded the 200-command safety limit.");
  return { state, commands };
}
