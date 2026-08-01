"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import {
  AI_VERSION,
  GAME_CORE_VERSION,
  RuleError,
  applyCommand,
  assertGameState,
  buildGameSummary,
  chooseAiCommand,
  createBasicGame,
  createGuidedGame,
  createReplayArchive,
  createStandardGame,
  exportReplay,
  getTacticCard,
  importReplay,
  parseTroopCard,
  projectForPlayer,
  projectForSpectator,
  replayTo,
  stateFingerprint,
  type CardId,
  type GameCommand,
  type GamePhase,
  type GameState,
  type PlayerId,
  type ProjectedGameEvent,
  type ReplayArchive,
} from "@/packages/game-core/src";

const COLOR_NAMES = {
  red: "赤",
  orange: "橙",
  yellow: "黄",
  green: "青",
  blue: "蓝",
  purple: "紫",
} as const;

const TACTIC_NAMES: Record<string, string> = {
  "tactic-leader-alexander": "统帅·亚历山大",
  "tactic-leader-darius": "统帅·大流士",
  "tactic-companion-cavalry": "伙伴骑兵",
  "tactic-shield-bearers": "持盾兵",
  "tactic-fog": "迷雾",
  "tactic-mud": "泥泞",
  "tactic-scout": "侦察",
  "tactic-redeploy": "重新部署",
  "tactic-deserter": "逃兵",
  "tactic-traitor": "叛徒",
};

const PHASE_NAMES: Record<GamePhase, string> = {
  setup: "整备",
  "play-card": "部署卡牌",
  "resolve-tactic": "执行战术",
  "optional-claims": "宣告战线",
  "draw-card": "补充手牌",
  finished: "对局结束",
};

const APP_VERSION = "1.3.0-r5.m13a";
const SAVE_KEY = "guzhanzhen.local-game.v1";

type MatchMode = "standard" | "basic" | "tutorial" | "solo";

const MODE_NAMES: Record<MatchMode, string> = {
  standard: "标准对局",
  basic: "基础对局",
  tutorial: "引导对局",
  solo: "单人对 AI",
};

const RULE_ERROR_MESSAGES: Partial<Record<string, string>> = {
  NOT_ACTIVE_PLAYER: "现在不是该玩家的行动回合。",
  WRONG_PHASE: "当前阶段不能执行这个操作，请按行动面板提示继续。",
  CARD_NOT_IN_HAND: "这张牌不在当前玩家手中。",
  FLAG_ALREADY_CLAIMED: "该战线已经被占领，不能继续部署或宣告。",
  FLAG_FULL: "该侧阵型已经满员，请选择其他战线。",
  CLAIM_NOT_PROVEN: "当前阵型还不能证明必胜；对手仍可能完成更强阵型。",
  TACTIC_LIMIT_REACHED: "你的战术牌使用数已领先，暂时不能再打战术牌。",
  LEADER_LIMIT_REACHED: "每名玩家一局只能使用一张统帅牌。",
  NO_LEGAL_TACTIC_TARGET: "场上没有符合这张战术牌要求的目标。",
};

const playerName = (player: PlayerId) =>
  player === "player-one" ? "玄甲" : "朱羽";

const otherPlayer = (player: PlayerId): PlayerId =>
  player === "player-one" ? "player-two" : "player-one";

function cardView(cardId: CardId) {
  const tactic = getTacticCard(cardId);
  if (tactic) {
    return {
      title: TACTIC_NAMES[cardId] ?? tactic.name,
      subtitle:
        tactic.category === "morale"
          ? "士气"
          : tactic.category === "environment"
            ? "环境"
            : "诡计",
      className: `tactic ${tactic.category}`,
    };
  }
  const troop = parseTroopCard(cardId);
  return {
    title: `${COLOR_NAMES[troop.color]} ${troop.value}`,
    subtitle: "部队",
    className: `troop ${troop.color}`,
  };
}

function eventText(event: ProjectedGameEvent): string {
  if (event.type === "game-started")
    return `${playerName(event.firstPlayer)} 先手`;
  if (event.type === "turn-started")
    return `第 ${event.turn} 回合 · ${playerName(event.player)}`;
  if (event.type === "troop-played")
    return `部队部署至战线 ${event.flagId + 1}`;
  if (event.type === "tactic-played")
    return `打出 ${TACTIC_NAMES[event.cardId] ?? event.cardId}`;
  if (event.type === "flag-claimed")
    return `${playerName(event.player)} 占领战线 ${event.flagId + 1}`;
  if (event.type === "card-drawn")
    return `从${event.pile === "troop" ? "部队" : "战术"}牌堆补牌`;
  if (event.type === "scout-drawn") return `侦察抽取 ${event.cardCount} 张牌`;
  if (event.type === "scout-returned")
    return `侦察放回 ${event.cardCount} 张牌`;
  if (event.type === "field-card-moved")
    return event.discarded ? "场上牌被弃置" : "场上牌完成移动";
  if (event.type === "tactic-cancelled") return "取消战术";
  if (event.type === "tactic-resolved") return "战术结算完成";
  return `${playerName(event.player)} 获得胜利`;
}

function CardFace({
  cardId,
  compact = false,
}: {
  cardId: CardId;
  compact?: boolean;
}) {
  const card = cardView(cardId);
  return (
    <span className={`card-face ${card.className} ${compact ? "compact" : ""}`}>
      <strong>{card.title}</strong>
      <small>{card.subtitle}</small>
    </span>
  );
}

