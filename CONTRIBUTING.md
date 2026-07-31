# 开发约定

## 开始前

1. 阅读 `ARCHITECTURE.md` 和相关 ADR。
2. 确认任务属于当前里程碑。
3. 规则变更先补规格或失败测试，再修改实现。

## 常用检查

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

完整本地门禁使用 `pnpm run check`。浏览器测试使用 `pnpm run test:e2e`，需预先安装 Playwright 浏览器。

## 代码边界

- `packages/game-core` 不得导入 React、DOM、网络、音频或动画模块。
- 规则错误使用稳定错误码，不以 UI 文案作为程序判断依据。
- 新领域对象需同步更新不变量检查器与测试 fixture。
- 改变对局结果的修改必须附带测试和规则版本说明。

## Definition of Done

- 类型、lint、单测和构建通过。
- 新能力有明确输入、输出和错误行为。
- 没有跨层读取内部状态。
- 文档与 ADR 已更新。
