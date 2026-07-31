# 古战阵 Web

以九条战线、三牌阵型和兵法时机为核心的双人策略网页游戏。

项目当前已完成 **R1：无界面的基础规则引擎**。规则核心可以用固定种子完成无战术牌基础局，网页可玩界面将在 R3 接入；提前占旗与战术牌属于 R2。

## 架构原则

- 规则核心是纯 TypeScript，不依赖 React、DOM 或网络。
- UI 只展示状态投影并提交命令，不重复实现规则。
- 随机行为必须可由种子复现。
- 命令与事件将作为测试、回放、AI 和联机协议的共同基础。

详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [docs/adr](./docs/adr)。

## 环境

- Node.js `>=22.13.0`
- pnpm `11.9.0`

## 开发

```bash
pnpm install
pnpm run dev
```

## 质量门禁

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

完整检查使用：

```bash
pnpm run check
```

运行一局确定性的 R1 文本对局：

```bash
pnpm run demo:r1 -- my-seed
```

端到端测试使用 `pnpm run test:e2e`，首次运行前需安装 Playwright 浏览器。

## 目录

```text
app/                    Web 页面与样式
packages/game-core/     领域状态、规则引擎、模拟器与单元测试
tests/e2e/              浏览器关键路径
docs/adr/               架构决策记录
worker/                 Sites / Cloudflare Worker 入口
```

## 当前路线

- R0：工程基线与架构决策（完成）
- R1：无界面的基础规则引擎（完成）
- R2：完整规则闭环
- R3：本地可玩 Web MVP
- R4：教学、回放与 Alpha
- R5：单人 AI
- R6：邀请制在线对战
