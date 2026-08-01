# M15-A 权威房间状态机

版本：`1.7.0-r6.m15a`

核心版本：`1.4.0-r6.m15.room`

## 本增量目标

在 M14 协议之上建立与网络框架无关的纯 TypeScript 房间领域层，完成邀请制双人对战所需的生命周期、身份边界和恢复语义。M15-A 不建立真实 WebSocket 连接；后续适配器只负责生成安全令牌摘要、收发消息、持久化和定时调用。

## 生命周期

`waiting → ready → playing → finished → playing（再战）`

房间空闲超时或任一断线席位超过保留窗口后进入 `expired`，并立即释放完整权威状态。

- 创建：房主固定绑定 `player-one`，返回等待房间；
- 加入：第二个不同凭据摘要绑定 `player-two`；
- 准备：双方在线且均准备后创建 M14 `ProtocolAuthority`；
- 对局：命令先通过房间凭据校验，再由 M14 校验身份、序号、幂等键和状态版本；
- 完成：规则状态进入 `finished` 时房间同步结束并记录指标；
- 再战：双方各投一票后创建新种子代次，并轮换先手。

## 安全边界

- 核心只保存由外部安全适配器生成的 `credentialDigest`，不接收明文登录令牌；
- `projectPublicRoom()` 明确剔除凭据摘要和 `ProtocolAuthority`；
- 重连只返回对应席位的 `ProtocolSnapshot`，不暴露对手手牌、牌堆顺序或种子；
- 身份校验失败发生在 M14 之前，不返回玩家快照；
- 客户端永远不能提交完整状态，权威状态只由规则命令推进。

## 公开接口

- `createAuthoritativeRoom()` / `joinAuthoritativeRoom()`；
- `setRoomReady()` / `heartbeatRoomPlayer()`；
- `disconnectRoomPlayer()` / `reconnectRoomPlayer()`；
- `submitRoomCommand()`；
- `voteRoomRematch()`；
- `expireAuthoritativeRoom()`；
- `projectPublicRoom()`。

所有时间点均由调用者显式注入，使心跳、超时与恢复测试可重复。状态转换返回新对象，不修改输入房间。

## 最小监控指标

每个房间维护已接受、重复、拒绝命令数，断线与重连次数，以及已开始、已完成局数。这些数据不包含卡牌或凭据，可由后续服务适配器汇总。

## 自动化验收

- 创建、加入、双方准备后仅启动一次权威对局；
- 冒用另一席位的摘要在协议处理前被拒绝；
- 公开视图不包含摘要、完整状态或隐藏牌；
- 保留窗口内断线可恢复到最新状态版本；窗口外房间过期并释放权威状态；
- 连续 50 局标准 AI 权威对局全部完成，期间周期性断线重连且快照版本一致；
- 每局结束可经双方投票进入第二代对局，并轮换先手。

## M15-B 后续

实现部署环境的安全随机令牌与摘要、房间存储仓库、WebSocket／Durable Object 传输适配器、心跳调度、结构化日志和在线大厅 UI；复用本状态机，不在网络层复制规则。
