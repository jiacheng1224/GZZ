import {
  TACTIC_IDS,
  type DrawPile,
  type FormationKind,
  type GamePhase,
  type PlayerId,
  type TacticCategory,
  type TroopColor,
} from "../../game-core/src";
import { TROOP_COLORS } from "../../game-core/src/types";

export const GAME_CONTENT_VERSION = "0.1.0-m16a";

export type TacticId = (typeof TACTIC_IDS)[number];

type NamedEntry = Readonly<{
  name: string;
  description: string;
}>;

export type ContentPack = Readonly<{
  id: string;
  version: string;
  locale: "zh-CN";
  ruleset: Readonly<{
    id: "nine-fronts-v1";
    mechanicsVersion: 1;
    troopColors: readonly TroopColor[];
    tacticIds: readonly TacticId[];
  }>;
  brand: Readonly<{
    name: string;
    fullTitle: string;
    subtitle: string;
    emblem: string;
    description: string;
    setting: string;
  }>;
  players: Readonly<Record<PlayerId, NamedEntry>>;
  troopColors: Readonly<
    Record<TroopColor, NamedEntry & Readonly<{ colorName: string }>>
  >;
  tactics: Readonly<Record<TacticId, NamedEntry>>;
  formations: Readonly<Record<FormationKind, NamedEntry>>;
  phases: Readonly<Record<GamePhase, string>>;
  tacticCategories: Readonly<Record<TacticCategory, string>>;
  piles: Readonly<
    Record<DrawPile, Readonly<{ name: string; shortName: string }>>
  >;
  terms: Readonly<{
    flag: string;
    flags: string;
    troop: string;
    tactic: string;
    claim: string;
  }>;
  theme: Readonly<{
    id: string;
    cssVariables: Readonly<Record<`--${string}`, string>>;
  }>;
  provenance: Readonly<{
    status: "original-working-draft";
    policy: string;
    legalClearance: "pending";
  }>;
}>;

