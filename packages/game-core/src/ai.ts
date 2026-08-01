import { parseTroopCard } from "./cards";
import { createSeededRandom, pickOne } from "./random";
import type { GameCommand, PlayerView } from "./types";

export const AI_VERSION = "0.1.0-r5.easy";

export type AiDifficulty = "easy";

export type AiOptions = {
  difficulty: AiDifficulty;
  seed: string;
  decisionIndex: number;
  timeBudgetMs?: number;
};

export type AiDecision = {
  command: GameCommand;
  reason: string;
  consideredCommands: number;
  durationMs: number;
  withinBudget: boolean;
};

type ScoredCommand = {
  command: GameCommand;
  score: number;
  reason: string;
};

function troopPlacementScore(
  view: PlayerView,
  command: Extract<GameCommand, { type: "play-troop" }>,
): ScoredCommand {
  const troop = parseTroopCard(command.cardId);
  const side = view.flags[command.flagId]?.sides[view.viewer];
  const existing = (side?.cards ?? []).flatMap((cardId) => {
    try {
      return [parseTroopCard(cardId)];
    } catch {
      return [];
    }
  });
  const sameColor = existing.filter(
    (card) => card.color === troop.color,
  ).length;
  const sameValue = existing.filter(
    (card) => card.value === troop.value,
  ).length;
  const adjacent = existing.filter(
    (card) => Math.abs(card.value - troop.value) === 1,
  ).length;
  const score = 100 + sameColor * 14 + sameValue * 16 + adjacent * 12;
  const pattern =
    sameValue > 0
      ? "补强同点数阵型"
      : sameColor > 0
        ? "补强同色阵型"
        : adjacent > 0
          ? "衔接连续点数"
          : "展开新的阵型方向";
  return { command, score, reason: `${pattern}（战线 ${command.flagId + 1}）` };
}

function scoreCommand(view: PlayerView, command: GameCommand): ScoredCommand {
  if (command.type === "claim-flag")
    return { command, score: 1_000, reason: `占领战线 ${command.flagId + 1}` };
  if (
    command.type === "choose-scout-draw" ||
    command.type === "choose-scout-return" ||
    command.type === "choose-tactic-source" ||
    command.type === "choose-tactic-destination"
  )
    return { command, score: 900, reason: "继续完成当前战术效果" };
  if (command.type === "play-troop") return troopPlacementScore(view, command);
  if (command.type === "play-tactic")
    return { command, score: 104, reason: "使用当前可用战术" };
  if (command.type === "draw-card")
    return {
      command,
      score: 70,
      reason: `从${command.pile === "troop" ? "部队" : "战术"}牌堆补牌`,
    };
  if (command.type === "pass-claims")
    return { command, score: 50, reason: "没有更多可宣告战线" };
  if (command.type === "end-turn")
    return { command, score: 40, reason: "结束当前回合" };
  if (command.type === "skip-play")
    return { command, score: 30, reason: "当前没有可部署卡牌" };
  return { command, score: 1, reason: "取消无收益的战术选择" };
}

export function chooseAiCommand(
  view: PlayerView,
  options: AiOptions,
): AiDecision {
  const startedAt = performance.now();
  if (view.legalCommands.length === 0)
    throw new Error("AI_NO_LEGAL_COMMAND: PlayerView has no legal command.");
  if (!Number.isInteger(options.decisionIndex) || options.decisionIndex < 0)
    throw new RangeError("AI decisionIndex must be a non-negative integer.");

  const scored = view.legalCommands.map((command) =>
    scoreCommand(view, command),
  );
  const bestScore = Math.max(...scored.map((item) => item.score));
  const candidates = scored.filter((item) => item.score === bestScore);
  const random = createSeededRandom(
    `${options.seed}:${options.difficulty}:${options.decisionIndex}`,
  );
  const selected = pickOne(candidates, random);
  const durationMs = performance.now() - startedAt;
  const timeBudgetMs = options.timeBudgetMs ?? 8;
  return {
    command: structuredClone(selected.command),
    reason: selected.reason,
    consideredCommands: view.legalCommands.length,
    durationMs,
    withinBudget: durationMs <= timeBudgetMs,
  };
}
