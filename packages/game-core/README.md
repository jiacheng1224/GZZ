# `@guzhanzhen/game-core`

纯 TypeScript 的确定性规则核心，不依赖 React、DOM、存储或网络。

## 已实现接口

- `createBasicGame(seed, firstPlayer)`：洗牌并发出双方各 7 张起手牌。
- `createGuidedGame(seed, firstPlayer)`：创建合法、可复现的首面旗帜教学局面。
- `createReplayArchive(initialState, commands)`：生成带最终状态指纹的版本化回放档案。
- `replayTo(archive, commandCount)`：重演到任意命令节点，不修改档案内容。
- `exportReplay()` / `importReplay()`：序列化、校验并拒绝被篡改的回放。
- `chooseAiCommand(playerView, options)`：只基于脱敏玩家视图选择确定性合法 AI 命令，支持 `easy` 与 `standard` 难度。
- `getLegalCommands(state, player)`：返回该玩家当前可以提交的具体命令。
- `applyCommand(state, command)`：返回新状态；不会修改输入状态。
- `validateCommand(state, command)`：以稳定 `RuleErrorCode` 返回非法原因。
- `evaluateFormation(cards)`：判定三牌或四牌阵型。
- `simulateBasicGame(seed)`：运行一局无战术牌随机合法对局。
- `formatBattleReport(state)`：将事件日志输出为文本战报。
- `buildPublicKnowledge(state)`：只根据桌面和弃牌区构建公开可用牌集合。
- `evaluateClaim(state, player, flagId)`：执行正常／提前占旗证明并返回反例 `witness`。
- `createStandardGame(seed, firstPlayer)`：建立包含独立战术牌堆的标准对局。
- `listTactics()`：读取 10 张战术牌的数据驱动注册表。
- `evaluateFormation(cards, options)`：解析部队牌与士气万能牌，并支持迷雾比较。
- `PendingEffect`：驱动侦察、重新部署、逃兵与叛徒的多步骤选择，并限制每一步的合法命令。
- `projectForPlayer(state, player)`：只暴露查看者手牌、公开状态和其合法命令。
- `projectForSpectator(state)`：隐藏双方手牌、牌堆顺序和私密事件内容。
- `projectForReplay(state, access)`：按公开、玩家或全知权限生成回放快照。
- `buildGameSummary(state)`：从结束状态生成冻结且可序列化的胜利摘要。
- `buildGameReview(state)`：从事件流生成双方统计、首旗、制胜旗、领先易手和逆转摘要。
- `createCommandEnvelope()` / `decodeCommandEnvelope()`：创建并校验 M14 版本化客户端意图。
- `processProtocolCommand()`：以房间、身份、序号、幂等键和预期状态版本执行权威命令。
- `createReconnectSnapshot()`：生成只包含指定玩家投影的最新重连快照。
- `createAuthoritativeRoom()` / `joinAuthoritativeRoom()`：创建邀请房间并绑定双人席位凭据摘要。
- `setRoomReady()` / `submitRoomCommand()`：启动权威对局并通过 M14 处理已认证命令。
- `disconnectRoomPlayer()` / `reconnectRoomPlayer()`：管理短时断线保留与玩家专属恢复快照。
- `voteRoomRematch()` / `expireAuthoritativeRoom()`：处理双方再战和确定性房间过期。
- `projectPublicRoom()`：生成不含凭据、完整状态或隐藏牌的公开房间视图。
- `simulateStandardGame(seed)`：使用全部规则运行可复现的合法动作自动对局。

所有随机来源均由字符串种子派生。事件序号同时用于回放顺序和同级同点阵型的完成先后比较。

## R1 不变量

- 60 张部队牌在牌堆、手牌、战线和弃牌区之间守恒且不重复。
- 每侧不超过战线容量；已占领战线不再接受部署。
- 只有当前玩家可在匹配阶段提交命令。
- 对局结束状态必须包含胜者，进行中状态不得提前包含胜者。
- 牌堆与合法部署均耗尽时，显式跳过相应阶段，不产生伪造事件。

## 当前状态与非目标

R2 规则闭环、R3 Web 对局、R4 教学回放与 R5 单人体验均已完成。R6 已完成 M14 协议、M15-A 房间状态机、M15-B1 持久化 API 与 M15-B2 在线客户端；当前等待部署联调和弱网出口验证。
