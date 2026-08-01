import { expect, test, type Page } from "@playwright/test";
import {
  assertGameState,
  createEmptyGameState,
  createStandardGame,
  type CardId,
  type GameState,
  type PlayerId,
  type WinResult,
} from "../../packages/game-core/src";

const SAVE_KEY = "guzhanzhen.local-game.v1";

async function startMatch(
  page: Page,
  options: {
    seed?: string;
    mode?: "standard" | "basic" | "tutorial" | "solo";
    firstPlayer?: PlayerId;
  } = {},
) {
  await expect(page.getByTestId("game-setup")).toHaveAttribute(
    "data-ready",
    "true",
  );
  if (options.seed) await page.getByLabel("局面种子").fill(options.seed);
  if (options.mode === "basic")
    await page.getByText("基础对局", { exact: true }).click();
  if (options.mode === "tutorial")
    await page.getByText("引导对局", { exact: true }).click();
  if (options.mode === "solo")
    await page.getByText("单人对 AI", { exact: true }).click();
  if (options.firstPlayer === "player-two")
    await page.getByText("朱羽先手", { exact: true }).click();
  await page
    .getByRole("button", {
      name:
        options.mode === "tutorial"
          ? "开始三步引导"
          : options.mode === "solo"
            ? "开始单人对战"
            : "开始本地对战",
    })
    .click();
}

async function acceptHandoff(page: Page) {
  await expect(page.getByTestId("handoff-gate")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByTestId("hand-card")).toHaveCount(0);
  await page.getByRole("button", { name: "确认接管并查看手牌" }).click();
  await expect(page.locator("main.game-shell")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

async function deployAndDraw(page: Page, flagId: number, pile = "troop") {
  await page.getByTestId("hand-card").first().click();
  await page.getByTestId(`flag-target-${flagId}`).click();
  await page.getByTestId("pass-claims").click();
  await page.getByTestId(`draw-${pile}`).click();
}

function saveEnvelope(state: GameState) {
  assertGameState(state);
  return {
    schemaVersion: 1,
    appVersion: "1.3.0-r5.m13a",
    savedAt: "2026-08-01T00:00:00.000Z",
    state,
  };
}

function tacticFixture(tacticId: CardId, opponentCard = false): GameState {
  const state = createStandardGame(`r3-e2e:${tacticId}`);
  const tacticIndex = state.tacticDeck.indexOf(tacticId);
  const displaced = state.players["player-one"].hand[0];
  state.players["player-one"].hand[0] = tacticId;
  state.tacticDeck[tacticIndex] = displaced;
  if (opponentCard) {
    const [cardId] = state.players["player-two"].hand.splice(0, 1);
    state.flags[0].sides["player-two"].cards.push(cardId);
  }
  assertGameState(state);
  return state;
}

function victoryFixture(condition: WinResult["condition"]): GameState {
  const state = createEmptyGameState(`r3-e2e:${condition}`);
  const claimedFlags =
    condition === "breakthrough" ? [2, 3, 4] : [0, 2, 4, 6, 8];
  state.phase = "finished";
  state.turn = 18;
  state.winner = { player: "player-one", condition };
  claimedFlags.forEach((flagId) => {
    state.flags[flagId].owner = "player-one";
  });
  state.events = [
    {
      index: 1,
      type: "game-started",
      seed: state.seed,
      firstPlayer: "player-one",
    },
    ...claimedFlags.map((flagId, index) => ({
      index: index + 2,
      type: "flag-claimed" as const,
      player: "player-one" as const,
      flagId,
    })),
    {
      index: claimedFlags.length + 2,
      type: "game-won",
      player: "player-one",
      condition,
    },
  ];
  state.eventIndex = state.events.length;
  assertGameState(state);
  return state;
}

async function loadSavedState(page: Page, state: GameState) {
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    { key: SAVE_KEY, saved: saveEnvelope(state) },
  );
  await page.goto("/");
}

test("opens the rules reference with all five formation examples", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "规则速查" }).click();
  const drawer = page.getByRole("dialog", { name: "规则速查" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".formation-reference li")).toHaveCount(5);
  await expect(drawer).toContainText("连续三条战线");
  await expect(drawer).toContainText("任意五条战线");
  await expect(drawer).toContainText("楔形阵");
  await expect(drawer).toContainText("军团");
  await page.getByRole("button", { name: "关闭规则速查" }).click();
  await expect(drawer).toHaveCount(0);
});

