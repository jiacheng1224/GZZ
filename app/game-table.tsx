"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type CSSProperties,
} from "react";
import {
  AI_VERSION,
  GAME_CORE_VERSION,
  RuleError,
  applyCommand,
  assertGameState,
  buildGameReview,
  buildGameSummary,
  chooseAiCommand,
  createCommandEnvelope,
  createBasicGame,
  createGuidedGame,
  createReplayArchive,
  createStandardGame,
  evaluateFormation,
  exportReplay,
  getTacticCard,
  importReplay,
  parseTroopCard,
  projectForPlayer,
  projectForSpectator,
  replayTo,
  stateFingerprint,
  type CardId,
  type AiDifficulty,
  type GameCommand,
  type GamePhase,
  type GameState,
  type PlayerId,
  type PlayerView,
  type ProjectedGameEvent,
  type ProtocolCommandResult,
  type ProtocolSnapshot,
  type PublicRoomView,
  type ReplayArchive,
} from "@/packages/game-core/src";
import {
  ACTIVE_CONTENT_PACK,
  GAME_CONTENT_VERSION,
  playerContentName,
  tacticContentName,
  troopColorName,
  troopContentName,
  type TacticId,
} from "@/packages/game-content/src";
import {
  createContentReviewExport,
  isCompleteContentReview,
  serializeContentReview,
  type ContentReviewDraft,
} from "@/packages/game-content/src/research";

const CONTENT = ACTIVE_CONTENT_PACK;
const PHASE_NAMES: Record<GamePhase, string> = CONTENT.phases;

const APP_VERSION = "2.9.0-m16i";
const SAVE_KEY = "guzhanzhen.local-game.v1";
const PREFERENCES_KEY = "guzhanzhen.experience.v1";
const ONLINE_SESSION_KEY = "guzhanzhen.online-room.v1";
const CONTENT_REVIEW_KEY = "guzhanzhen.content-review.v1";

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
  FLAG_ALREADY_CLAIMED: "该烽垒已经被占领，不能继续列阵或夺垒。",
  FLAG_FULL: "该侧兵列已经满员，请选择其他烽垒。",
  CLAIM_NOT_PROVEN: "当前阵型还不能证明必胜；对手仍可能完成更强阵型。",
  TACTIC_LIMIT_REACHED: "你的谋策牌使用数已领先，暂时不能再打谋策牌。",
  LEADER_LIMIT_REACHED: "每名玩家一局只能使用一张统帅牌。",
  NO_LEGAL_TACTIC_TARGET: "场上没有符合这张谋策牌要求的目标。",
};

const playerName = playerContentName;

const otherPlayer = (player: PlayerId): PlayerId =>
  player === "player-one" ? "player-two" : "player-one";

type SoundCue = "deploy" | "tactic" | "claim" | "turn" | "victory" | "confirm";

let feedbackAudioContext: AudioContext | undefined;

function playFeedbackSound(cue: SoundCue) {
  const context = feedbackAudioContext ?? new AudioContext();
  feedbackAudioContext = context;
  void context.resume();
  const frequencies: Record<SoundCue, number[]> = {
    deploy: [220],
    tactic: [294, 392],
    claim: [330, 440],
    turn: [196],
    victory: [262, 330, 392, 523],
    confirm: [330],
  };
  const now = context.currentTime;
  frequencies[cue].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.065;
    oscillator.type = cue === "tactic" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.055, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.12);
  });
}

function commandSound(command: GameCommand, next: GameState): SoundCue {
  if (next.phase === "finished") return "victory";
  if (command.type === "claim-flag") return "claim";
  if (command.type === "play-tactic") return "tactic";
  if (command.type === "play-troop") return "deploy";
  return "turn";
}

function cardView(cardId: CardId) {
  const tactic = getTacticCard(cardId);
  if (tactic) {
    return {
      title: tacticContentName(cardId) ?? tactic.name,
      subtitle: CONTENT.tacticCategories[tactic.category],
      className: `tactic ${tactic.category}`,
      accent: CONTENT.tacticCategoryThemes[tactic.category].accent,
      sigil: CONTENT.tacticCategoryThemes[tactic.category].sigil,
      description: CONTENT.tactics[cardId as TacticId].description,
    };
  }
  const troop = parseTroopCard(cardId);
  return {
    title: `${troopContentName(troop.color)} ${troop.value}`,
    subtitle: `${troopColorName(troop.color)}色${CONTENT.terms.troop}`,
    className: `troop ${troop.color}`,
    accent: CONTENT.troopColors[troop.color].accent,
    sigil: CONTENT.troopColors[troop.color].sigil,
    description: CONTENT.troopColors[troop.color].description,
  };
}

function formationSummary(
  cards: readonly CardId[],
  capacity: 3 | 4,
  environment: readonly CardId[],
): string {
  if (cards.length < capacity) return `${cards.length}/${capacity} 成阵中`;
  const formation = evaluateFormation(cards, {
    fog: environment.includes("tactic-fog"),
  });
  return `${CONTENT.formations[formation.kind].name} · ${formation.total}`;
}

function eventText(event: ProjectedGameEvent): string {
  if (event.type === "game-started")
    return `${playerName(event.firstPlayer)} 先手`;
  if (event.type === "turn-started")
    return `第 ${event.turn} 回合 · ${playerName(event.player)}`;
  if (event.type === "troop-played") return `阵兵列于烽垒 ${event.flagId + 1}`;
  if (event.type === "tactic-played")
    return `打出 ${tacticContentName(event.cardId) ?? event.cardId}`;
  if (event.type === "flag-claimed")
    return `${playerName(event.player)} 夺得烽垒 ${event.flagId + 1}`;
  if (event.type === "card-drawn")
    return `从${CONTENT.piles[event.pile].name}牌堆补牌`;
  if (event.type === "scout-drawn")
    return `${tacticContentName("tactic-scout")}抽取 ${event.cardCount} 张牌`;
  if (event.type === "scout-returned")
    return `${tacticContentName("tactic-scout")}放回 ${event.cardCount} 张牌`;
  if (event.type === "field-card-moved")
    return event.discarded ? "场上牌被弃置" : "场上牌完成移动";
  if (event.type === "tactic-cancelled") return "取消谋策";
  if (event.type === "tactic-resolved") return "谋策结算完成";
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
    <span
      aria-label={`${card.title} ${card.subtitle}：${card.description}`}
      className={`card-face ${card.className} ${compact ? "compact" : ""}`}
      style={{ "--card-accent": card.accent } as CSSProperties}
      title={card.description}
    >
      <span className="card-sigil" aria-hidden="true">
        {card.sigil}
      </span>
      <span className="card-copy">
        <strong>{card.title}</strong>
        <small>{card.subtitle}</small>
      </span>
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
  aiDifficulty?: AiDifficulty;
  replay?: {
    initialState: GameState;
    commands: GameCommand[];
  };
  state: GameState;
};

