import {
  formatBattleReport,
  simulateBasicGame,
} from "../packages/game-core/src/index";

const seed = process.argv[2] ?? "r1-demo";
const { state } = simulateBasicGame(seed);
console.log(formatBattleReport(state));