test("guides a new player through the first flag claim", async ({ page }) => {
  await page.goto("/");
  await startMatch(page, { mode: "tutorial", seed: "m11-first-flag" });
  await acceptHandoff(page);

  const coach = page.getByTestId("tutorial-coach");
  await expect(coach).toContainText("选择赤 10");
  await page.getByRole("button", { name: "赤 10 部队" }).click();
  await expect(coach).toContainText("部署到战线 1");
  await page.getByTestId("flag-target-0").click();
  await expect(coach).toContainText("宣告战线 1");
  await page.getByTestId("flag-target-0").click();
  await expect(page.getByTestId("flag-0")).toContainText("玄甲占领");
  await expect(coach).toContainText("首面旗帜已占领");
  await page.getByTestId("pass-claims").click();
  await page.getByTestId("draw-troop").click();

  await acceptHandoff(page);
  await expect(page.getByTestId("tutorial-coach")).toContainText(
    "教学目标达成",
  );
});

test("starts standard and basic matches from explicit setup", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "古战阵" })).toBeVisible();
  await startMatch(page, {
    seed: "r3-basic-mode",
    mode: "basic",
    firstPlayer: "player-two",
  });
  await expect(page.getByText("请将设备交给朱羽")).toBeVisible();
  await acceptHandoff(page);
  await expect(page.getByText("基础对局", { exact: true })).toBeVisible();
  await expect(page.getByText("战术牌堆 0")).toBeVisible();
});

test("runs the朱羽 easy AI turn without exposing either hand", async ({
  page,
}) => {
  await page.goto("/");
  await startMatch(page, { mode: "solo", seed: "r5-solo-easy" });
  await acceptHandoff(page);
  await expect(page.getByText("单人对 AI", { exact: true })).toBeVisible();
  await deployAndDraw(page, 0);

  await expect(page.getByTestId("ai-thinking")).toBeVisible();
  await expect(page.getByTestId("hand-card")).toHaveCount(0);
  await expect(page.getByText("请将设备交给朱羽")).toHaveCount(0);
  await expect(page.getByText("请将设备交给玄甲")).toBeVisible();
  await acceptHandoff(page);
  await expect(page.getByLabel("对局状态")).toContainText("第 3 回合");
  await expect(page.locator(".opponent-formation .card-face")).toHaveCount(1);
});

test("protects handoff while completing the first local turn", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/古战阵/);
  await startMatch(page);
  await expect(page.getByText("请将设备交给玄甲")).toBeVisible();
  await acceptHandoff(page);

  await expect(page.getByTestId(/^flag-\d+$/)).toHaveCount(9);
  await expect(page.getByTestId("hand-card")).toHaveCount(7);
  await deployAndDraw(page, 0);

  await expect(page.getByText("请将设备交给朱羽")).toBeVisible();
  await expect(page.getByTestId("hand-card")).toHaveCount(0);
  await expect(page.locator(".battlefield-panel")).toHaveCount(0);
  await acceptHandoff(page);
  await expect(page.getByText("朱羽行动")).toBeVisible();
  await expect(page.getByLabel("对局状态")).toContainText("第 2 回合");
});

test("keeps the table contained at target viewport sizes", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await startMatch(page);
    await acceptHandoff(page);
    await expect(page.locator(".battlefield-panel")).toBeVisible();
    await expect(page.locator(".command-panel")).toBeVisible();
    const bodyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(bodyOverflow).toBe(false);
  }
});

test("routes drag and drop through the same deployment command", async ({
  page,
}) => {
  await page.goto("/");
  await startMatch(page);
  await acceptHandoff(page);
  await page
    .getByTestId("hand-card")
    .first()
    .dragTo(page.getByTestId("flag-0"));
  await expect(page.getByTestId("hand-card")).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "宣告战线", level: 2 }),
  ).toBeVisible();
});

