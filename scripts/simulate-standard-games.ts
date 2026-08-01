import {
  buildGameSummary,
  simulateStandardGame,
} from "../packages/game-core/src";

const requested = Number(process.argv[2] ?? "5000");
if (!Number.isInteger(requested) || requested < 1) {
  throw new RangeError("Simulation count must be a positive integer.");
}

const tacticIds = new Set<string>();
const winners = { "player-one": 0, "player-two": 0 };
const conditions = { breakthrough: 0, envelopment: 0 };
let maximumCommands = 0;

for (let index = 0; index < requested; index += 1) {
  const result = simulateStandardGame(
    `r2-exit-${index}`,
    index % 2 === 0 ? "player-one" : "player-two",
  );
  const summary = buildGameSummary(result.state);
  winners[summary.winner] += 1;
  conditions[summary.condition] += 1;
  maximumCommands = Math.max(maximumCommands, result.commands.length);
  for (const event of result.state.events) {
    if (event.type === "tactic-played") tacticIds.add(event.cardId);
  }
}

console.log(
  JSON.stringify(
    {
      games: requested,
      winners,
      conditions,
      maximumCommands,
      tacticsExercised: [...tacticIds].sort(),
      status: "passed",
    },
    null,
    2,
  ),
);
