# `@guzhanzhen/game-core`

纯 TypeScript 的确定性规则核心，不依赖 React、DOM、存储或网络。

## R1 输入与输出

- `createBasicGame(seed, firstPlayer)`：洗牌并发出双方各 7 张起手牌。
- `getLegalCommands(state, player)`：返回该玩家当前可以提交的具体命令。
- `applyCommand(state, command)`：返回新状态；不会修改输入状态。
- `validateCommand(state, command)`：以稳定 `RuleErrorCode` 返回非法原因。
- `evaluateFormation(cards)`：判定三牌或四牌阵型。
- `simulateBasicGame(seed)`：运行一局无战术牌随机合法对局。
- `formatBattleReport(state)`：将事件日志输出为文本战报。

所有随机来源均由字符串种子派生。事件序号同时用于回放顺序和同级同点阵型的完成先后比较。

## R1 不变量

- 60 张部队牌在牌堆、手牌、战线和弃牌区之间守恒且不重复。
- 每侧不超过战线容量；已占领战线不再接受部署。
- 只有当前玩家可在匹配阶段提交命令。
- 对局结束状态必须包含胜者，进行中状态不得提前包含胜者。
- 牌堆与合法部署均耗尽时，显式跳过相应阶段，不产生伪造事件。

## 非目标

R1 只允许部队牌，且仅在双方阵型完整时占旗。提前占旗求解、战术牌、信息投影和 Web 交互分别在 R2/R3 实现。
