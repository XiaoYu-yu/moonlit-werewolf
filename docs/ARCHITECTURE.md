# 架构说明

## 一、技术栈

| 层       | 技术                                                            |
| -------- | --------------------------------------------------------------- |
| 前端     | Next.js 16 App Router、React 19、Tailwind CSS、Radix UI、Motion |
| 后端     | NestJS、REST、Socket.IO                                         |
| 规则引擎 | 自定义确定性事件驱动 `packages/game-core`                       |
| AI 网关  | OpenAI-compatible 适配器，支持 DeepSeek/Kimi                    |
| 队列     | BullMQ + Redis                                                  |
| 数据库   | PostgreSQL + Prisma                                             |
| 对象存储 | S3/MinIO                                                        |
| 部署     | Docker Compose + Caddy                                          |

## 二、工作区结构

```text
apps/
  web/          Next.js + React 客户端
  api/          NestJS REST + Socket.IO 权威服务
  worker/       BullMQ AI、转写和事件持久化 Worker
packages/
  contracts/    前后端共享公共/私有类型
  game-core/    确定性规则引擎
  ai-gateway/   多供应商适配、结构化动作与费用保护
  database/     Prisma schema 与数据库边界
scripts/        Windows 启动器、密钥保护、smoke 脚本
e2e/            Playwright 端到端测试
docs/           使用、部署、架构、FAQ、贡献和安全文档
imgs_ui/        已确认的 UI 原型与实现参考
```

## 三、核心设计

### 服务端权威状态

所有房间状态、身份、行动、结算都由 API 进程权威计算。浏览器只展示服务端下发的
公共快照和当前玩家私有状态，不能自行推断隐藏信息。

### 确定性规则引擎

`packages/game-core` 使用事件驱动方式推进阶段：

```text
room.created → lobby → role_reveal → night → dawn
→ discussion → voting → resolution → last_words
→ hunter_shot → results → next night
```

规则包含：

- 6/9/12 人固定角色预设。
- 狼人、预言家、女巫、猎人、守卫完整核心规则。
- 女巫首夜可自救，且不能同一夜同时使用两瓶药。
- 守卫不能连续两夜守护同一玩家。
- 毒药与守卫保护叠加仍致死。
- 被毒猎人不能开枪。
- 第二轮平票不产生放逐。
- 阵营侧全灭判定胜负。

### AI 网关

Kimi/DeepSeek 调用使用结构化输出，只接受受控 action 字段。返回结果必须先通过
角色校验和规则引擎校验，成功才会执行；否则使用确定性合法兜底。

AI 只接收有界的公开讨论历史和自身私有 `memorySummary`，不会获得其他 AI 的记忆。

### 隐私与安全

- 隐藏身份、夜间行动只通过 `player.private_state` 下发。
- AI 观战房主的全知状态只通过独立 `observer.private_state` 下发。
- 系统不请求、不存储、不展示隐藏思维链或原始 provider trace。
- Provider 密钥使用版本化 AES-256-GCM 加密，API 只返回掩码。
- 生产环境要求强 `ADMIN_API_KEY` 和 `APP_ENCRYPTION_KEY`。

## 四、HTTP 接口

前缀为 `/api/v1`：

| 方法     | 路径                     | 说明               |
| -------- | ------------------------ | ------------------ |
| POST     | `/rooms`                 | 创建房间           |
| POST     | `/rooms/ai-observer`     | 创建 AI 观战局     |
| POST     | `/rooms/:code/join`      | 加入房间           |
| GET      | `/rooms/:code/observer`  | 获取观战局初始状态 |
| PUT      | `/rooms/:id/ai-seats`    | 调整 AI 席位       |
| POST     | `/rooms/:id/start`       | 开始游戏           |
| POST     | `/audio/transcriptions`  | 语音转写           |
| GET/POST | `/admin/providers`       | 模型供应商管理     |
| PATCH    | `/admin/providers/:slug` | 更新供应商配置     |
| GET/POST | `/admin/invites`         | 邀请码管理         |
| GET      | `/admin/usage`           | 使用与费用统计     |
| GET      | `/health`                | 健康检查           |

## 五、Socket.IO 事件

命名空间：`/game`

客户端事件：

```text
room.join
seat.ready
chat.send
game.action.submit
host.control
presence.heartbeat
```

服务端事件：

```text
room.snapshot
player.private_state
observer.private_state
game.event
phase.timer
ai.status
error
```

## 六、AI 观战局

- 房主是观察者，不占 6/9/12 席位。
- 所有席位由 AI 填充，对局自动推进。
- 阶段节拍会根据角色、夜间、投票和公开发言自适应。
- 观察者可以查看每个 AI 的公开讨论历史和受限“AI 思路频道”。
- 暂停/恢复不会重复请求模型，也不会重复计费。

## 七、测试策略

| 类型          | 位置                       | 覆盖                                  |
| ------------- | -------------------------- | ------------------------------------- |
| 单元/集成测试 | 各包 `src/*.test.ts`       | 规则、网关、数据库、API、Worker、Web  |
| 浏览器 E2E    | `e2e/`                     | 建房入房、AI 观战、隐私、响应式、视觉 |
| Smoke 脚本    | `scripts/*.ts`             | 真实 DeepSeek/Kimi 调用               |
| CI            | `.github/workflows/ci.yml` | 格式、类型、测试、构建、审计、镜像    |