const FORMATION_EXAMPLES = [
  {
    rank: 1,
    name: CONTENT.formations.wedge.name,
    rule: CONTENT.formations.wedge.description,
    cards: ["燧锋 3", "燧锋 4", "燧锋 5"],
    englishName: "Wedge / Straight Flush",
    englishRule: "Same color with consecutive values.",
    englishCards: ["Red 3", "Red 4", "Red 5"],
  },
  {
    rank: 2,
    name: CONTENT.formations.phalanx.name,
    rule: CONTENT.formations.phalanx.description,
    cards: ["燧锋 8", "沧澜 8", "青陌 8"],
    englishName: "Phalanx / Kind",
    englishRule: "All troop cards have the same value.",
    englishCards: ["Red 8", "Blue 8", "Green 8"],
  },
  {
    rank: 3,
    name: CONTENT.formations.battalion.name,
    rule: CONTENT.formations.battalion.description,
    cards: ["沧澜 2", "沧澜 7", "沧澜 9"],
    englishName: "Battalion / Flush",
    englishRule: "All troop cards have the same color.",
    englishCards: ["Blue 2", "Blue 7", "Blue 9"],
  },
  {
    rank: 4,
    name: CONTENT.formations.skirmish.name,
    rule: CONTENT.formations.skirmish.description,
    cards: ["燧锋 4", "沧澜 5", "青陌 6"],
    englishName: "Skirmish / Straight",
    englishRule: "Consecutive values in any colors.",
    englishCards: ["Red 4", "Blue 5", "Green 6"],
  },
  {
    rank: 5,
    name: CONTENT.formations.host.name,
    rule: CONTENT.formations.host.description,
    cards: ["燧锋 2", "沧澜 5", "青陌 9"],
    englishName: "Host / Sum",
    englishRule: "Any other formation; compare total value.",
    englishCards: ["Red 2", "Blue 5", "Green 9"],
  },
] as const;

function RulesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  if (!open) return null;
  const english = language === "en";
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
            <p className="eyebrow">M16-I · BILINGUAL FIELD MANUAL</p>
            <h2>{english ? "Rules Reference" : "规则速查"}</h2>
          </div>
          <div className="rules-header-actions">
            <div className="rules-language-toggle" aria-label="规则语言">
              <button
                aria-pressed={!english}
                onClick={() => setLanguage("zh")}
                type="button"
              >
                中文
              </button>
              <button
                aria-pressed={english}
                onClick={() => setLanguage("en")}
                type="button"
              >
                English
              </button>
            </div>
            <button aria-label="关闭规则速查" onClick={onClose} type="button">
              {english ? "Close" : "关闭"}
            </button>
          </div>
        </header>

        <section>
          <h3>{english ? "Objective & Turn" : "目标与回合"}</h3>
          <p>
            {english
              ? "Win immediately by claiming three adjacent flags or any five flags. On each turn, play one card, claim any eligible flags, then draw one card from either deck."
              : "率先夺得连续三座烽垒，或任意五座烽垒，即刻获胜。每回合依次列下一张牌、争取可夺烽垒，再从一个牌堆补一张牌。"}
          </p>
        </section>

        <section>
          <h3>{english ? "Formation Ranking" : "阵型强度"}</h3>
          <p className="rules-note">
            {english
              ? "Ranked strongest to weakest. Ties compare total value, then which formation was completed first."
              : "由上至下依次变弱；同类阵型先比较点数和，再比较完成先后。"}
          </p>
          <ol className="formation-reference">
            {FORMATION_EXAMPLES.map((formation) => (
              <li key={formation.name}>
                <span>{formation.rank}</span>
                <div>
                  <strong>
                    {english ? formation.englishName : formation.name}
                  </strong>
                  <small>
                    {english ? formation.englishRule : formation.rule}
                  </small>
                </div>
                <div
                  className="formation-example-cards"
                  aria-label={`${english ? formation.englishName : formation.name}${english ? " example" : "示例"}`}
                >
                  {(english ? formation.englishCards : formation.cards).map(
                    (card) => (
                      <b key={card}>{card}</b>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="rules-grid">
          <div>
            <h3>
              {english ? "Claiming a Flag" : `${CONTENT.terms.claim}规则`}
            </h3>
            <p>
              {english
                ? "Claim when your completed formation wins. If the opponent is incomplete, public information must prove that no available card can let them tie or beat it."
                : "己方兵列完成且强于对手时可以夺垒；若对手未完成，必须用所有公开可用牌证明其不可能反超。"}
            </p>
          </div>
          <div>
            <h3>
              {english ? "Tactic Families" : `${CONTENT.terms.tactic}术语`}
            </h3>
            <p>
              {english ? (
                "Morale cards join formations; Environment cards affect a whole flag; Guile cards resolve an immediate effect."
              ) : (
                <>
                  <b>{CONTENT.tacticCategories.morale}</b>加入阵型；
                  <b>{CONTENT.tacticCategories.environment}</b>改变整座烽垒；
                  <b>{CONTENT.tacticCategories.guile}</b>执行一次即时效果。
                </>
              )}
            </p>
          </div>
        </section>

        <section>
          <h3>{english ? "Special Rules" : "特殊规则"}</h3>
          <ul className="rules-bullets">
            <li>
              {english
                ? "You may play a tactic only when doing so leaves you at most one tactic ahead of your opponent."
                : "打出谋策后，己方累计谋策数最多只能比对手多一张。"}
            </li>
            <li>
              {english
                ? "Each player may use only one Leader card per game."
                : "每名阵使每局最多使用一张统帅类号令。"}
            </li>
            <li>
              {english
                ? "Fog compares total value only. Mud increases both formations at that flag to four cards."
                : "烟障只比较点数总和；陷辙令该烽垒双方兵列容量增加到四张。"}
            </li>
          </ul>
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
  let title = "选择燧锋 10";
  let detail = "烽垒 1 已有燧锋 8、燧锋 9。选择燧锋 10，可以组成最强的贯锋。";

  if (state.phase === "play-card" && selectedCard === "troop-red-10") {
    title = "部署到烽垒 1";
    detail = "烽垒 1 已高亮。点击其下方的“部署于此”。";
  } else if (state.phase === "optional-claims" && !firstFlagClaimed) {
    step = 2;
    title = "争取烽垒 1";
    detail = "燧锋 8、9、10 是最高点数贯锋；点击烽垒 1 下方的“夺垒”。";
  } else if (firstFlagClaimed && state.turn === 1) {
    step = 3;
    title = "首座烽垒已占领";
    detail = "结束争取，再从阵兵牌堆补一张牌，完成这个教学回合。";
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

function ExperienceSettings({
  open,
  soundEnabled,
  reducedMotion,
  onSoundChange,
  onReducedMotionChange,
  onClose,
}: {
  open: boolean;
  soundEnabled: boolean;
  reducedMotion: boolean;
  onSoundChange: (enabled: boolean) => void;
  onReducedMotionChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="rules-backdrop" data-testid="experience-settings">
      <aside
        aria-label="体验设置"
        aria-modal="true"
        className="rules-drawer experience-drawer"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">R5 · EXPERIENCE</p>
            <h2>体验设置</h2>
          </div>
          <button aria-label="关闭体验设置" onClick={onClose} type="button">
            关闭
          </button>
        </header>
        <section className="experience-options">
          <label>
            <input
              checked={soundEnabled}
              onChange={(event) => onSoundChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>音效反馈</strong>
              <small>为列阵、谋策、夺垒和胜利播放轻量提示音。</small>
            </span>
          </label>
          <label>
            <input
              checked={reducedMotion}
              onChange={(event) => onReducedMotionChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>减少动态效果</strong>
              <small>停用卡牌落位、占旗强调和 AI 推演脉冲。</small>
            </span>
          </label>
        </section>
        <p className="experience-note">
          偏好仅保存在当前浏览器；系统“减少动态效果”设置也会自动生效。
        </p>
      </aside>
    </div>
  );
}

const EMPTY_CONTENT_REVIEW: ContentReviewDraft = {
  confusingTerm: "",
  notes: "",
};

function ContentArchive({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ContentReviewDraft>(EMPTY_CONTENT_REVIEW);
  const [feedbackNotice, setFeedbackNotice] =
    useState("完成三项评分后可保存并导出。");

  useEffect(() => {
    if (!open) return;
    let savedResponse: ContentReviewDraft | undefined;
    try {
      const raw = window.localStorage.getItem(CONTENT_REVIEW_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { response?: ContentReviewDraft };
      savedResponse = saved.response;
    } catch {
      window.localStorage.removeItem(CONTENT_REVIEW_KEY);
    }
    if (!savedResponse) return;
    const timer = window.setTimeout(() => setDraft(savedResponse), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const updateDraft = <Key extends keyof ContentReviewDraft>(
    key: Key,
    value: ContentReviewDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const saveReview = () => {
    if (!isCompleteContentReview(draft)) {
      setFeedbackNotice("请先完成三项 1–5 分评分。");
      return undefined;
    }
    const review = createContentReviewExport(draft);
    window.localStorage.setItem(CONTENT_REVIEW_KEY, JSON.stringify(review));
    setFeedbackNotice("反馈已保存在当前浏览器。可继续修改并重新导出。");
    return review;
  };

  const exportReview = () => {
    const review = saveReview();
    if (!review) return;
    const url = URL.createObjectURL(
      new Blob([serializeContentReview(review)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${CONTENT.research.roundId}-${review.submittedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="rules-backdrop" data-testid="content-archive">
      <aside
        aria-label="原创内容档案"
        aria-modal="true"
        className="rules-drawer content-archive"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">M16-B · WORLD & RESEARCH</p>
            <h2>原创内容档案</h2>
          </div>
          <button aria-label="关闭原创内容档案" onClick={onClose} type="button">
            关闭
          </button>
        </header>

        <section className="world-brief">
          <p className="section-label">澜原纪事</p>
          <h3>{CONTENT.brand.fullTitle}</h3>
          <p>{CONTENT.brand.setting}</p>
          <div className="world-pillars" aria-label="主题支柱">
            <span>九垒传讯</span>
            <span>六旌列阵</span>
            <span>谋策改势</span>
          </div>
        </section>

        <section>
          <p className="section-label">六旌色谱</p>
          <div className="banner-codex">
            {CONTENT.ruleset.troopColors.map((color) => {
              const troop = CONTENT.troopColors[color];
              return (
                <article
                  key={color}
                  style={{ "--family-accent": troop.accent } as CSSProperties}
                >
                  <span aria-hidden="true">{troop.sigil}</span>
                  <div>
                    <strong>{troop.name}</strong>
                    <small>{troop.colorName}旌</small>
                    <p>{troop.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section>
          <p className="section-label">谋策谱系</p>
          <div className="tactic-codex">
            {(
              Object.keys(CONTENT.tacticCategories) as Array<
                keyof typeof CONTENT.tacticCategories
              >
            ).map((category) => (
              <article
                key={category}
                style={
                  {
                    "--family-accent":
                      CONTENT.tacticCategoryThemes[category].accent,
                  } as CSSProperties
                }
              >
                <span aria-hidden="true">
                  {CONTENT.tacticCategoryThemes[category].sigil}
                </span>
                <div>
                  <strong>{CONTENT.tacticCategories[category]}</strong>
                  <p>
                    {CONTENT.ruleset.tacticIds
                      .filter((id) => getTacticCard(id)?.category === category)
                      .map((id) => CONTENT.tactics[id].name)
                      .join(" · ")}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <form
          className="content-review-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveReview();
          }}
        >
          <div>
            <p className="section-label">{CONTENT.research.roundId}</p>
            <h3>{CONTENT.research.title}</h3>
            <p>{CONTENT.research.introduction}</p>
          </div>

          {CONTENT.research.dimensions.map((dimension) => (
            <fieldset key={dimension.id}>
              <legend>{dimension.label}</legend>
              <p>{dimension.prompt}</p>
              <div className="score-options">
                {([1, 2, 3, 4, 5] as const).map((score) => (
                  <label key={score}>
                    <input
                      checked={draft[dimension.id] === score}
                      name={dimension.id}
                      onChange={() => updateDraft(dimension.id, score)}
                      type="radio"
                    />
                    {score}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <label>
            <span>最容易记住的旌团</span>
            <select
              onChange={(event) =>
                updateDraft(
                  "memorableTroop",
                  event.target.value
                    ? (event.target
                        .value as ContentReviewDraft["memorableTroop"])
                    : undefined,
                )
              }
              value={draft.memorableTroop ?? ""}
            >
              <option value="">暂不选择</option>
              {CONTENT.ruleset.troopColors.map((color) => (
                <option key={color} value={color}>
                  {CONTENT.troopColors[color].name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>最难理解的术语</span>
            <input
              maxLength={80}
              onChange={(event) =>
                updateDraft("confusingTerm", event.target.value)
              }
              placeholder="若没有，可留空"
              type="text"
              value={draft.confusingTerm}
            />
          </label>

          <label>
            <span>其他观察</span>
            <textarea
              maxLength={500}
              onChange={(event) => updateDraft("notes", event.target.value)}
              placeholder="哪些名称、颜色或设定最有辨识度？"
              rows={4}
              value={draft.notes}
            />
          </label>

          <div className="content-review-actions">
            <button type="submit">保存到本机</button>
            <button onClick={exportReview} type="button">
              导出反馈 JSON
            </button>
          </div>
          <p aria-live="polite" className="content-review-notice">
            {feedbackNotice}
          </p>
        </form>
      </aside>
    </div>
  );
}

function SetupScreen({
  seed,
  mode,
  aiDifficulty,
  firstPlayer,
  ready,
  canResume,
  onSeedChange,
  onModeChange,
  onAiDifficultyChange,
  onFirstPlayerChange,
  onStart,
  onResume,
  onOpenRules,
  onOpenSettings,
  onOpenOnline,
  onOpenContent,
}: {
  seed: string;
  mode: MatchMode;
  aiDifficulty: AiDifficulty;
  firstPlayer: PlayerId;
  ready: boolean;
  canResume: boolean;
  onSeedChange: (seed: string) => void;
  onModeChange: (mode: MatchMode) => void;
  onAiDifficultyChange: (difficulty: AiDifficulty) => void;
  onFirstPlayerChange: (player: PlayerId) => void;
  onStart: () => void;
  onResume: () => void;
  onOpenRules: () => void;
  onOpenSettings: () => void;
  onOpenOnline: () => void;
  onOpenContent: () => void;
}) {
  return (
    <main
      className="main-menu-shell"
      data-ready={ready}
      data-testid="game-setup"
    >
      <div className="main-menu-art" aria-hidden="true" />
      <div className="main-menu-shade" aria-hidden="true" />

      <header className="main-menu-header">
        <div className="main-menu-wordmark">
          <span aria-hidden="true">{CONTENT.brand.emblem}</span>
          <div>
            <strong>{CONTENT.brand.name}</strong>
            <small>{CONTENT.brand.subtitle}</small>
          </div>
        </div>
        <nav aria-label="主菜单辅助入口">
          <button disabled={!ready} onClick={onOpenRules} type="button">
            规则
          </button>
          <button disabled={!ready} onClick={onOpenContent} type="button">
            世界观
          </button>
          <button disabled={!ready} onClick={onOpenSettings} type="button">
            设置
          </button>
        </nav>
      </header>

      <section className="main-menu-layout">
        <div className="main-menu-hero">
          <p className="eyebrow">M16-I · MAIN COMMAND</p>
          <h1>{CONTENT.brand.name}</h1>
          <p className="main-menu-subtitle">{CONTENT.brand.subtitle}</p>
          <p className="main-menu-description">{CONTENT.brand.description}</p>
          <div className="main-menu-metrics" aria-label="游戏概览">
            <span>
              <b>09</b> 烽垒
            </span>
            <span>
              <b>06</b> 旌团
            </span>
            <span>
              <b>20</b> 分钟
            </span>
          </div>
        </div>

        <form
          className="main-menu-panel match-setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            onStart();
          }}
        >
          <header>
            <div>
              <p className="section-label">部署令</p>
              <h2>选择战局</h2>
            </div>
            <span>{APP_VERSION}</span>
          </header>

          <fieldset className="mode-selector">
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
                <small>完整阵兵与谋策</small>
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
                <small>只使用阵兵</small>
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
                <small>三步夺取首垒</small>
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
                <small>执{playerName("player-one")}迎战 AI</small>
              </span>
            </label>
          </fieldset>

          {mode === "solo" && (
            <fieldset>
              <legend>AI 难度</legend>
              <div className="first-player-options">
                {(["standard", "easy"] as const).map((difficulty) => (
                  <label
                    className={aiDifficulty === difficulty ? "selected" : ""}
                    key={difficulty}
                  >
                    <input
                      checked={aiDifficulty === difficulty}
                      name="ai-difficulty"
                      onChange={() => onAiDifficultyChange(difficulty)}
                      type="radio"
                    />
                    {difficulty === "standard" ? "标准 AI" : "简单 AI"}
                  </label>
                ))}
              </div>
              <small>
                {aiDifficulty === "standard"
                  ? "评估威胁、连续烽垒、兵列潜力与谋策价值。"
                  : "使用合法动作与基础成型启发，适合首次对战。"}
              </small>
            </fieldset>
          )}

          <div className="main-menu-options">
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
              {mode === "solo" && (
                <small>
                  单人模式固定由{playerName("player-one")}玩家先手。
                </small>
              )}
            </fieldset>

            <label className="seed-field" htmlFor="game-seed">
              <span>局面种子</span>
              <input
                id="game-seed"
                onChange={(event) => onSeedChange(event.target.value)}
                value={seed}
              />
              <small>相同配置会复现同一牌序。</small>
            </label>
          </div>

          <div className="main-menu-actions">
            <button
              className="primary-menu-action"
              disabled={!ready}
              type="submit"
            >
              {mode === "tutorial"
                ? "开始三步引导"
                : mode === "solo"
                  ? "开始单人对战"
                  : "开始本地对战"}
            </button>
            {canResume && (
              <button
                className="resume-menu-action"
                disabled={!ready}
                onClick={onResume}
                type="button"
              >
                继续当前对局
              </button>
            )}
            <button disabled={!ready} onClick={onOpenOnline} type="button">
              进入在线房间
            </button>
          </div>

          <footer>
            <span>自动存档 · 确定性牌序</span>
            <span>内容 {GAME_CONTENT_VERSION}</span>
          </footer>
        </form>
      </section>
    </main>
  );
}

type OnlineSession = {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly inviteCode: string;
  readonly playerId: PlayerId;
  readonly token: string;
};

type OnlinePayload = {
  readonly room: PublicRoomView;
  readonly session?: { readonly playerId: PlayerId; readonly token: string };
  readonly snapshot?: ProtocolSnapshot;
  readonly result?: ProtocolCommandResult;
};

function onlineCommandLabel(command: GameCommand): string {
  if (command.type === "play-tactic")
    return `打出 ${tacticContentName(command.cardId) ?? command.cardId}`;
  if (command.type === "choose-scout-draw")
    return `${tacticContentName("tactic-scout")}抽牌：${command.piles
      .map((pile) => CONTENT.piles[pile].shortName)
      .join("/")}`;
  if (command.type === "choose-scout-return")
    return `${tacticContentName("tactic-scout")}放回：${command.cardIds.map((cardId) => cardView(cardId).title).join("、")}`;
  if (command.type === "choose-tactic-source")
    return `选择烽垒 ${command.flagId + 1} 的${cardView(command.cardId).title}`;
  if (command.type === "choose-tactic-destination")
    return command.discard
      ? "弃置所选场上牌"
      : `移动至烽垒 ${(command.flagId ?? 0) + 1}`;
  if (command.type === "draw-card")
    return `从${CONTENT.piles[command.pile].name}牌堆补牌`;
  if (command.type === "pass-claims") return "结束争取";
  if (command.type === "skip-play") return "跳过部署";
  if (command.type === "cancel-tactic") return "取消谋策";
  if (command.type === "end-turn") return "结束回合";
  if (command.type === "claim-flag")
    return `${CONTENT.terms.claim}${CONTENT.terms.flag} ${command.flagId + 1}`;
  return `部署 ${cardView(command.cardId).title}`;
}

function OnlineRoom({
  ready,
  seed,
  onBack,
}: {
  ready: boolean;
  seed: string;
  onBack: () => void;
}) {
  const [session, setSession] = useState<OnlineSession>();
  const [room, setRoom] = useState<PublicRoomView>();
  const [protocol, setProtocol] = useState<ProtocolSnapshot>();
  const [inviteCode, setInviteCode] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardId>();
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState("创建房间或输入邀请码加入对局。");
  const revision = useRef<string | undefined>(undefined);
  const syncing = useRef(false);

  const rememberSession = useCallback((next: OnlineSession) => {
    window.sessionStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(next));
    revision.current = undefined;
    setSession(next);
  }, []);

  useEffect(() => {
    let storedSession: OnlineSession | undefined;
    try {
      const raw = window.sessionStorage.getItem(ONLINE_SESSION_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as OnlineSession;
        if (
          stored.schemaVersion === 1 &&
          stored.roomId &&
          stored.token &&
          (stored.playerId === "player-one" || stored.playerId === "player-two")
        )
          storedSession = stored;
      }
    } catch {
      window.sessionStorage.removeItem(ONLINE_SESSION_KEY);
    }
    const timer = window.setTimeout(() => {
      if (storedSession) setSession(storedSession);
      setRestoring(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const syncRoom = useCallback(async () => {
    if (!session || syncing.current) return;
    syncing.current = true;
    try {
      const response = await fetch(`/api/rooms/${session.roomId}`, {
        headers: {
          authorization: `Bearer ${session.token}`,
          ...(revision.current ? { "if-none-match": revision.current } : {}),
        },
        cache: "no-store",
      });
      if (response.status === 304) {
        setConnected(true);
        return;
      }
      if (!response.ok) throw new Error(`同步失败（${response.status}）`);
      revision.current = response.headers.get("etag") ?? undefined;
      const payload = (await response.json()) as OnlinePayload;
      setRoom(payload.room);
      if (payload.snapshot) setProtocol(payload.snapshot);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setNotice(error instanceof Error ? error.message : "房间同步失败。");
    } finally {
      syncing.current = false;
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const initial = window.setTimeout(() => void syncRoom(), 0);
    const timer = window.setInterval(() => void syncRoom(), 1_500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [session, syncRoom]);

  const roomAction = useCallback(
    async (body: Record<string, unknown>): Promise<OnlinePayload> => {
      if (!session) throw new Error("在线会话不存在。");
      const response = await fetch(`/api/rooms/${session.roomId}/actions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as OnlinePayload & {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message ?? payload.error ?? "房间动作失败。");
      revision.current = response.headers.get("etag") ?? undefined;
      setRoom(payload.room);
      if (payload.snapshot) setProtocol(payload.snapshot);
      setConnected(true);
      return payload;
    },
    [session],
  );

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      void roomAction({ action: "heartbeat" }).catch(() => setConnected(false));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [roomAction, session]);

  const createOnlineRoom = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed }),
      });
      const payload = (await response.json()) as OnlinePayload;
      if (!response.ok || !payload.session)
        throw new Error("创建在线房间失败。");
      const next: OnlineSession = {
        schemaVersion: 1,
        roomId: payload.room.roomId,
        inviteCode: payload.room.inviteCode,
        playerId: payload.session.playerId,
        token: payload.session.token,
      };
      rememberSession(next);
      setRoom(payload.room);
      setNotice("房间已创建，请分享邀请码并准备。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建房间失败。");
    } finally {
      setBusy(false);
    }
  };

  const joinOnlineRoom = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const payload = (await response.json()) as OnlinePayload;
      if (!response.ok || !payload.session)
        throw new Error("邀请码无效或房间已满。");
      const next: OnlineSession = {
        schemaVersion: 1,
        roomId: payload.room.roomId,
        inviteCode: payload.room.inviteCode,
        playerId: payload.session.playerId,
        token: payload.session.token,
      };
      rememberSession(next);
      setRoom(payload.room);
      setNotice("已加入房间，请确认准备状态。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加入房间失败。");
    } finally {
      setBusy(false);
    }
  };

  const toggleReady = async () => {
    if (!session || !room) return;
    setBusy(true);
    try {
      const current = room.seats[session.playerId]?.ready === true;
      await roomAction({ action: "ready", ready: !current });
      setNotice(current ? "已取消准备。" : "已准备，等待对手。 ");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "准备失败。");
    } finally {
      setBusy(false);
    }
  };

  const sendCommand = async (command: GameCommand) => {
    if (!session || !protocol) return;
    const envelope = createCommandEnvelope({
      roomId: session.roomId,
      commandId: crypto.randomUUID(),
      sequence: protocol.nextSequence,
      playerId: session.playerId,
      clientVersion: APP_VERSION,
      expectedStateVersion: protocol.stateVersion,
      command,
    });
    setBusy(true);
    try {
      let payload: OnlinePayload | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          payload = await roomAction({ action: "command", envelope });
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }
      const result = payload?.result;
      if (!result) throw new Error("服务端未返回命令结果。");
      if (result.status === "rejected") {
        if (result.snapshot)
          setProtocol((current) =>
            current
              ? {
                  ...current,
                  stateVersion: result.stateVersion,
                  nextSequence: result.expectedSequence ?? current.nextSequence,
                  snapshot: result.snapshot!,
                }
              : current,
          );
        throw new Error(`${result.code}：${result.message}`);
      }
      setProtocol((current) =>
        current
          ? {
              ...current,
              stateVersion: result.stateVersion,
              eventCursor: result.eventCursor,
              nextSequence: result.sequence + 1,
              snapshot: result.snapshot,
            }
          : current,
      );
      setSelectedCard(undefined);
      setNotice(
        result.status === "duplicate" ? "命令已确认。" : "命令已执行。",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "命令提交失败。");
      void syncRoom();
    } finally {
      setBusy(false);
    }
  };

  const leaveRoom = async () => {
    if (session)
      await roomAction({ action: "disconnect" }).catch(() => undefined);
    window.sessionStorage.removeItem(ONLINE_SESSION_KEY);
    setSession(undefined);
    setRoom(undefined);
    setProtocol(undefined);
    onBack();
  };

  if (restoring)
    return (
      <main className="online-shell">
        <p>正在恢复在线会话…</p>
      </main>
    );

  if (!session || !room)
    return (
      <main className="online-shell" data-ready={ready}>
        <section
          className="online-card online-entry"
          data-testid="online-entry"
        >
          <p className="eyebrow">M16-F · ONLINE MUSTER</p>
          <h1>在线房间</h1>
          <p>创建六位邀请码，或加入另一位玩家已经创建的房间。</p>
          <button
            disabled={busy || !ready}
            onClick={createOnlineRoom}
            type="button"
          >
            创建在线房间
          </button>
          <div className="online-divider">
            <span>或</span>
          </div>
          <label htmlFor="online-invite-code">六位邀请码</label>
          <input
            autoComplete="off"
            id="online-invite-code"
            maxLength={6}
            onChange={(event) =>
              setInviteCode(
                event.target.value.toUpperCase().replace(/[^A-Z2-9]/gu, ""),
              )
            }
            placeholder="例如 N2GLJW"
            value={inviteCode}
          />
          <button
            disabled={busy || inviteCode.length !== 6}
            onClick={joinOnlineRoom}
            type="button"
          >
            加入房间
          </button>
          <p aria-live="polite" className="online-notice">
            {notice}
          </p>
          <button className="text-button" onClick={onBack} type="button">
            返回对局设置
          </button>
        </section>
      </main>
    );

  const seat = room.seats[session.playerId];
  const view: PlayerView | undefined = protocol?.snapshot;
  const opponent = otherPlayer(session.playerId);
  const selectedCommands = selectedCard
    ? (view?.legalCommands.filter(
        (command) =>
          (command.type === "play-troop" || command.type === "play-tactic") &&
          command.cardId === selectedCard,
      ) ?? [])
    : [];
  const auxiliaryCommands =
    view?.legalCommands.filter(
      (command) =>
        command.type !== "play-troop" &&
        command.type !== "claim-flag" &&
        !(command.type === "play-tactic" && command.flagId !== undefined),
    ) ?? [];

  return (
    <main
      className="online-shell"
      data-testid="online-room"
      style={
        {
          "--viewer-accent": CONTENT.players[session.playerId].accent,
        } as CSSProperties
      }
    >
      <section className="online-card online-lobby">
        <header>
          <div>
            <p className="eyebrow">M16-F · LIVE BATTLEFIELD</p>
            <h1>房间 {room.inviteCode}</h1>
          </div>
          <span
            className={`connection-pill ${connected ? "online" : "offline"}`}
          >
            {connected ? "已连接" : "正在重连"}
          </span>
        </header>

        {room.status === "waiting" || room.status === "ready" ? (
          <div className="online-waiting">
            <p>将邀请码发给另一位玩家，双方准备后自动开局。</p>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(room.inviteCode)
              }
              type="button"
            >
              复制邀请码 {room.inviteCode}
            </button>
            <div className="online-seats">
              {(["player-one", "player-two"] as const).map((player) => {
                const playerSeat = room.seats[player];
                return (
                  <article className={player} key={player}>
                    <span
                      className={`player-seal ${player}`}
                      aria-hidden="true"
                    >
                      {CONTENT.players[player].sigil}
                    </span>
                    <div>
                      <strong>{playerName(player)}</strong>
                      <span>
                        {playerSeat
                          ? playerSeat.connected
                            ? "在线"
                            : "断线保留"
                          : "等待加入"}
                      </span>
                      <small>{playerSeat?.ready ? "已准备" : "未准备"}</small>
                    </div>
                  </article>
                );
              })}
            </div>
            <button disabled={busy} onClick={toggleReady} type="button">
              {seat?.ready ? "取消准备" : "确认准备"}
            </button>
          </div>
        ) : view ? (
          <div className="online-match">
            <div className="online-turn">
              <div>
                <span
                  className={`player-seal compact ${view.activePlayer}`}
                  aria-hidden="true"
                >
                  {CONTENT.players[view.activePlayer].sigil}
                </span>
                <strong>
                  {view.activePlayer === session.playerId
                    ? "轮到你行动"
                    : "等待对手行动"}
                </strong>
              </div>
              <span>
                {PHASE_NAMES[view.phase]} · 第 {view.turn} 回合
              </span>
            </div>
            <div className="online-opponent-hand">
              <span
                className={`player-seal compact ${opponent}`}
                aria-hidden="true"
              >
                {CONTENT.players[opponent].sigil}
              </span>
              <div aria-hidden="true">
                {Array.from(
                  { length: view.players[opponent].handCount },
                  (_, index) => (
                    <span className="card-back" key={index} />
                  ),
                )}
              </div>
              <span>
                {playerName(opponent)}手牌 · {view.players[opponent].handCount}{" "}
                张
              </span>
            </div>
            <nav
              className="front-jump-nav online-front-nav"
              aria-label="在线战场快速定位"
            >
              {view.flags.map((flag) => {
                const legal =
                  selectedCommands.some(
                    (command) =>
                      "flagId" in command && command.flagId === flag.id,
                  ) ||
                  view.legalCommands.some(
                    (command) =>
                      command.type === "claim-flag" &&
                      command.flagId === flag.id,
                  );
                return (
                  <button
                    className={`${flag.owner ? "claimed" : ""} ${legal ? "legal-target" : ""}`}
                    data-owner={flag.owner ?? "unclaimed"}
                    key={flag.id}
                    onClick={() =>
                      document
                        .getElementById(`online-flag-${flag.id}`)
                        ?.scrollIntoView({ block: "nearest", inline: "center" })
                    }
                    type="button"
                  >
                    <span>{flag.id + 1}</span>
                    <small>
                      {flag.owner
                        ? CONTENT.players[flag.owner].sigil
                        : legal
                          ? "可"
                          : "·"}
                    </small>
                  </button>
                );
              })}
            </nav>
            <div className="online-flags">
              {view.flags.map((flag) => {
                const flagCommand =
                  selectedCommands.find(
                    (command) =>
                      "flagId" in command && command.flagId === flag.id,
                  ) ??
                  view.legalCommands.find(
                    (command) =>
                      command.type === "claim-flag" &&
                      command.flagId === flag.id,
                  );
                return (
                  <article
                    className={`${flag.owner ? "claimed" : ""} ${flagCommand ? "legal-target" : ""}`}
                    data-owner={flag.owner ?? "unclaimed"}
                    id={`online-flag-${flag.id}`}
                    key={flag.id}
                    style={
                      {
                        "--owner-accent": flag.owner
                          ? CONTENT.players[flag.owner].accent
                          : "var(--gold)",
                      } as CSSProperties
                    }
                  >
                    <div className="online-formation opponent">
                      {flag.sides[opponent].cards.map((cardId) => (
                        <CardFace cardId={cardId} compact key={cardId} />
                      ))}
                    </div>
                    <button
                      disabled={busy || !flagCommand}
                      onClick={() =>
                        flagCommand && void sendCommand(flagCommand)
                      }
                      type="button"
                    >
                      <span className="beacon-flame" aria-hidden="true" />
                      <span>烽垒 {String(flag.id + 1).padStart(2, "0")}</span>
                      <strong>
                        {flag.owner
                          ? `${playerName(flag.owner)}占领`
                          : flagCommand
                            ? onlineCommandLabel(flagCommand)
                            : "未决"}
                      </strong>
                      <small>
                        敌 ·{" "}
                        {formationSummary(
                          flag.sides[opponent].cards,
                          flag.capacity,
                          flag.environment,
                        )}
                      </small>
                      <small>
                        我 ·{" "}
                        {formationSummary(
                          flag.sides[session.playerId].cards,
                          flag.capacity,
                          flag.environment,
                        )}
                      </small>
                      {flag.environment.length > 0 && (
                        <em>
                          {flag.environment
                            .map((id) => tacticContentName(id))
                            .join(" · ")}
                        </em>
                      )}
                    </button>
                    <div className="online-formation">
                      {flag.sides[session.playerId].cards.map((cardId) => (
                        <CardFace cardId={cardId} compact key={cardId} />
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            <div
              className={`selected-order online-order ${selectedCard ? "active" : ""}`}
            >
              <span>在线军令</span>
              <strong>
                {selectedCard ? cardView(selectedCard).title : "等待选择手牌"}
              </strong>
              {selectedCard ? (
                <>
                  <small className="order-description">
                    {cardView(selectedCard).description}
                  </small>
                  <small className="order-targets">
                    合法烽垒 {selectedCommands.length} 处 · 命令由服务端权威确认
                  </small>
                  <button
                    className="order-clear"
                    disabled={busy}
                    onClick={() => setSelectedCard(undefined)}
                    type="button"
                  >
                    取消选牌
                  </button>
                </>
              ) : (
                <small>
                  {view.activePlayer === session.playerId
                    ? "选择手牌后，所有合法烽垒将同步高亮。"
                    : `等待${playerName(opponent)}提交行动。`}
                </small>
              )}
            </div>
            <div className="online-hand">
              <strong>你的手牌</strong>
              <div>
                {view.hand.map((cardId) => (
                  <button
                    aria-pressed={selectedCard === cardId}
                    disabled={busy}
                    key={cardId}
                    onClick={() =>
                      setSelectedCard((current) =>
                        current === cardId ? undefined : cardId,
                      )
                    }
                    type="button"
                  >
                    <CardFace cardId={cardId} />
                  </button>
                ))}
              </div>
            </div>
            <div className="online-commands">
              {auxiliaryCommands.map((command, index) => (
                <button
                  disabled={busy}
                  key={`${command.type}-${index}`}
                  onClick={() => void sendCommand(command)}
                  type="button"
                >
                  {onlineCommandLabel(command)}
                </button>
              ))}
              {view.phase === "finished" && (
                <button
                  disabled={busy}
                  onClick={() => void roomAction({ action: "rematch" })}
                  type="button"
                >
                  请求再战
                </button>
              )}
            </div>
          </div>
        ) : (
          <p>对局已开始，正在取得你的私密快照…</p>
        )}

        <p aria-live="polite" className="online-notice">
          {notice}
        </p>
        <footer>
          <button className="text-button" onClick={onBack} type="button">
            返回设置（保留会话）
          </button>
          <button
            className="text-button danger"
            onClick={leaveRoom}
            type="button"
          >
            离开房间
          </button>
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
      style={
        {
          "--viewer-accent": CONTENT.players[state.activePlayer].accent,
        } as CSSProperties
      }
    >
      <section className="handoff-card">
        <p className="eyebrow">M16-G · PRIVATE HANDOFF</p>
        <span
          className={`handoff-emblem ${state.activePlayer}`}
          aria-hidden="true"
        >
          {CONTENT.players[state.activePlayer].sigil}
        </span>
        <p>{restored ? "已恢复本地存档" : `第 ${state.turn} 回合`}</p>
        <h1>请将设备交给{playerName(state.activePlayer)}</h1>
        <p className="handoff-copy">
          当前页面不包含任何玩家手牌。确认周围无人查看后，再进入你的私密桌面。
        </p>
        <div className="handoff-public-status" aria-label="公开战况">
          <span>
            {CONTENT.players["player-one"].sigil} ·{" "}
            {state.flags.filter((flag) => flag.owner === "player-one").length}
          </span>
          <strong>公开战况</strong>
          <span>
            {CONTENT.players["player-two"].sigil} ·{" "}
            {state.flags.filter((flag) => flag.owner === "player-two").length}
          </span>
        </div>
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

function AiThinkingScreen({
  notice,
  difficulty,
}: {
  notice: string;
  difficulty: AiDifficulty;
}) {
  return (
    <main
      className="handoff-shell"
      data-testid="ai-thinking"
      style={
        {
          "--viewer-accent": CONTENT.players["player-two"].accent,
        } as CSSProperties
      }
    >
      <section className="handoff-card ai-thinking-card">
        <p className="eyebrow">
          M16-G · {difficulty === "standard" ? "STANDARD AI" : "EASY AI"}
        </p>
        <span className="handoff-emblem player-two" aria-hidden="true">
          {CONTENT.players["player-two"].sigil}
        </span>
        <p>
          {playerName("player-two")} · {AI_VERSION}
        </p>
        <h1>对手正在推演</h1>
        <p className="handoff-copy">{notice}</p>
        <small>
          AI 仅接收{playerName("player-two")} PlayerView · 不读取牌堆顺序或
          {playerName("player-one")}手牌
        </small>
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
            <p className="eyebrow">M16-G · VERIFIED WAR CHRONICLE</p>
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
          <h3>公开烽垒</h3>
          <div className="replay-flags">
            {publicView.flags.map((flag) => (
              <span className={flag.owner ?? "unclaimed"} key={flag.id}>
                <i className="beacon-flame" aria-hidden="true" />
                <b>{String(flag.id + 1).padStart(2, "0")}</b>
                <small>
                  {flag.owner
                    ? `${CONTENT.players[flag.owner].sigil} · ${playerName(flag.owner)}`
                    : "未决"}
                </small>
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
  rematchLabel,
  onRematch,
  onNewGame,
  onOpenReplay,
  onOpenSettings,
}: {
  state: GameState;
  rematchLabel: string;
  onRematch: () => void;
  onNewGame: () => void;
  onOpenReplay: () => void;
  onOpenSettings: () => void;
}) {
  const summary = buildGameSummary(state);
  const review = buildGameReview(state);
  return (
    <main
      className="result-shell"
      data-testid="game-result"
      style={
        {
          "--winner-accent": CONTENT.players[summary.winner].accent,
        } as CSSProperties
      }
    >
      <section className="result-card">
        <p className="eyebrow">M16-G · 对局结算 · {APP_VERSION}</p>
        <span className={`result-emblem ${summary.winner}`} aria-hidden="true">
          {CONTENT.players[summary.winner].sigil}
        </span>
        <p>第 {summary.turns} 回合结束</p>
        <h1>{playerName(summary.winner)}获胜</h1>
        <strong>
          {summary.condition === "breakthrough" ? "突破三线" : "包围五线"}
        </strong>
        <div className="result-fronts" aria-label="终局九垒归属">
          {state.flags.map((flag) => (
            <span
              className={`${flag.owner ?? "unclaimed"} ${summary.winningFlags.includes(flag.id) ? "decisive" : ""}`}
              key={flag.id}
            >
              <i className="beacon-flame" aria-hidden="true" />
              <b>{String(flag.id + 1).padStart(2, "0")}</b>
              <small>
                {flag.owner ? CONTENT.players[flag.owner].sigil : "未"}
              </small>
            </span>
          ))}
        </div>
        <div className="result-stats">
          <div>
            <span>制胜烽垒</span>
            <b>{summary.winningFlags.map((flag) => flag + 1).join(" · ")}</b>
          </div>
          <div>
            <span>{playerName("player-one")}占领</span>
            <b>{summary.claimedFlags["player-one"].length}</b>
          </div>
          <div>
            <span>{playerName("player-two")}占领</span>
            <b>{summary.claimedFlags["player-two"].length}</b>
          </div>
        </div>
        <section className="game-review" data-testid="game-review">
          <div className="review-heading">
            <div>
              <span>POST-GAME REVIEW</span>
              <h2>复盘摘要</h2>
            </div>
            <b>{review.leadChanges} 次领先易手</b>
          </div>
          <div className="review-table" role="table" aria-label="双方对局统计">
            <div className="review-row review-header" role="row">
              <span role="columnheader">阵营</span>
              <span role="columnheader">部署</span>
              <span role="columnheader">谋策</span>
              <span role="columnheader">补牌</span>
              <span role="columnheader">占旗</span>
            </div>
            {(["player-one", "player-two"] as const).map((player) => (
              <div className="review-row" key={player} role="row">
                <strong role="cell">{playerName(player)}</strong>
                <span role="cell">
                  {review.players[player].troopDeployments}
                </span>
                <span role="cell">{review.players[player].tacticsPlayed}</span>
                <span role="cell">{review.players[player].cardsDrawn}</span>
                <span role="cell">{review.players[player].flagsClaimed}</span>
              </div>
            ))}
          </div>
          <ul className="review-insights">
            {review.firstClaim && (
              <li>
                <span>首旗</span>
                {playerName(review.firstClaim.player)}在事件{" "}
                {review.firstClaim.eventIndex} 夺得烽垒{" "}
                {review.firstClaim.flagId + 1}
              </li>
            )}
            <li>
              <span>胜负手</span>
              {playerName(review.decisiveClaim.player)}在事件{" "}
              {review.decisiveClaim.eventIndex} 拿下烽垒{" "}
              {review.decisiveClaim.flagId + 1}
            </li>
            <li>
              <span>走势</span>
              {review.winnerCameBack
                ? `${playerName(summary.winner)}曾在占旗数上落后，最终完成逆转。`
                : `${playerName(summary.winner)}未曾在占旗数上落后，保持主动至终局。`}
            </li>
          </ul>
        </section>
        <div className="handoff-actions">
          <button onClick={onRematch} type="button">
            {rematchLabel}
          </button>
          <button onClick={onNewGame} type="button">
            返回全新对局
          </button>
          <button onClick={onOpenReplay} type="button">
            查看与导出回放
          </button>
          <button onClick={onOpenSettings} type="button">
            体验设置
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
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>("standard");
  const [firstPlayer, setFirstPlayer] = useState<PlayerId>("player-one");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
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
    let preferences = { soundEnabled: false, reducedMotion: false };
    try {
      const raw = window.localStorage.getItem(PREFERENCES_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as {
          soundEnabled?: boolean;
          reducedMotion?: boolean;
        };
        preferences = {
          soundEnabled: stored.soundEnabled === true,
          reducedMotion: stored.reducedMotion === true,
        };
      }
    } catch {
      window.localStorage.removeItem(PREFERENCES_KEY);
    }
    const timer = window.setTimeout(() => {
      setSoundEnabled(preferences.soundEnabled);
      setReducedMotion(preferences.reducedMotion);
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion
      ? "true"
      : "false";
  }, [reducedMotion]);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ soundEnabled, reducedMotion }),
    );
  }, [preferencesReady, reducedMotion, soundEnabled]);

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
      const savedMode = saved.matchMode ?? modeForState(saved.state);
      setMode(savedMode);
      setAiDifficulty(saved.aiDifficulty ?? "easy");
      setFirstPlayer(
        savedMode === "solo"
          ? "player-one"
          : (saved.state.events.find((event) => event.type === "game-started")
              ?.firstPlayer ?? "player-one"),
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
      aiDifficulty,
      replay: { initialState: replayInitialState, commands: replayCommands },
      state,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [
    hasActiveGame,
    aiDifficulty,
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
    const resolvedFirstPlayer =
      nextMode === "solo" ? "player-one" : firstPlayer;
    const next = newGame(nextSeed, resolvedFirstPlayer, nextMode);
    setState(next);
    setReplayInitialState(next);
    setReplayCommands([]);
    setSeed(next.seed);
    setMode(nextMode);
    setFirstPlayer(resolvedFirstPlayer);
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
      if (soundEnabled) playFeedbackSound(commandSound(command, next));
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
          difficulty: aiDifficulty,
          seed: `${state.seed}:zhu-yu`,
          decisionIndex: replayCommands.length,
          timeBudgetMs: 8,
        });
        const next = applyCommand(state, decision.command);
        setState(next);
        setReplayCommands((current) => [...current, decision.command]);
        setNotice(`${playerName("player-two")} AI：${decision.reason}`);
        if (soundEnabled)
          playFeedbackSound(commandSound(decision.command, next));
        if (next.activePlayer !== "player-two") setRevealedPlayer(undefined);
      } catch (error) {
        setNotice(
          `AI 行动失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [
    aiDifficulty,
    hasActiveGame,
    mode,
    ready,
    replayCommands.length,
    showSetup,
    soundEnabled,
    state,
  ]);

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
    setNotice("已选牌；高亮烽垒均为合法目标。");
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

  const settingsDrawer = (
    <ExperienceSettings
      onClose={() => setSettingsOpen(false)}
      onReducedMotionChange={setReducedMotion}
      onSoundChange={(enabled) => {
        setSoundEnabled(enabled);
        if (enabled) playFeedbackSound("confirm");
      }}
      open={settingsOpen}
      reducedMotion={reducedMotion}
      soundEnabled={soundEnabled}
    />
  );
  const contentDrawer = (
    <ContentArchive onClose={() => setContentOpen(false)} open={contentOpen} />
  );

  if (onlineOpen) {
    return (
      <OnlineRoom
        onBack={() => setOnlineOpen(false)}
        ready={ready}
        seed={seed}
      />
    );
  }

  if (showSetup) {
    return (
      <>
        <SetupScreen
          aiDifficulty={aiDifficulty}
          canResume={hasActiveGame}
          firstPlayer={firstPlayer}
          mode={mode}
          onFirstPlayerChange={setFirstPlayer}
          onAiDifficultyChange={setAiDifficulty}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            if (nextMode === "solo") setFirstPlayer("player-one");
          }}
          onOpenRules={() => setRulesOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenOnline={() => setOnlineOpen(true)}
          onOpenContent={() => setContentOpen(true)}
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
        {settingsDrawer}
        {contentDrawer}
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
          rematchLabel={mode === "solo" ? "以同难度再战" : "交换先手再战"}
          state={state}
          onNewGame={() => setShowSetup(true)}
          onOpenReplay={() => setReplayOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
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
        {settingsDrawer}
      </>
    );
  }

  if (mode === "solo" && state.activePlayer === "player-two") {
    return (
      <>
        <AiThinkingScreen difficulty={aiDifficulty} notice={notice} />
        {settingsDrawer}
      </>
    );
  }

  if (revealedPlayer !== state.activePlayer) {
    return (
      <>
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
        {settingsDrawer}
      </>
    );
  }

  return (
    <>
      <main
        className="game-shell"
        data-ready={ready}
        data-viewer={view.viewer}
        style={
          {
            "--viewer-accent": CONTENT.players[view.viewer].accent,
          } as CSSProperties
        }
      >
        <header className="game-header">
          <div className="brand-lockup">
            <p className="eyebrow">M16-E · TACTICAL CLARITY</p>
            <h1>{CONTENT.brand.name}</h1>
            <p>{CONTENT.brand.subtitle} · 九垒战场</p>
          </div>
          <div className="game-meta" aria-label="对局状态">
            <span>桌面 {APP_VERSION}</span>
            <strong>{PHASE_NAMES[view.phase]}</strong>
            <span>
              核心 {GAME_CORE_VERSION} · 内容 {GAME_CONTENT_VERSION} · 第{" "}
              {view.turn} 回合
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
              disabled={!ready}
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              体验设置
            </button>
            <button
              disabled={!ready}
              onClick={() => setContentOpen(true)}
              type="button"
            >
              内容档案
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
            <span className={`player-seal ${view.viewer}`} aria-hidden="true">
              {CONTENT.players[view.viewer].sigil}
            </span>
            <strong>{playerName(view.viewer)}行动</strong>
            <small>{notice}</small>
          </div>
          <div className="deck-counters">
            <span>
              {CONTENT.piles.troop.name}牌堆 {view.decks.troop}
            </span>
            <span>
              {CONTENT.piles.tactic.name}牌堆 {view.decks.tactic}
            </span>
            <span>对手手牌 {view.players[opponent].handCount}</span>
          </div>
        </section>

        <div className="game-layout">
          <section
            className="battlefield-panel"
            aria-label={CONTENT.terms.flags}
          >
            <div
              className="opponent-rack"
              aria-label={`${playerName(opponent)}手牌`}
            >
              <span
                className={`player-seal compact ${opponent}`}
                aria-hidden="true"
              >
                {CONTENT.players[opponent].sigil}
              </span>
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

            <nav className="front-jump-nav" aria-label="快速定位烽垒">
              {view.flags.map((flag) => {
                const command = flagCommand(flag.id);
                return (
                  <button
                    className={`${flag.owner ? "claimed" : ""} ${command ? "legal-target" : ""}`}
                    data-owner={flag.owner ?? "unclaimed"}
                    key={flag.id}
                    onClick={() =>
                      document
                        .getElementById(`battlefield-flag-${flag.id}`)
                        ?.scrollIntoView({ block: "nearest", inline: "center" })
                    }
                    type="button"
                  >
                    <span>{flag.id + 1}</span>
                    <small>
                      {flag.owner
                        ? CONTENT.players[flag.owner].sigil
                        : command
                          ? "可"
                          : "·"}
                    </small>
                  </button>
                );
              })}
            </nav>

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
                      data-owner={flag.owner ?? "unclaimed"}
                      data-testid={`flag-${flag.id}`}
                      id={`battlefield-flag-${flag.id}`}
                      key={flag.id}
                      style={
                        {
                          "--owner-accent": flag.owner
                            ? CONTENT.players[flag.owner].accent
                            : "var(--gold)",
                        } as CSSProperties
                      }
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
                        <span className="beacon-flame" aria-hidden="true" />
                        <span>烽垒 {String(flag.id + 1).padStart(2, "0")}</span>
                        <strong>
                          {flag.owner
                            ? `${playerName(flag.owner)}占领`
                            : "未决"}
                        </strong>
                        <div className="formation-readout">
                          <span>
                            敌 ·{" "}
                            {formationSummary(
                              flag.sides[opponent].cards,
                              flag.capacity,
                              flag.environment,
                            )}
                          </span>
                          <span>
                            我 ·{" "}
                            {formationSummary(
                              flag.sides[view.viewer].cards,
                              flag.capacity,
                              flag.environment,
                            )}
                          </span>
                        </div>
                        {flag.environment.length > 0 && (
                          <small>
                            {flag.environment
                              .map((id) => tacticContentName(id))
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
                          ? "夺垒"
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
                  <span
                    className={`player-seal compact ${view.viewer}`}
                    aria-hidden="true"
                  >
                    {CONTENT.players[view.viewer].sigil}
                  </span>
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
            <p className="command-seal" aria-hidden="true">
              阵令
            </p>
            {mode === "tutorial" && (
              <TutorialCoach selectedCard={selectedCard} state={state} />
            )}
            <div className={`selected-order ${selectedCard ? "active" : ""}`}>
              <span>已选军令</span>
              <strong>
                {selectedCard ? cardView(selectedCard).title : "等待选择手牌"}
              </strong>
              {selectedCard ? (
                <>
                  <small className="order-description">
                    {cardView(selectedCard).description}
                  </small>
                  <small className="order-targets">
                    合法烽垒{" "}
                    {view.flags.filter((flag) => flagCommand(flag.id)).length}{" "}
                    处
                  </small>
                  <button
                    className="order-clear"
                    onClick={() => setSelectedCard(undefined)}
                    type="button"
                  >
                    取消选牌
                  </button>
                </>
              ) : (
                <small>选中一张手牌后，战场将标出所有合法位置。</small>
              )}
            </div>
            <div>
              <p className="section-label">当前阶段</p>
              <h2>{PHASE_NAMES[view.phase]}</h2>
              <p className="command-help">
                {view.phase === "play-card" && "选择手牌，然后选择高亮烽垒。"}
                {view.phase === "resolve-tactic" && "按谋策提示完成当前选择。"}
                {view.phase === "optional-claims" &&
                  "争取可夺烽垒，或结束争取。"}
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
                  打出
                  {selectedCard
                    ? tacticContentName(selectedCard)
                    : CONTENT.terms.tactic}
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
                      {tacticContentName("tactic-scout")}：
                      {command.piles
                        .map((pile) => CONTENT.piles[pile].shortName)
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
                  结束争取
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
                      从{CONTENT.piles[command.pile].name}牌堆补牌
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
                  取消谋策
                </button>
              )}
            </div>

            <div className="discard-summary">
              <span>阵兵弃牌 {view.troopDiscard.length}</span>
              <span>谋策弃牌 {view.tacticDiscard.length}</span>
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
      {settingsDrawer}
      {contentDrawer}
    </>
  );
}
