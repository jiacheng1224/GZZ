import { isTroopCard, parseTroopCard } from "./cards";
import { evaluateFormation } from "./formations";
import { createSeededRandom, pickOne } from "./random";
import { getTacticCard, isMorale } from "./tactics";
import type {
  CardId,
  FlagState,
  GameCommand,
  PlayerId,
  PlayerView,
} from "./types";

export const AI_VERSION = "0.2.0-r5.standard";

export type AiDifficulty = "easy" | "standard";

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

const otherPlayer = (player: PlayerId): PlayerId =>
  player === "player-one" ? "player-two" : "player-one";

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

function scoreEasyCommand(
  view: PlayerView,
  command: GameCommand,
): ScoredCommand {
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

function formationPotential(cards: readonly CardId[]): number {
  const troops = cards.flatMap((cardId) => {
    try {
      return [parseTroopCard(cardId)];
    } catch {
      return [];
    }
  });
  let score =
    cards.length * 28 + troops.reduce((sum, card) => sum + card.value * 2, 0);
  score += cards.filter((cardId) => isMorale(cardId)).length * 48;
  for (let left = 0; left < troops.length; left += 1) {
    for (let right = left + 1; right < troops.length; right += 1) {
      if (troops[left].color === troops[right].color) score += 24;
      if (troops[left].value === troops[right].value) score += 30;
      const distance = Math.abs(troops[left].value - troops[right].value);
      if (distance === 1) score += 22;
      else if (distance === 2) score += 8;
    }
  }
  if (cards.length === 3 || cards.length === 4) {
    try {
      const formation = evaluateFormation(cards);
      score += formation.strength * 95 + formation.total * 3;
    } catch {
      // Environment and guile cards never enter a formation, but keep the
      // evaluator defensive when reading imported public positions.
    }
  }
  return score;
}

function completedFormationScore(flag: FlagState, player: PlayerId): number {
  const cards = flag.sides[player].cards;
  if (cards.length !== flag.capacity) return 0;
  try {
    const formation = evaluateFormation(cards, {
      fog: flag.environment.includes("tactic-fog"),
    });
    return formation.strength * 120 + formation.total * 4;
  } catch {
    return 0;
  }
}

function strategicFlagScore(
  view: PlayerView,
  flagId: number,
  player: PlayerId,
): number {
  const opponent = otherPlayer(player);
  const ownerAt = (id: number) => view.flags[id]?.owner;
  let score = 12 + Math.min(flagId + 1, 9 - flagId) * 3;
  for (
    let start = Math.max(0, flagId - 2);
    start <= Math.min(6, flagId);
    start += 1
  ) {
    const window = [start, start + 1, start + 2];
    const own = window.filter((id) => ownerAt(id) === player).length;
    const enemy = window.filter((id) => ownerAt(id) === opponent).length;
    if (own === 2) score += 260;
    else if (own === 1) score += 48;
    if (enemy === 2) score += 300;
    else if (enemy === 1) score += 38;
  }
  const ownClaims = view.flags.filter((flag) => flag.owner === player).length;
  const enemyClaims = view.flags.filter(
    (flag) => flag.owner === opponent,
  ).length;
  if (ownClaims === 4) score += 240;
  else score += ownClaims * 14;
  if (enemyClaims === 4) score += 280;
  else score += enemyClaims * 12;
  return score;
}

function troopValue(cardId: CardId): number {
  if (isTroopCard(cardId)) return parseTroopCard(cardId).value;
  if (cardId.startsWith("tactic-leader-")) return 10;
  if (cardId === "tactic-companion-cavalry") return 8;
  if (cardId === "tactic-shield-bearers") return 3;
  return 0;
}

function placementValue(
  view: PlayerView,
  cardId: CardId,
  flagId: number,
): { score: number; reason: string } {
  const flag = view.flags[flagId];
  if (!flag) return { score: -10_000, reason: "目标战线不存在" };
  const player = view.viewer;
  const opponent = otherPlayer(player);
  const ownCards = flag.sides[player].cards;
  const enemyCards = flag.sides[opponent].cards;
  const after = [...ownCards, cardId];
  const improvement = formationPotential(after) - formationPotential(ownCards);
  let score = 150 + improvement * 2 + strategicFlagScore(view, flagId, player);
  score += ownCards.length * 42 + enemyCards.length * 34;
  if (enemyCards.length >= flag.capacity - 1) score += 150;
  if (after.length === flag.capacity) {
    score +=
      280 +
      completedFormationScore(
        {
          ...flag,
          sides: {
            ...flag.sides,
            [player]: { ...flag.sides[player], cards: after },
          },
        },
        player,
      );
    const enemyCompleted = completedFormationScore(flag, opponent);
    if (enemyCompleted > 0) {
      const ownCompleted = completedFormationScore(
        {
          ...flag,
          sides: {
            ...flag.sides,
            [player]: { ...flag.sides[player], cards: after },
          },
        },
        player,
      );
      score += ownCompleted > enemyCompleted ? 240 : -180;
    }
  }
  const reason =
    enemyCards.length >= flag.capacity - 1
      ? `阻断战线 ${flagId + 1} 的公开威胁`
      : ownCards.length > 0
        ? `提升战线 ${flagId + 1} 的阵型潜力`
        : `争夺战略战线 ${flagId + 1}`;
  return { score, reason };
}

function handCardValue(view: PlayerView, cardId: CardId): number {
  const tactic = getTacticCard(cardId);
  if (tactic) {
    if (tactic.category === "guile") return cardId === "tactic-scout" ? 82 : 96;
    if (tactic.category === "environment") return 78;
    return 105;
  }
  let bestPlacement = 0;
  for (const flag of view.flags) {
    if (flag.owner || flag.sides[view.viewer].cards.length >= flag.capacity)
      continue;
    bestPlacement = Math.max(
      bestPlacement,
      formationPotential([...flag.sides[view.viewer].cards, cardId]) -
        formationPotential(flag.sides[view.viewer].cards),
    );
  }
  return troopValue(cardId) * 5 + bestPlacement;
}

function environmentTacticScore(
  view: PlayerView,
  command: Extract<GameCommand, { type: "play-tactic" }>,
): ScoredCommand {
  const flag = view.flags[command.flagId!];
  const player = view.viewer;
  const opponent = otherPlayer(player);
  const own = flag.sides[player].cards;
  const enemy = flag.sides[opponent].cards;
  let score = 105 + strategicFlagScore(view, flag.id, player);
  if (command.cardId === "tactic-fog") {
    const ownTotal = own.reduce((sum, cardId) => sum + troopValue(cardId), 0);
    const enemyTotal = enemy.reduce(
      (sum, cardId) => sum + troopValue(cardId),
      0,
    );
    score += enemy.length * 35 + (ownTotal - enemyTotal) * 15;
    if (enemy.length === flag.capacity && ownTotal > enemyTotal) score += 360;
    if (own.length === flag.capacity && ownTotal < enemyTotal) score -= 180;
    return {
      command,
      score,
      reason: `以浓雾改写战线 ${flag.id + 1} 的比较方式`,
    };
  }
  score += enemy.length * 82 - own.length * 34;
  if (enemy.length === 3 && own.length < 3) score += 390;
  if (own.length === 3 && enemy.length < 3) score -= 260;
  return { command, score, reason: `以泥泞延缓战线 ${flag.id + 1} 的成型` };
}

function guileTacticScore(
  view: PlayerView,
  command: Extract<GameCommand, { type: "play-tactic" }>,
): ScoredCommand {
  const openFlags = view.flags.filter((flag) => !flag.owner);
  const opponent = otherPlayer(view.viewer);
  const enemyCards = openFlags.reduce(
    (sum, flag) => sum + flag.sides[opponent].cards.length,
    0,
  );
  const ownCards = openFlags.reduce(
    (sum, flag) => sum + flag.sides[view.viewer].cards.length,
    0,
  );
  if (command.cardId === "tactic-scout")
    return { command, score: 265, reason: "侦察牌堆并改善手牌结构" };
  if (command.cardId === "tactic-traitor")
    return { command, score: 300 + enemyCards * 8, reason: "策反对手关键部队" };
  if (command.cardId === "tactic-deserter")
    return {
      command,
      score: 280 + enemyCards * 7,
      reason: "移除对手关键阵型牌",
    };
  return {
    command,
    score: 185 + ownCards * 3,
    reason: "重新部署以修正阵型布局",
  };
}

function tacticSourceScore(
  view: PlayerView,
  command: Extract<GameCommand, { type: "choose-tactic-source" }>,
): ScoredCommand {
  const pending = view.pendingEffect;
  const flag = view.flags[command.flagId];
  const strategic = strategicFlagScore(view, command.flagId, view.viewer);
  if (pending?.kind === "redeploy") {
    const sourceCards = flag.sides[view.viewer].cards;
    let bestDestination = 0;
    for (const target of view.flags) {
      if (
        target.id === flag.id ||
        target.owner ||
        target.sides[view.viewer].cards.length >= target.capacity
      )
        continue;
      bestDestination = Math.max(
        bestDestination,
        placementValue(view, command.cardId, target.id).score,
      );
    }
    const sourceLoss =
      formationPotential(sourceCards) -
      formationPotential(
        sourceCards.filter((cardId) => cardId !== command.cardId),
      );
    return {
      command,
      score: 700 + bestDestination - sourceLoss * 3 - sourceCards.length * 50,
      reason: `从战线 ${flag.id + 1} 调整低效部署`,
    };
  }
  const opponent = otherPlayer(view.viewer);
  const enemyCards = flag.sides[opponent].cards;
  const value = troopValue(command.cardId);
  return {
    command,
    score: 900 + value * 18 + enemyCards.length * 90 + strategic,
    reason: `打击战线 ${flag.id + 1} 的关键部队`,
  };
}

function scoreStandardCommand(
  view: PlayerView,
  command: GameCommand,
): ScoredCommand {
  if (command.type === "claim-flag") {
    const strategic = strategicFlagScore(view, command.flagId, view.viewer);
    return {
      command,
      score: 3_000 + strategic,
      reason: `占领战略战线 ${command.flagId + 1}`,
    };
  }
  if (command.type === "play-troop") {
    const placement = placementValue(view, command.cardId, command.flagId);
    return { command, ...placement };
  }
  if (command.type === "play-tactic") {
    if (isMorale(command.cardId) && command.flagId !== undefined) {
      const placement = placementValue(view, command.cardId, command.flagId);
      return {
        command,
        score: placement.score + 45,
        reason: `以士气牌${placement.reason.slice(0, 2)}战线 ${command.flagId + 1}`,
      };
    }
    const tactic = getTacticCard(command.cardId);
    if (tactic?.category === "environment")
      return environmentTacticScore(view, command);
    return guileTacticScore(view, command);
  }
  if (command.type === "choose-scout-draw") {
    const tacticCards = view.hand.filter((cardId) =>
      getTacticCard(cardId),
    ).length;
    const tacticDraws = command.piles.filter(
      (pile) => pile === "tactic",
    ).length;
    const targetTactics = tacticCards === 0 ? 2 : tacticCards === 1 ? 1 : 0;
    return {
      command,
      score: 1_400 - Math.abs(tacticDraws - targetTactics) * 90,
      reason: "按当前手牌结构选择侦察牌堆",
    };
  }
  if (command.type === "choose-scout-return") {
    const returnedValue = command.cardIds.reduce(
      (sum, cardId) => sum + handCardValue(view, cardId),
      0,
    );
    return {
      command,
      score: 1_500 - returnedValue,
      reason: "将当前协同性最低的两张牌放回牌堆",
    };
  }
  if (command.type === "choose-tactic-source")
    return tacticSourceScore(view, command);
  if (command.type === "choose-tactic-destination") {
    if (command.discard)
      return { command, score: 500, reason: "弃置无法形成收益的部署" };
    const source = view.pendingEffect?.source;
    if (source && command.flagId !== undefined) {
      const placement = placementValue(view, source.cardId, command.flagId);
      return {
        command,
        score: 1_000 + placement.score,
        reason: placement.reason,
      };
    }
    return { command, score: 800, reason: "完成战术目标选择" };
  }
  if (command.type === "draw-card") {
    const tacticCards = view.hand.filter((cardId) =>
      getTacticCard(cardId),
    ).length;
    const tacticValue = tacticCards === 0 ? 112 : tacticCards === 1 ? 96 : 62;
    const score = command.pile === "tactic" ? tacticValue : 88;
    return {
      command,
      score,
      reason: `补充${command.pile === "troop" ? "稳定的部队资源" : "战术应变资源"}`,
    };
  }
  if (command.type === "pass-claims")
    return { command, score: 60, reason: "结束当前宣告阶段" };
  if (command.type === "end-turn")
    return { command, score: 50, reason: "牌堆耗尽，结束回合" };
  if (command.type === "skip-play")
    return { command, score: 40, reason: "没有可执行的部署" };
  return { command, score: -1_000, reason: "取消无明确收益的战术" };
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

  const score =
    options.difficulty === "standard" ? scoreStandardCommand : scoreEasyCommand;
  const scored = view.legalCommands.map((command) => score(view, command));
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
