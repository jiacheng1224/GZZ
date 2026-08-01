# 烽垒九章 Web

《烽垒九章 · 六旌竞势》是一款以九座烽垒、三牌阵型和谋策时机为核心的双人策略网页游戏。该名称是 M16 原创化阶段的工作名称，正式商用前仍待法务确认。

项目当前并行推进 **R6 RC1 出口验证** 与 **M16 原创内容**。在线房间、权威投影棋盘和增量同步已经闭环；M16-B 已建立六旌／谋策视觉语汇、产品内内容档案和本地认知反馈导出。部署环境 50 局和真实双浏览器弱网验收完成前，R6 仍保持 RC 状态。

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
packages/game-content/  原创品牌、术语、牌名与主题注册表
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
- R5：单人 AI 与体验打磨（M13-A–M13-C 完成）
- R6：邀请制在线对战（M14–M15 功能闭环，RC1 加固完成；真实部署 50 局与弱网出口验证待进行）
- 持续：M16 原创内容（M16-B 视觉语汇与认知研究工具完成；实际玩家样本、正式资产与法务确认待进行）
