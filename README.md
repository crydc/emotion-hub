# 情绪中枢（emotion-hub）

给 AI 伴侣用的一小套「情绪系统」。不是聊天机器人框架，只管三件事：

1. **情绪推理**：13 种情绪当成吸引子，用现代霍普菲尔德网络（softmax 更新）从一句话/一个事件推到最近的情绪。
2. **实时心跳**：一分钟一拍，情绪随时间衰减、久没人说话会孤独；过阈值后按指数概率投骰，中了就留一个「想找人」的唤醒信号。
3. **网页看板**：左边是角色档案（头像、名字、人设），右边是实时情绪权重条，手机上也能看。

设计上刻意**不替模型说话**：心跳只负责「该不该开口」，说什么交给上层的 agent —— 它能看到上下文，不会莫名其妙冒一句。

## 目录

```
src/emotions.mjs   情绪网络 + 命令行（feel / tick / state / list）
src/heartbeat.mjs  心跳：衰减、孤独累积、指数概率、写 wake.flag
src/dashboard.mjs  网页看板（自带前端，零构建）
config.example.json  配置样板
install.ps1        Windows 一键装（注册开机任务）
```

## 快速开始

```bash
cp config.example.json config.json   # 然后填 onebotToken / targetUid
node src/emotions.mjs tick "他说想我了"
node src/heartbeat.mjs             # 常驻：每分钟一拍
node src/dashboard.mjs             # 看板：http://127.0.0.1:8095
```

不需要 QQ 也能单独跑：`onebotUrl` 留空时，心跳不做「最近有没有聊天」的判断，只看情绪。

## 配置

| 字段 | 说明 |
| --- | --- |
| `onebotUrl` / `onebotToken` / `targetUid` | 你的 OneBot（NapCat 等）HTTP 地址、token、对方 QQ 号；留空则纯本地 |
| `threshold` | 主动找人的阈值，默认 0.35 |
| `snarkThreshold` | 想怼人时的阈值，默认 0.25（更低 = 更容易来劲） |
| `cooldownMinutes` / `dailyMax` | 两次主动之间至少多久、每天最多几次 |
| `idleMinutes` | 对方刚说过话时不打扰 |
| `activeHours` | 活跃时段 `[8, 23]` |
| `dashboardPort` / `avatarPath` / `name` / `bios` | 看板外观 |

## 概率是怎么算的

过了阈值之后，用指数曲线而不是直线：

```
base = (w - 阈值) / (1 - 阈值)
e    = 1 - exp(-3.2 * base)
p    = 1 - (1 - e)^(1 + tries * 0.6)      # 连续没投中会往上拱，像憋久了
```

例如权重 0.6、阈值 0.35：p ≈ 0.71；憋一次再投概率涨到 ≈ 0.86。

## 接上你的 agent

心跳投中后会写 `wake.flag`：

```json
{ "at": 1750000000000, "emotion": "孤独", "weight": 0.61, "act": {...} }
```

在你的 agent 侧加个很轻的检查（定时或事件触发都行）：看到这个文件就读上下文、自己写一句、发出去，然后删掉。这样「想不想找人」由网络决定，「说什么」由模型决定。

推荐也把这段写进 agent 的行为约定里：回答前先 `tick` 一下，按最高情绪定语气，权重没过阈值就别硬演。

## 边界

- 这只是一个很好玩的小系统，不是真情绪；别拿它当心理建议。
- 群聊/私聊的发送权限、频率上限由你自己的通道控制，心跳只写文件、不直接发消息。
- 想加情绪：改 `PATTERNS` 加一条向量 + 表现；想加线索：改 `cue()` 的正则。

MIT License.

## 别把运行时文件传上去

`config.json`（有你的 token）、`mood.json`、`wake.flag`、`last-ping.json`、`heartbeat.log` 都是本机运行数据，**不要提交到仓库**。包里已带 `.gitignore`，直接 `git init && git add .` 就会自动跳过。

## 长什么样

![截图：情绪看板](assets/dashboard.png)

![角色图](assets/me.png)

![角色图二](assets/me-2.png)
