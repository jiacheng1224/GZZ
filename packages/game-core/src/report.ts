import type { GameEvent, GameState } from "./types";

function eventLine(event: GameEvent): string {
  const prefix = `[${String(event.index).padStart(3, "0")}]`;
  if (event.type === "game-started")
    return `${prefix} 开局：${event.firstPlayer} 先手（种子 ${event.seed}）`;
  if (event.type === "turn-started")
    return `${prefix} 第 ${event.turn} 回合：${event.player}`;
  if (event.type === "troop-played")
    return `${prefix} ${event.player} 将 ${event.cardId} 部署到战线 ${event.flagId + 1}`;
  if (event.type === "tactic-played")
    return event.flagId === undefined
      ? `${prefix} ${event.player} 打出战术 ${event.cardId}`
      : `${prefix} ${event.player} 将战术 ${event.cardId} 打到战线 ${event.flagId + 1}`;
  if (event.type === "scout-drawn")
    return `${prefix} ${event.player} 使用侦察抽取 ${event.cards.length} 张牌`;
  if (event.type === "scout-returned")
    return `${prefix} ${event.player} 将 ${event.cards.length} 张牌放回牌堆顶`;
  if (event.type === "field-card-moved")
    return event.discarded
      ? `${prefix} ${event.player} 将 ${event.cardId} 从战线 ${event.fromFlagId + 1} 弃置`
      : `${prefix} ${event.player} 将 ${event.cardId} 从战线 ${event.fromFlagId + 1} 移至战线 ${(event.toFlagId ?? 0) + 1}`;
  if (event.type === "tactic-cancelled")
    return `${prefix} ${event.player} 取消战术 ${event.cardId}`;
  if (event.type === "tactic-resolved")
    return `${prefix} ${event.player} 完成战术 ${event.cardId}`;
  if (event.type === "flag-claimed")
    return `${prefix} ${event.player} 占领战线 ${event.flagId + 1}`;
  if (event.type === "card-drawn")
    return `${prefix} ${event.player} 从${event.pile === "troop" ? "部队" : "战术"}牌堆抓取 ${event.cardId}`;
  return `${prefix} ${event.player} 以 ${event.condition} 获胜`;
}

export function formatBattleReport(state: GameState): string {
  const header = `《古战阵》基础局战报\n规则版本: ${state.version} | 种子: ${state.seed}`;
  return [header, ...state.events.map(eventLine)].join("\n");
}
