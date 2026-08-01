# 古战阵 Web

以九条战线、三牌阵型和兵法时机为核心的双人策略网页游戏。

项目已优先进入 **R5/M13-A：简单 AI 单人模式**。当前页面支持玄甲玩家对阵朱羽简单 AI；AI 只接收脱敏 `PlayerView`，使用确定性合法动作与轻量阵型成型启发，并自动完成自己的全部回合阶段。

## 架构原则

- 规则核心是纯 TypeScript，不依赖 React、DOM 或网络。
- UI 只展示状态投影并提交命令，不重复实现规则。
- 随机行为必须可由种子复现。
- 命令与事件将作为测试、回放、AI 和联机协议的共同基础。

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)、[17 模块说明](./docs/MODULES.md) 与 [docs/adr](./docs/adr)。

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

运行 R2 的 5,000 局完整规则出口验证：

```bash
pnpm run verify:r2
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
- R2：完整规则闭环（完成）
- R3：本地可玩 Web MVP（完成）
- R4：教学、回放与 Alpha（M11–M12 技术实现完成，Alpha 验证待开始）
- R5：单人 AI（M13-A 简单 AI 完成，标准 AI 待开发）
- R6：邀请制在线对战
