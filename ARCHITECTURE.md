# 古战阵 Web 架构

## 目标

项目采用“规则核心与交付界面分离”的结构。规则结果必须能在没有 React、DOM、网络、动画和本地存储的环境中被复现与测试。

## 依赖方向

```text
app / UI → application adapter → game-core ← ruleset
                                  ↑
                           replay / AI / server
```

领域层不允许反向依赖任何交付层。

## 当前目录

```text
app/                    Web 页面与样式
packages/game-core/     领域状态、命令/事件、判定、模拟与不变量
tests/e2e/              浏览器关键路径
docs/adr/               架构决策记录
worker/                 Sites / Cloudflare Worker 入口
```

## 核心约束

1. UI 只渲染状态投影并派生命令，不自行计算合法动作或胜负。
2. 所有随机行为必须经过可注入的 seeded RNG。
3. 领域更新使用 `applyCommand(state, command)` 纯函数，输入状态不被修改。
4. 动画消费领域事件，但不能修改领域状态。
5. 同一状态信息不得在多个模块中重复保存。
6. 玩家视图必须经过投影，不能泄露对手手牌或牌堆顺序。

## 完成标准

R1 完成时，固定种子与命令序列必须可复现，阵型 fixture 全部通过，且至少 1,000 局基础对局不得破坏不变量或死锁。