export const BEACON_RAMPARTS_ZH_CN = {
  id: "beacon-ramparts-zh-cn",
  version: GAME_CONTENT_VERSION,
  locale: "zh-CN",
  ruleset: {
    id: "nine-fronts-v1",
    mechanicsVersion: 1,
    troopColors: TROOP_COLORS,
    tacticIds: TACTIC_IDS,
  },
  brand: {
    name: "烽垒九章",
    fullTitle: "烽垒九章 · 六旌竞势",
    subtitle: "六旌竞势",
    emblem: "烽",
    description:
      "两位阵使隔九座烽垒布下六旌兵列，以阵势、时机与谋策争夺传讯权。",
    setting:
      "架空的澜原边境失去统一号令，九座烽垒成为六支旌团传递军情的唯一通道。两位阵使以公开阵势相争，也以有限谋策改写局面。",
  },
  players: {
    "player-one": {
      name: "玄甲",
      description: "驻守北垒的沉着阵使，以稳固兵列控制烽路。",
    },
    "player-two": {
      name: "朱羽",
      description: "巡行南隘的敏锐阵使，以机动调度争夺先机。",
    },
  },
  troopColors: {
    red: {
      name: "燧锋",
      colorName: "赤",
      description: "以迅疾突进见长的赤色旌团。",
    },
    orange: {
      name: "丹烽",
      colorName: "橙",
      description: "负责点燃与守护烽讯的橙色旌团。",
    },
    yellow: {
      name: "金衡",
      colorName: "黄",
      description: "维持兵列节奏与秩序的黄色旌团。",
    },
    green: {
      name: "青陌",
      colorName: "青",
      description: "熟悉边地路径与伏势的青色旌团。",
    },
    blue: {
      name: "沧澜",
      colorName: "蓝",
      description: "善于迂回和远距协同的蓝色旌团。",
    },
    purple: {
      name: "夜枭",
      colorName: "紫",
      description: "在暮色中传递密令的紫色旌团。",
    },
  },
  tactics: {
    "tactic-leader-alexander": {
      name: "中枢令·天衡",
      description: "以任意旌色与任意点数加入一处兵列。",
    },
    "tactic-leader-darius": {
      name: "中枢令·地纪",
      description: "以任意旌色与任意点数加入一处兵列。",
    },
    "tactic-companion-cavalry": {
      name: "疾驰卫",
      description: "以任意旌色的八点阵兵加入兵列。",
    },
    "tactic-shield-bearers": {
      name: "列盾卫",
      description: "以任意旌色的一至三点阵兵加入兵列。",
    },
    "tactic-fog": {
      name: "烟障",
      description: "遮蔽一座烽垒，只比较双方兵列点数。",
    },
    "tactic-mud": {
      name: "陷辙",
      description: "让一座烽垒的双方兵列容量增加至四张。",
    },
    "tactic-scout": {
      name: "远候",
      description: "从牌堆取得新情报，再将部分手牌归还。",
    },
    "tactic-redeploy": {
      name: "换防",
      description: "移动或撤回己方已经部署的一张牌。",
    },
    "tactic-deserter": {
      name: "离营",
      description: "令对手一张场上牌离开兵列。",
    },
    "tactic-traitor": {
      name: "反策",
      description: "将对手一张阵兵转入己方未满兵列。",
    },
  },
  formations: {
    wedge: { name: "贯锋", description: "同旌色且点数连续。" },
    phalanx: { name: "同序", description: "三张或四张阵兵点数相同。" },
    battalion: { name: "同旌", description: "全部阵兵属于同一旌色。" },
    skirmish: { name: "连步", description: "点数连续，但不要求同旌色。" },
    host: { name: "集阵", description: "其他组合，比较阵兵点数总和。" },
  },
  phases: {
    setup: "整备",
    "play-card": "列阵",
    "resolve-tactic": "执行谋策",
    "optional-claims": "争取烽垒",
    "draw-card": "补充手牌",
    finished: "对局结束",
  },
  tacticCategories: {
    morale: "号令",
    environment: "地势",
    guile: "机变",
  },
  piles: {
    troop: { name: "阵兵", shortName: "兵" },
    tactic: { name: "谋策", shortName: "策" },
  },
  terms: {
    flag: "烽垒",
    flags: "九座烽垒",
    troop: "阵兵",
    tactic: "谋策",
    claim: "夺垒",
  },
  theme: {
    id: "beacon-night",
    cssVariables: {
      "--background": "#121817",
      "--surface": "#1c2622",
      "--surface-raised": "#27332d",
      "--paper": "#eadfca",
      "--paper-deep": "#c9b791",
      "--foreground": "#f6edda",
      "--ink": "#1b2420",
      "--muted": "#a8b4ac",
      "--line": "rgba(234, 223, 202, 0.17)",
      "--cinnabar": "#d05d43",
      "--gold": "#d1aa5d",
      "--pine": "#4f7866",
    },
  },
  provenance: {
    status: "original-working-draft",
    policy:
      "仅使用项目原创名称、架空背景与自建视觉映射；规则内部稳定 ID 不作为玩家可见内容。",
    legalClearance: "pending",
  },
} as const satisfies ContentPack;

export const ACTIVE_CONTENT_PACK: ContentPack = BEACON_RAMPARTS_ZH_CN;

export const playerContentName = (player: PlayerId): string =>
  ACTIVE_CONTENT_PACK.players[player].name;

export const troopContentName = (color: TroopColor): string =>
  ACTIVE_CONTENT_PACK.troopColors[color].name;

export const troopColorName = (color: TroopColor): string =>
  ACTIVE_CONTENT_PACK.troopColors[color].colorName;

export const tacticContentName = (cardId: string): string | undefined =>
  ACTIVE_CONTENT_PACK.tactics[cardId as TacticId]?.name;