test("scrubs an active match through public replay states", async ({
  page,
}) => {
  await page.goto("/");
  await startMatch(page, { mode: "basic", seed: "m12-public-replay" });
  await acceptHandoff(page);
  await page.getByTestId("hand-card").first().click();
  await page.getByTestId("flag-target-0").click();
  await page.getByRole("button", { name: "公开回放" }).click();

  const drawer = page.getByRole("dialog", { name: "对局回放" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("1 / 1");
  await expect(drawer.getByTestId("hand-card")).toHaveCount(0);
  await expect(
    drawer.getByRole("button", { name: "结束后可导出" }),
  ).toBeDisabled();
  await drawer.getByRole("button", { name: "上一步" }).click();
  await expect(drawer).toContainText("0 / 1");
  await drawer.getByRole("button", { name: "下一步" }).click();
  await expect(drawer).toContainText("1 / 1");
});

test("does not place opponent card identities in accessible DOM", async ({
  page,
}) => {
  await page.goto("/");
  await startMatch(page);
  await acceptHandoff(page);
  const opponentRack = page.locator(".opponent-rack");
  await expect(opponentRack).toContainText("朱羽 · 7 张");
  await expect(opponentRack).not.toContainText("troop-");
  await expect(opponentRack).not.toContainText("tactic-");
});

test("resolves Scout through the multi-step command panel", async ({
  page,
}) => {
  await page.goto("/");
  await startMatch(page, { seed: "m09-guile-17" });
  await acceptHandoff(page);

  await deployAndDraw(page, 0, "tactic");
  await acceptHandoff(page);
  await deployAndDraw(page, 1, "troop");
  await acceptHandoff(page);

  await page.getByRole("button", { name: "侦察 诡计" }).click();
  await page.getByRole("button", { name: "打出侦察" }).click();
  await page.getByRole("button", { name: "侦察：部 / 部 / 部" }).click();
  await page.getByTestId("hand-card").first().click();
  await page.getByTestId("hand-card").nth(1).click();
  await page.getByRole("button", { name: "放回已选 2/2 张" }).click();

  await expect(
    page.getByRole("heading", { name: "宣告战线", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("战术结算完成")).toBeVisible();
});

test("auto-saves and restores the exact local position behind handoff", async ({
  page,
}) => {
  await page.goto("/");
  await startMatch(page);
  await acceptHandoff(page);
  await page.getByTestId("hand-card").first().click();
  await page.getByTestId("flag-target-0").click();
  await expect(page.getByTestId("hand-card")).toHaveCount(6);
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw).state.phase : undefined;
      }, SAVE_KEY),
    )
    .toBe("optional-claims");

  await page.reload();
  await expect(page.getByText("已恢复本地存档")).toBeVisible();
  await expect(page.getByTestId("hand-card")).toHaveCount(0);
  await acceptHandoff(page);
  await expect(page.getByTestId("hand-card")).toHaveCount(6);
  await expect(
    page.getByTestId("flag-0").locator(".player-formation .card-face"),
  ).toHaveCount(1);
});

test("plays Fog as a representative environment tactic", async ({ page }) => {
  await loadSavedState(page, tacticFixture("tactic-fog"));
  await acceptHandoff(page);
  await page.getByRole("button", { name: "迷雾 环境" }).click();
  await page.getByTestId("flag-target-0").click();
  await expect(page.getByTestId("flag-0")).toContainText("迷雾");
  await expect(
    page.getByRole("heading", { name: "宣告战线", level: 2 }),
  ).toBeVisible();
});

test("plays Deserter as a representative field tactic", async ({ page }) => {
  await loadSavedState(page, tacticFixture("tactic-deserter", true));
  await acceptHandoff(page);
  await page.getByRole("button", { name: "逃兵 诡计" }).click();
  await page.getByRole("button", { name: "打出逃兵" }).click();
  await page.locator(".opponent-formation .source-card").click();
  await expect(page.getByText("场上牌被弃置")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "宣告战线", level: 2 }),
  ).toBeVisible();
});

for (const [condition, label] of [
  ["breakthrough", "突破三线"],
  ["envelopment", "包围五线"],
] as const) {
  test(`shows the ${condition} victory path and starts a private rematch`, async ({
    page,
  }) => {
    await loadSavedState(page, victoryFixture(condition));
    await expect(page.getByTestId("game-result")).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    if (condition === "breakthrough") {
      await page.getByRole("button", { name: "查看与导出回放" }).click();
      const replay = page.getByRole("dialog", { name: "对局回放" });
      await replay.getByRole("button", { name: "生成完整回放档案" }).click();
      const archiveText = await replay.getByLabel("回放档案").inputValue();
      expect(JSON.parse(archiveText)).toMatchObject({
        schemaVersion: 1,
        finalStateHash: expect.stringMatching(/^fnv1a-/),
      });
      await replay.getByRole("button", { name: "校验并导入" }).click();
      await expect(page.getByTestId("game-result")).toBeVisible();
    }
    await page.getByRole("button", { name: "交换先手再战" }).click();
    await expect(page.getByTestId("handoff-gate")).toBeVisible();
    await expect(page.getByTestId("hand-card")).toHaveCount(0);
    await acceptHandoff(page);
    await expect(page.getByTestId("hand-card")).toHaveCount(7);
    await expect(page.getByText("朱羽行动")).toBeVisible();
  });
}
