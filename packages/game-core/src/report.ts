import type { GameEvent, GameState } from "./types";

function eventLine(event: GameEvent): string {
  const prefix = `[${String(event.index).padStart(3, "0")}]`;
  if (event.type === "game-started")
    return `${prefix} 开局：${event.firstPlayer} 先手（种子 ${event.seed}）`;
  if (event.type === "turn-started")
    return `${prefix} 第 ${event.turn} 回合：${event.player}`;
  if (event.type === "troop-played")
    return `${prefix} ${event.player} 将 ${event.cardId} 部署到战线 ${event.flagId + 1}`;
  if (event.type === "flag-claimed")
    return `${prefix} ${event.player} 占领战线 ${event.flagId + 1}`;
  if (event.type === "card-drawn")
    return `${prefix} ${event.player} 从部队牌堆抓取 ${event.cardId}`;
  return `${prefix} ${event.player} 以 ${event.condition} 获胜`;
}

export function formatBattleReport(state: GameState): string {
  const header = `《古战阵》基础局战报\n规则版本: ${state.version} | 种子: ${state.seed}`;
  return [header, ...state.events.map(eventLine)].join("\n");
}