function newGame(
  seed: string,
  firstPlayer: PlayerId = "player-one",
  mode: MatchMode = "standard",
): GameState {
  const normalizedSeed = seed.trim() || "r3-local-match";
  if (mode === "standard")
    return createStandardGame(normalizedSeed, firstPlayer);
  if (mode === "solo") return createStandardGame(normalizedSeed, firstPlayer);
  if (mode === "tutorial") return createGuidedGame(normalizedSeed, firstPlayer);
  return createBasicGame(normalizedSeed, firstPlayer);
}

function modeForState(state: GameState): MatchMode {
  if (state.cardUniverse.some((cardId) => getTacticCard(cardId)))
    return "standard";
  if (
    state.events.length <= 2 &&
    state.flags.some((flag) =>
      Object.values(flag.sides).some((side) => side.cards.length > 0),
    )
  )
    return "tutorial";
  return "basic";
}

const subscribeToHydration = () => () => {};

type SavedGame = {
  schemaVersion: 1;
  appVersion: string;
  savedAt: string;
  matchMode?: MatchMode;
  replay?: {
    initialState: GameState;
    commands: GameCommand[];
  };
  state: GameState;
};

const FORMATION_EXAMPLES = [
  {
    rank: 1,
    name: "楔形阵",
    rule: "同色且连续",
    cards: ["赤 3", "赤 4", "赤 5"],
  },
  {
    rank: 2,
    name: "方阵",
    rule: "三张同点数",
    cards: ["赤 8", "蓝 8", "青 8"],
  },
  {
    rank: 3,
    name: "营阵",
    rule: "三张同色",
    cards: ["蓝 2", "蓝 7", "蓝 9"],
  },
  {
    rank: 4,
    name: "散兵线",
    rule: "连续但不同色",
    cards: ["赤 4", "蓝 5", "青 6"],
  },
  {
    rank: 5,
    name: "军团",
    rule: "其他组合，比点数和",
    cards: ["赤 2", "蓝 5", "青 9"],
  },
] as const;

function RulesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="rules-backdrop" data-testid="rules-drawer">
      <aside
        aria-label="规则速查"
        aria-modal="true"
        className="rules-drawer"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">M11 · RULES REFERENCE</p>
            <h2>规则速查</h2>
          </div>
          <button aria-label="关闭规则速查" onClick={onClose} type="button">
            关闭
          </button>
        </header>

        <section>
          <h3>目标与回合</h3>
          <p>
            率先占领连续三条战线，或任意五条战线，即刻获胜。每回合依次部署一张牌、宣告可占战线，再从一个牌堆补一张牌。
          </p>
        </section>

        <section>
          <h3>阵型强度</h3>
          <p className="rules-note">
            由上至下依次变弱；同类阵型先比较点数和，再比较完成先后。
          </p>
          <ol className="formation-reference">
            {FORMATION_EXAMPLES.map((formation) => (
              <li key={formation.name}>
                <span>{formation.rank}</span>
                <div>
                  <strong>{formation.name}</strong>
                  <small>{formation.rule}</small>
                </div>
                <div
                  className="formation-example-cards"
                  aria-label={`${formation.name}示例`}
                >
                  {formation.cards.map((card) => (
                    <b key={card}>{card}</b>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="rules-grid">
          <div>
            <h3>宣告战线</h3>
            <p>
              己方阵型完成且强于对手时可以宣告；若对手未完成，必须用所有公开可用牌证明其不可能反超。
            </p>
          </div>
          <div>
            <h3>战术术语</h3>
            <p>
              <b>士气</b>加入阵型；<b>环境</b>改变整条战线；<b>诡计</b>
              执行一次即时效果。
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function TutorialCoach({
  state,
  selectedCard,
}: {
  state: GameState;
  selectedCard?: CardId;
}) {
  const firstFlagClaimed = Boolean(state.flags[0].owner);
  let step = 1;
  let title = "选择赤 10";
  let detail = "战线 1 已有赤 8、赤 9。选择赤 10，可以组成最强的楔形阵。";

  if (state.phase === "play-card" && selectedCard === "troop-red-10") {
    title = "部署到战线 1";
    detail = "战线 1 已高亮。点击其下方的“部署于此”。";
  } else if (state.phase === "optional-claims" && !firstFlagClaimed) {
    step = 2;
    title = "宣告战线 1";
    detail = "赤 8、9、10 是最高点数楔形阵；点击战线 1 下方的“宣告”。";
  } else if (firstFlagClaimed && state.turn === 1) {
    step = 3;
    title = "首面旗帜已占领";
    detail = "结束宣告，再从部队牌堆补一张牌，完成这个教学回合。";
  } else if (firstFlagClaimed) {
    step = 3;
    title = "教学目标达成";
    detail =
      "你已独立完成部署、阵型和宣告。继续占领连续三线或任意五线即可获胜。";
  }

  return (
    <section className="tutorial-coach" data-testid="tutorial-coach">
      <span>引导 {Math.min(step, 3)} / 3</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </section>
  );
}

function SetupScreen({
  seed,
  mode,
  firstPlayer,
  ready,
  canResume,
  onSeedChange,
  onModeChange,
  onFirstPlayerChange,
  onStart,
  onResume,
  onOpenRules,
}: {
  seed: string;
  mode: MatchMode;
  firstPlayer: PlayerId;
  ready: boolean;
  canResume: boolean;
  onSeedChange: (seed: string) => void;
  onModeChange: (mode: MatchMode) => void;
  onFirstPlayerChange: (player: PlayerId) => void;
  onStart: () => void;
  onResume: () => void;
  onOpenRules: () => void;
}) {
  return (
    <main className="setup-shell" data-ready={ready} data-testid="game-setup">
      <section className="setup-card">
        <div className="setup-intro">
          <p className="eyebrow">R5 · SINGLE PLAYER</p>
          <span className="setup-emblem" aria-hidden="true">
            阵
          </span>
          <h1>古战阵</h1>
          <p>两军隔九线列阵，以连续三线或任意五线夺取胜利。</p>
        </div>

        <form
          className="match-setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            onStart();
          }}
        >
          <fieldset>
            <legend>对局模式</legend>
            <label className={mode === "standard" ? "selected" : ""}>
              <input
                checked={mode === "standard"}
                name="match-mode"
                onChange={() => onModeChange("standard")}
                type="radio"
              />
              <span>
                <strong>标准对局</strong>
                <small>60 张部队牌 + 10 张战术牌，完整规则</small>
              </span>
            </label>
            <label className={mode === "basic" ? "selected" : ""}>
              <input
                checked={mode === "basic"}
                name="match-mode"
                onChange={() => onModeChange("basic")}
                type="radio"
              />
              <span>
                <strong>基础对局</strong>
                <small>仅使用部队牌，适合首次熟悉阵型与占旗</small>
              </span>
            </label>
            <label className={mode === "tutorial" ? "selected" : ""}>
              <input
                checked={mode === "tutorial"}
                name="match-mode"
                onChange={() => onModeChange("tutorial")}
                type="radio"
              />
              <span>
                <strong>引导对局</strong>
                <small>固定无战术局面，用三步完成第一面旗帜</small>
              </span>
            </label>
            <label className={mode === "solo" ? "selected" : ""}>
              <input
                checked={mode === "solo"}
                name="match-mode"
                onChange={() => onModeChange("solo")}
                type="radio"
              />
              <span>
                <strong>单人对 AI</strong>
                <small>你执玄甲，对阵只读取脱敏视图的简单朱羽 AI</small>
              </span>
            </label>
          </fieldset>

          <fieldset disabled={mode === "solo"}>
            <legend>先手阵营</legend>
            <div className="first-player-options">
              {(["player-one", "player-two"] as const).map((player) => (
                <label
                  className={firstPlayer === player ? "selected" : ""}
                  key={player}
                >
                  <input
                    checked={firstPlayer === player}
                    name="first-player"
                    onChange={() => onFirstPlayerChange(player)}
                    type="radio"
                  />
                  {playerName(player)}先手
                </label>
              ))}
            </div>
            {mode === "solo" && <small>单人模式固定由玄甲玩家先手。</small>}
          </fieldset>

          <label className="seed-field" htmlFor="game-seed">
            <span>局面种子</span>
            <input
              id="game-seed"
              onChange={(event) => onSeedChange(event.target.value)}
              value={seed}
            />
            <small>相同模式、先手与种子会得到相同的初始牌序。</small>
          </label>

          <div className="setup-actions">
            <button disabled={!ready} type="submit">
              {mode === "tutorial"
                ? "开始三步引导"
                : mode === "solo"
                  ? "开始单人对战"
                  : "开始本地对战"}
            </button>
            <button disabled={!ready} onClick={onOpenRules} type="button">
              规则速查
            </button>
            {canResume && (
              <button disabled={!ready} onClick={onResume} type="button">
                返回当前对局
              </button>
            )}
          </div>
        </form>

        <footer>
          <span>本地对战 · 自动存档</span>
          <span>{APP_VERSION}</span>
        </footer>
      </section>
    </main>
  );
}

function HandoffGate({
  state,
  ready,
  restored,
  onAccept,
  onNewGame,
}: {
  state: GameState;
  ready: boolean;
  restored: boolean;
  onAccept: () => void;
  onNewGame: () => void;
}) {
  return (
    <main
      className="handoff-shell"
      data-ready={ready}
      data-testid="handoff-gate"
    >
      <section className="handoff-card">
        <p className="eyebrow">LOCAL PRIVATE HANDOFF</p>
        <span
          className={`handoff-emblem ${state.activePlayer}`}
          aria-hidden="true"
        >
          阵
        </span>
        <p>{restored ? "已恢复本地存档" : `第 ${state.turn} 回合`}</p>
        <h1>请将设备交给{playerName(state.activePlayer)}</h1>
        <p className="handoff-copy">
          当前页面不包含任何玩家手牌。确认周围无人查看后，再进入你的私密桌面。
        </p>
        <div className="handoff-actions">
          <button disabled={!ready} onClick={onAccept} type="button">
            确认接管并查看手牌
          </button>
          <button disabled={!ready} onClick={onNewGame} type="button">
            放弃当前进度，开始新局
          </button>
        </div>
        <small>
          自动存档 · {APP_VERSION} · 核心 {GAME_CORE_VERSION}
        </small>
      </section>
    </main>
  );
}

function AiThinkingScreen({ notice }: { notice: string }) {
  return (
    <main className="handoff-shell" data-testid="ai-thinking">
      <section className="handoff-card ai-thinking-card">
        <p className="eyebrow">R5 · EASY AI</p>
        <span className="handoff-emblem player-two" aria-hidden="true">
          谋
        </span>
        <p>朱羽 · {AI_VERSION}</p>
        <h1>对手正在推演</h1>
        <p className="handoff-copy">{notice}</p>
        <small>AI 仅接收朱羽 PlayerView · 不读取牌堆顺序或玄甲手牌</small>
      </section>
    </main>
  );
}

function ReplayDrawer({
  open,
  initialState,
  commands,
  allowExport,
  onClose,
  onImport,
}: {
  open: boolean;
  initialState: GameState;
  commands: readonly GameCommand[];
  allowExport: boolean;
  onClose: () => void;
  onImport: (archive: ReplayArchive) => void;
}) {
  const archive = useMemo(
    () => createReplayArchive(initialState, commands),
    [commands, initialState],
  );
  const [cursor, setCursor] = useState(commands.length);
  const [serialized, setSerialized] = useState("");
  const [feedback, setFeedback] = useState(
    "活动对局只展示公开信息；完整档案在结算后开放导出。",
  );
  const replayState = useMemo(
    () => replayTo(archive, Math.min(cursor, commands.length)),
    [archive, commands.length, cursor],
  );
  const publicView = useMemo(
    () => projectForSpectator(replayState),
    [replayState],
  );

  if (!open) return null;

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(archive.seed);
      setFeedback("种子已复制。相同模式、先手与种子可复现初始牌序。");
    } catch {
      setFeedback(`无法自动复制，请手动记录种子：${archive.seed}`);
    }
  };

  const prepareExport = () => {
    if (!allowExport) return;
    setSerialized(exportReplay(archive));
    setFeedback("完整回放档案已生成；其中包含双方隐藏信息，请谨慎分享。");
  };

  const submitImport = () => {
    try {
      const imported = importReplay(serialized);
      onImport(imported);
    } catch (error) {
      setFeedback(
        `导入失败：${error instanceof Error ? error.message : "未知格式错误"}`,
      );
    }
  };

  return (
    <div className="rules-backdrop" data-testid="replay-drawer">
      <aside
        aria-label="对局回放"
        aria-modal="true"
        className="rules-drawer replay-drawer"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">M12 · VERIFIED REPLAY</p>
            <h2>对局回放</h2>
          </div>
          <button aria-label="关闭对局回放" onClick={onClose} type="button">
            关闭
          </button>
        </header>

        <section className="replay-summary">
          <div>
            <span>命令节点</span>
            <strong>
              {cursor} / {commands.length}
            </strong>
          </div>
          <div>
            <span>回合</span>
            <strong>{publicView.turn}</strong>
          </div>
          <div>
            <span>阶段</span>
            <strong>{PHASE_NAMES[publicView.phase]}</strong>
          </div>
          <div>
            <span>事件</span>
            <strong>{publicView.eventIndex}</strong>
          </div>
        </section>

        <section className="replay-timeline">
          <label htmlFor="replay-progress">回放进度</label>
          <input
            aria-label="回放进度"
            id="replay-progress"
            max={commands.length}
            min="0"
            onChange={(event) => setCursor(Number(event.target.value))}
            type="range"
            value={cursor}
          />
          <div>
            <button
              disabled={cursor === 0}
              onClick={() => setCursor((value) => Math.max(0, value - 1))}
              type="button"
            >
              上一步
            </button>
            <button
              disabled={cursor === commands.length}
              onClick={() =>
                setCursor((value) => Math.min(commands.length, value + 1))
              }
              type="button"
            >
              下一步
            </button>
          </div>
        </section>

        <section>
          <h3>公开战线</h3>
          <div className="replay-flags">
            {publicView.flags.map((flag) => (
              <span className={flag.owner ?? "unclaimed"} key={flag.id}>
                {flag.id + 1}
                <small>{flag.owner ? playerName(flag.owner) : "未决"}</small>
              </span>
            ))}
          </div>
        </section>

        <section>
          <h3>公开事件</h3>
          <ol className="replay-events">
            {publicView.events
              .slice(-8)
              .reverse()
              .map((event) => (
                <li key={event.index}>
                  <span>{String(event.index).padStart(2, "0")}</span>
                  {eventText(event)}
                </li>
              ))}
          </ol>
        </section>

        <section className="replay-archive">
          <h3>种子与档案</h3>
          <div className="replay-seed">
            <code>{archive.seed}</code>
            <button onClick={copySeed} type="button">
              复制种子
            </button>
          </div>
          <textarea
            aria-label="回放档案"
            onChange={(event) => setSerialized(event.target.value)}
            placeholder="结算后可生成完整档案，或在此粘贴已有档案进行校验导入。"
            value={serialized}
          />
          <div className="replay-archive-actions">
            <button
              disabled={!allowExport}
              onClick={prepareExport}
              type="button"
            >
              {allowExport ? "生成完整回放档案" : "结束后可导出"}
            </button>
            <button
              disabled={!serialized.trim()}
              onClick={submitImport}
              type="button"
            >
              校验并导入
            </button>
          </div>
          <p aria-live="polite">{feedback}</p>
        </section>
      </aside>
    </div>
  );
}

function GameResult({
  state,
  onRematch,
  onNewGame,
  onOpenReplay,
}: {
  state: GameState;
  onRematch: () => void;
  onNewGame: () => void;
  onOpenReplay: () => void;
}) {
  const summary = buildGameSummary(state);
  return (
    <main className="result-shell" data-testid="game-result">
      <section className="result-card">
        <p className="eyebrow">对局结算 · {APP_VERSION}</p>
        <span className={`result-emblem ${summary.winner}`} aria-hidden="true">
          胜
        </span>
        <p>第 {summary.turns} 回合结束</p>
        <h1>{playerName(summary.winner)}获胜</h1>
        <strong>
          {summary.condition === "breakthrough" ? "突破三线" : "包围五线"}
        </strong>
        <div className="result-stats">
          <div>
            <span>制胜战线</span>
            <b>{summary.winningFlags.map((flag) => flag + 1).join(" · ")}</b>
          </div>
          <div>
            <span>玄甲占领</span>
            <b>{summary.claimedFlags["player-one"].length}</b>
          </div>
          <div>
            <span>朱羽占领</span>
            <b>{summary.claimedFlags["player-two"].length}</b>
          </div>
        </div>
        <div className="handoff-actions">
          <button onClick={onRematch} type="button">
            交换先手再战
          </button>
          <button onClick={onNewGame} type="button">
            返回全新对局
          </button>
          <button onClick={onOpenReplay} type="button">
            查看与导出回放
          </button>
        </div>
      </section>
    </main>
  );
}

export function GameTable() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [seed, setSeed] = useState("r3-local-match");
  const [mode, setMode] = useState<MatchMode>("standard");
  const [firstPlayer, setFirstPlayer] = useState<PlayerId>("player-one");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [state, setState] = useState<GameState>(() =>
    newGame("r3-local-match"),
  );
  const [replayInitialState, setReplayInitialState] = useState<GameState>(() =>
    newGame("r3-local-match"),
  );
  const [replayCommands, setReplayCommands] = useState<GameCommand[]>([]);
  const [showSetup, setShowSetup] = useState(true);
  const [hasActiveGame, setHasActiveGame] = useState(false);
  const [revealedPlayer, setRevealedPlayer] = useState<PlayerId>();
  const [restored, setRestored] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardId>();
  const [returnCards, setReturnCards] = useState<CardId[]>([]);
  const [notice, setNotice] = useState("请选择一张手牌开始部署。");
  const view = useMemo(
    () => projectForPlayer(state, state.activePlayer),
    [state],
  );
  const opponent = otherPlayer(view.viewer);

  useEffect(() => {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    let saved: SavedGame | undefined;
    try {
      const candidate = JSON.parse(raw) as SavedGame;
      if (candidate.schemaVersion !== 1) return;
      assertGameState(candidate.state);
      if (candidate.replay) {
        const archive = createReplayArchive(
          candidate.replay.initialState,
          candidate.replay.commands,
        );
        if (
          stateFingerprint(replayTo(archive)) !==
          stateFingerprint(candidate.state)
        ) {
          throw new Error("Saved replay does not match saved state.");
        }
      }
      saved = candidate;
    } catch {
      window.localStorage.removeItem(SAVE_KEY);
      return;
    }
    const timer = window.setTimeout(() => {
      setState(saved.state);
      setReplayInitialState(saved.replay?.initialState ?? saved.state);
      setReplayCommands(saved.replay?.commands ?? []);
      setSeed(saved.state.seed);
      setMode(saved.matchMode ?? modeForState(saved.state));
      setFirstPlayer(
        saved.state.events.find((event) => event.type === "game-started")
          ?.firstPlayer ?? "player-one",
      );
      setHasActiveGame(true);
      setShowSetup(false);
      setRestored(true);
      setNotice("本地存档已恢复。");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || !hasActiveGame || showSetup) return;
    const save: SavedGame = {
      schemaVersion: 1,
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
      matchMode: mode,
      replay: { initialState: replayInitialState, commands: replayCommands },
      state,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [
    hasActiveGame,
    mode,
    ready,
    replayCommands,
    replayInitialState,
    showSetup,
    state,
  ]);

  const beginNewGame = (
    nextSeed: string,
    firstPlayer: PlayerId = "player-one",
    nextMode: MatchMode = mode,
  ) => {
    const next = newGame(nextSeed, firstPlayer, nextMode);
    setState(next);
    setReplayInitialState(next);
    setReplayCommands([]);
    setSeed(next.seed);
    setMode(nextMode);
    setFirstPlayer(firstPlayer);
    setHasActiveGame(true);
    setShowSetup(false);
    setRevealedPlayer(undefined);
    setSelectedCard(undefined);
    setReturnCards([]);
    setRestored(false);
    setNotice("新对局已创建。");
  };

  const execute = (command: GameCommand) => {
    try {
      const next = applyCommand(state, command);
      setState(next);
      setReplayCommands((current) => [...current, command]);
      if (next.activePlayer !== state.activePlayer) {
        setRevealedPlayer(undefined);
      }
      setSelectedCard(undefined);
      setReturnCards([]);
      setNotice("命令已执行，请继续当前阶段。");
    } catch (error) {
      setNotice(
        error instanceof RuleError
          ? `${error.code}：${RULE_ERROR_MESSAGES[error.code] ?? error.message}`
          : "命令执行失败，请重试。",
      );
    }
  };

  useEffect(() => {
    if (
      !ready ||
      !hasActiveGame ||
      showSetup ||
      mode !== "solo" ||
      state.phase === "finished" ||
      state.activePlayer !== "player-two"
    )
      return;

    const timer = window.setTimeout(() => {
      try {
        const aiView = projectForPlayer(state, "player-two");
        const decision = chooseAiCommand(aiView, {
          difficulty: "easy",
          seed: `${state.seed}:zhu-yu`,
          decisionIndex: replayCommands.length,
          timeBudgetMs: 8,
        });
        const next = applyCommand(state, decision.command);
        setState(next);
        setReplayCommands((current) => [...current, decision.command]);
        setNotice(`朱羽 AI：${decision.reason}`);
        if (next.activePlayer !== "player-two") setRevealedPlayer(undefined);
      } catch (error) {
        setNotice(
          `AI 行动失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [hasActiveGame, mode, ready, replayCommands.length, showSetup, state]);

  const commandsForCard = (cardId: CardId) =>
    view.legalCommands.filter(
      (command) =>
        (command.type === "play-troop" || command.type === "play-tactic") &&
        command.cardId === cardId,
    );

  const flagCommand = (flagId: number): GameCommand | undefined => {
    const destination = view.legalCommands.find(
      (command) =>
        command.type === "choose-tactic-destination" &&
        command.flagId === flagId,
    );
    if (destination) return destination;
    if (selectedCard) {
      const play = commandsForCard(selectedCard).find(
        (command) => "flagId" in command && command.flagId === flagId,
      );
      if (play) return play;
    }
    return view.legalCommands.find(
      (command) => command.type === "claim-flag" && command.flagId === flagId,
    );
  };

  const chooseHandCard = (cardId: CardId) => {
    if (view.pendingEffect?.step === "choose-return") {
      setReturnCards((current) =>
        current.includes(cardId)
          ? current.filter((item) => item !== cardId)
          : current.length < 2
            ? [...current, cardId]
            : [current[1], cardId],
      );
      return;
    }
    setSelectedCard((current) => (current === cardId ? undefined : cardId));
    setNotice("已选牌；高亮战线均为合法目标。");
  };

  const playSelectedGuile = () => {
    if (!selectedCard) return;
    const command = commandsForCard(selectedCard).find(
      (item) => item.type === "play-tactic" && item.flagId === undefined,
    );
    if (command) execute(command);
  };

  const submitScoutReturn = () => {
    const command = view.legalCommands.find(
      (item) =>
        item.type === "choose-scout-return" &&
        item.cardIds[0] === returnCards[0] &&
        item.cardIds[1] === returnCards[1],
    );
    if (command) execute(command);
  };

  const handleDrop = (event: DragEvent, flagId: number) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData("text/plain");
    if (cardId) setSelectedCard(cardId);
    const command = cardId
      ? view.legalCommands.find(
          (item) =>
            (item.type === "play-troop" || item.type === "play-tactic") &&
            item.cardId === cardId &&
            item.flagId === flagId,
        )
      : flagCommand(flagId);
    if (command) execute(command);
  };

  const selectedGuile = selectedCard
    ? commandsForCard(selectedCard).some(
        (command) =>
          command.type === "play-tactic" && command.flagId === undefined,
      )
    : false;

  const importArchive = (archive: ReplayArchive) => {
    const importedState = replayTo(archive);
    const importedFirstPlayer =
      importedState.events.find((event) => event.type === "game-started")
        ?.firstPlayer ?? "player-one";
    setState(importedState);
    setReplayInitialState(archive.initialState);
    setReplayCommands([...archive.commands]);
    setSeed(importedState.seed);
    setMode(modeForState(archive.initialState));
    setFirstPlayer(importedFirstPlayer);
    setHasActiveGame(true);
    setShowSetup(false);
    setRevealedPlayer(undefined);
    setSelectedCard(undefined);
    setReturnCards([]);
    setRestored(true);
    setReplayOpen(false);
    setNotice("回放档案已校验并导入。");
  };

  if (showSetup) {
    return (
      <>
        <SetupScreen
          canResume={hasActiveGame}
          firstPlayer={firstPlayer}
          mode={mode}
          onFirstPlayerChange={setFirstPlayer}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            if (nextMode === "solo") setFirstPlayer("player-one");
          }}
          onOpenRules={() => setRulesOpen(true)}
          onResume={() => setShowSetup(false)}
          onSeedChange={setSeed}
          onStart={() =>
            beginNewGame(
              seed,
              mode === "solo" ? "player-one" : firstPlayer,
              mode,
            )
          }
          ready={ready}
          seed={seed}
        />
        <RulesDrawer onClose={() => setRulesOpen(false)} open={rulesOpen} />
      </>
    );
  }

  if (state.phase === "finished") {
    const previousFirstPlayer =
      state.events.find((event) => event.type === "game-started")
        ?.firstPlayer ?? "player-one";
    return (
      <>
        <GameResult
          state={state}
          onNewGame={() => setShowSetup(true)}
          onOpenReplay={() => setReplayOpen(true)}
          onRematch={() =>
            beginNewGame(
              `${state.seed}:rematch:${Date.now()}`,
              otherPlayer(previousFirstPlayer),
              mode,
            )
          }
        />
        <ReplayDrawer
          allowExport
          commands={replayCommands}
          initialState={replayInitialState}
          key={replayOpen ? `result-${replayCommands.length}` : "result-closed"}
          onClose={() => setReplayOpen(false)}
          onImport={importArchive}
          open={replayOpen}
        />
      </>
    );
  }

  if (mode === "solo" && state.activePlayer === "player-two") {
    return <AiThinkingScreen notice={notice} />;
  }

  if (revealedPlayer !== state.activePlayer) {
    return (
      <HandoffGate
        onAccept={() => {
          setRevealedPlayer(state.activePlayer);
          setRestored(false);
        }}
        onNewGame={() => setShowSetup(true)}
        ready={ready}
        restored={restored}
        state={state}
      />
    );
  }

  return (
    <>
      <main className="game-shell" data-ready={ready}>
        <header className="game-header">
          <div className="brand-lockup">
            <p className="eyebrow">R5 · M13 AI BUILD</p>
            <h1>古战阵</h1>
            <p>九线争锋 · 本地规则原型</p>
          </div>
          <div className="game-meta" aria-label="对局状态">
            <span>桌面 {APP_VERSION}</span>
            <strong>{PHASE_NAMES[view.phase]}</strong>
            <span>
              核心 {GAME_CORE_VERSION} · 第 {view.turn} 回合
            </span>
          </div>
          <div className="new-game-form">
            <span className="match-mode-label">{MODE_NAMES[mode]}</span>
            <button
              disabled={!ready}
              onClick={() => setRulesOpen(true)}
              type="button"
            >
              规则速查
            </button>
            <button
              disabled={!ready}
              onClick={() => setReplayOpen(true)}
              type="button"
            >
              公开回放
            </button>
            <button
              disabled={!ready}
              onClick={() => setShowSetup(true)}
              type="button"
            >
              对局设置
            </button>
            <button
              className="handoff-now"
              disabled={!ready}
              onClick={() => setRevealedPlayer(undefined)}
              type="button"
            >
              隐藏手牌并交接
            </button>
          </div>
        </header>

        <section className="turn-banner" aria-live="polite">
          <div>
            <span className={`player-mark ${view.viewer}`} />
            <strong>{playerName(view.viewer)}行动</strong>
            <small>{notice}</small>
          </div>
          <div className="deck-counters">
            <span>部队牌堆 {view.decks.troop}</span>
            <span>战术牌堆 {view.decks.tactic}</span>
            <span>对手手牌 {view.players[opponent].handCount}</span>
          </div>
        </section>

        <div className="game-layout">
          <section className="battlefield-panel" aria-label="九条战线">
            <div
              className="opponent-rack"
              aria-label={`${playerName(opponent)}手牌`}
            >
              {Array.from(
                { length: view.players[opponent].handCount },
                (_, index) => (
                  <span className="card-back" key={index} aria-hidden="true" />
                ),
              )}
              <span>
                {playerName(opponent)} · {view.players[opponent].handCount} 张
              </span>
            </div>

            <div className="battlefield-scroll">
              <div className="battlefield-grid">
                {view.flags.map((flag) => {
                  const command = flagCommand(flag.id);
                  const sourceCommands = view.legalCommands.filter(
                    (item) =>
                      item.type === "choose-tactic-source" &&
                      item.flagId === flag.id,
                  );
                  return (
                    <article
                      className={`flag-column ${flag.owner ? "claimed" : ""} ${command ? "legal-target" : ""}`}
                      data-testid={`flag-${flag.id}`}
                      key={flag.id}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDrop(event, flag.id)}
                    >
                      <div className="formation opponent-formation">
                        {flag.sides[opponent].cards.map((cardId) => {
                          const source = sourceCommands.find(
                            (item) =>
                              item.type === "choose-tactic-source" &&
                              item.cardId === cardId,
                          );
                          return (
                            <button
                              className={source ? "source-card" : "field-card"}
                              disabled={!source}
                              key={cardId}
                              onClick={() => source && execute(source)}
                              type="button"
                            >
                              <CardFace cardId={cardId} compact />
                            </button>
                          );
                        })}
                        {Array.from(
                          {
                            length:
                              flag.capacity - flag.sides[opponent].cards.length,
                          },
                          (_, index) => (
                            <span className="empty-slot" key={index} />
                          ),
                        )}
                      </div>

                      <div className="flag-marker">
                        <span>战线 {flag.id + 1}</span>
                        <strong>
                          {flag.owner
                            ? `${playerName(flag.owner)}占领`
                            : "未决"}
                        </strong>
                        {flag.environment.length > 0 && (
                          <small>
                            {flag.environment
                              .map((id) => TACTIC_NAMES[id])
                              .join(" · ")}
                          </small>
                        )}
                      </div>

                      <div className="formation player-formation">
                        {flag.sides[view.viewer].cards.map((cardId) => {
                          const source = sourceCommands.find(
                            (item) =>
                              item.type === "choose-tactic-source" &&
                              item.cardId === cardId,
                          );
                          return (
                            <button
                              className={source ? "source-card" : "field-card"}
                              disabled={!source}
                              key={cardId}
                              onClick={() => source && execute(source)}
                              type="button"
                            >
                              <CardFace cardId={cardId} compact />
                            </button>
                          );
                        })}
                        {Array.from(
                          {
                            length:
                              flag.capacity -
                              flag.sides[view.viewer].cards.length,
                          },
                          (_, index) => (
                            <span className="empty-slot" key={index} />
                          ),
                        )}
                      </div>

                      <button
                        className="flag-action"
                        data-testid={`flag-target-${flag.id}`}
                        disabled={!command}
                        onClick={() => command && execute(command)}
                        type="button"
                      >
                        {command?.type === "claim-flag"
                          ? "宣告"
                          : command?.type === "choose-tactic-destination"
                            ? "移至此处"
                            : command
                              ? "部署于此"
                              : "—"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="hand-zone">
              <div className="hand-heading">
                <div>
                  <span className={`player-mark ${view.viewer}`} />
                  <strong>{playerName(view.viewer)}手牌</strong>
                </div>
                <small>{view.hand.length} 张 · 可点击或拖放</small>
              </div>
              <div className="hand-cards">
                {view.hand.map((cardId) => (
                  <button
                    aria-pressed={
                      selectedCard === cardId || returnCards.includes(cardId)
                    }
                    className={`hand-card ${selectedCard === cardId || returnCards.includes(cardId) ? "selected" : ""}`}
                    data-testid="hand-card"
                    disabled={!ready}
                    draggable
                    key={cardId}
                    onClick={() => chooseHandCard(cardId)}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", cardId)
                    }
                    type="button"
                  >
                    <CardFace cardId={cardId} />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="command-panel" aria-label="行动面板">
            {mode === "tutorial" && (
              <TutorialCoach selectedCard={selectedCard} state={state} />
            )}
            <div>
              <p className="section-label">当前阶段</p>
              <h2>{PHASE_NAMES[view.phase]}</h2>
              <p className="command-help">
                {view.phase === "play-card" && "选择手牌，然后选择高亮战线。"}
                {view.phase === "resolve-tactic" && "按战术提示完成当前选择。"}
                {view.phase === "optional-claims" &&
                  "宣告可占战线，或结束宣告。"}
                {view.phase === "draw-card" && "选择一个牌堆补充手牌。"}
                {view.phase === "finished" && "本局已经结束。"}
              </p>
            </div>

            <div className="command-stack">
              {selectedGuile && (
                <button
                  className="primary-command"
                  onClick={playSelectedGuile}
                  type="button"
                >
                  打出{selectedCard ? TACTIC_NAMES[selectedCard] : "战术"}
                </button>
              )}
              {view.legalCommands
                .filter((command) => command.type === "choose-scout-draw")
                .map((command, index) =>
                  command.type === "choose-scout-draw" ? (
                    <button
                      key={index}
                      onClick={() => execute(command)}
                      type="button"
                    >
                      侦察：
                      {command.piles
                        .map((pile) => (pile === "troop" ? "部" : "术"))
                        .join(" / ")}
                    </button>
                  ) : null,
                )}
              {view.pendingEffect?.step === "choose-return" && (
                <button
                  className="primary-command"
                  disabled={returnCards.length !== 2}
                  onClick={submitScoutReturn}
                  type="button"
                >
                  放回已选 {returnCards.length}/2 张
                </button>
              )}
              {view.legalCommands.some(
                (command) =>
                  command.type === "choose-tactic-destination" &&
                  command.discard,
              ) && (
                <button
                  onClick={() => {
                    const command = view.legalCommands.find(
                      (item) =>
                        item.type === "choose-tactic-destination" &&
                        item.discard,
                    );
                    if (command) execute(command);
                  }}
                  type="button"
                >
                  弃置所选场上牌
                </button>
              )}
              {view.legalCommands.some(
                (command) => command.type === "pass-claims",
              ) && (
                <button
                  data-testid="pass-claims"
                  onClick={() =>
                    execute({ type: "pass-claims", player: view.viewer })
                  }
                  type="button"
                >
                  结束宣告
                </button>
              )}
              {view.legalCommands.some(
                (command) => command.type === "skip-play",
              ) && (
                <button
                  onClick={() =>
                    execute({ type: "skip-play", player: view.viewer })
                  }
                  type="button"
                >
                  无牌可出，跳过部署
                </button>
              )}
              {view.legalCommands
                .filter((command) => command.type === "draw-card")
                .map((command) =>
                  command.type === "draw-card" ? (
                    <button
                      data-testid={`draw-${command.pile}`}
                      key={command.pile}
                      onClick={() => execute(command)}
                      type="button"
                    >
                      从{command.pile === "troop" ? "部队" : "战术"}牌堆补牌
                    </button>
                  ) : null,
                )}
              {view.legalCommands.some(
                (command) => command.type === "end-turn",
              ) && (
                <button
                  onClick={() =>
                    execute({ type: "end-turn", player: view.viewer })
                  }
                  type="button"
                >
                  结束回合
                </button>
              )}
              {view.legalCommands.some(
                (command) => command.type === "cancel-tactic",
              ) && (
                <button
                  onClick={() =>
                    execute({ type: "cancel-tactic", player: view.viewer })
                  }
                  type="button"
                >
                  取消战术
                </button>
              )}
            </div>

            <div className="discard-summary">
              <span>部队弃牌 {view.troopDiscard.length}</span>
              <span>战术弃牌 {view.tacticDiscard.length}</span>
            </div>

            <div className="event-log">
              <p className="section-label">战局记录</p>
              <ol>
                {view.events
                  .slice(-6)
                  .reverse()
                  .map((event) => (
                    <li key={event.index}>
                      <span>{String(event.index).padStart(2, "0")}</span>
                      {eventText(event)}
                    </li>
                  ))}
              </ol>
            </div>
          </aside>
        </div>
      </main>
      <RulesDrawer onClose={() => setRulesOpen(false)} open={rulesOpen} />
      <ReplayDrawer
        allowExport={false}
        commands={replayCommands}
        initialState={replayInitialState}
        key={replayOpen ? `table-${replayCommands.length}` : "table-closed"}
        onClose={() => setReplayOpen(false)}
        onImport={importArchive}
        open={replayOpen}
      />
    </>
  );
}
