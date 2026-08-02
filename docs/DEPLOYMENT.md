# 生产部署

本仓库已经提供 Docker Compose + Caddy + PostgreSQL + Redis + MinIO 的生产部署基线。
公网部署需要一台 Linux VPS/云服务器，并至少开放 80/443 端口。

## 一、部署架构

```text
浏览器
  │ HTTPS
  ▼
Caddy（反向代理 + 自动 HTTPS）
  │
  ├── /api  → API 容器（NestJS + Socket.IO）
  └── /     → Web 容器（Next.js）
                 │
                 ├── PostgreSQL（房间数据、模型配置）
                 ├── Redis（预算、队列、计时）
                 └── MinIO（临时音频对象存储）
```

## 二、前置条件

| 依赖           | 版本/说明               |
| -------------- | ----------------------- |
| Linux 服务器   | 建议 2C4G 起步          |
| Docker         | 24+                     |
| Docker Compose | v2 插件                 |
| 域名           | 可选，生产建议使用      |
| 邮件地址       | Caddy ACME 证书通知邮箱 |

## 三、快速部署

```bash
git clone https://github.com/XiaoYu-yu/moonlit-werewolf.git
cd moonlit-werewolf
cp .env.example .env
```

编辑 `.env`，至少替换以下值：

```text
SITE_ADDRESS=https://your-domain.com
ACME_EMAIL=your-email@example.com
POSTGRES_PASSWORD=your-strong-db-password
DATABASE_URL=postgresql://werewolf:your-strong-db-password@postgres:5432/werewolf?schema=public
APP_ENCRYPTION_KEY=base64:...
ADMIN_API_KEY=your-long-random-admin-key
DEEPSEEK_API_KEY=sk-...
KIMI_API_KEY=sk-...
```

生成 32 字节 Provider 加密密钥：

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
"base64:$([Convert]::ToBase64String($bytes))"
```

校验并启动：

```bash
docker compose config
docker compose up --build -d
```

等待容器健康后检查：

```bash
curl -fsS https://your-domain.com/api/v1/health
```

## 四、数据库迁移

Compose 中的 `migrate` 服务会在 API/Worker 启动前执行：

```bash
pnpm --filter @werewolf/database db:generate
pnpm --filter @werewolf/database db:validate
```

首次启动后确认迁移服务已完成：

```bash
docker compose ps
```

## 五、环境变量说明

| 变量                                                         | 用途                                 |
| ------------------------------------------------------------ | ------------------------------------ |
| `SITE_ADDRESS` / `ACME_EMAIL`                                | Caddy 域名与 HTTPS 证书邮箱          |
| `WEB_ORIGIN` / `CORS_ORIGINS`                                | 浏览器跨域来源                       |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL`             | 浏览器访问 API/Socket 的地址         |
| `API_HOST` / `API_PORT`                                      | API 监听地址和端口                   |
| `POSTGRES_PASSWORD` / `DATABASE_URL`                         | PostgreSQL 凭据与连接地址            |
| `REDIS_URL`                                                  | Redis 连接地址                       |
| `S3_*`                                                       | MinIO/S3 兼容对象存储配置            |
| `APP_ENCRYPTION_KEY`                                         | Provider 密钥 AES-256-GCM 加密主密钥 |
| `APP_ENCRYPTION_KEY_PREVIOUS`                                | 旧密钥轮换列表                       |
| `ADMIN_API_KEY`                                              | 管理后台/管理 API 密钥               |
| `TRUST_PROXY`                                                | Caddy 到 API 的可信代理跳数          |
| `DEV_INVITE_CODE`                                            | 仅开发环境建房邀请码                 |
| `DEEPSEEK_API_KEY` / `KIMI_API_KEY`                          | 两个可玩 AI 供应商密钥               |
| `DEEPSEEK_MODEL` / `KIMI_MODEL`                              | 当前模型 ID                          |
| `DASHSCOPE_API_KEY` / `DASHSCOPE_ASR_MODEL`                  | 服务端语音转写                       |
| `AI_DAILY_BUDGET_CENTS` / `AI_MATCH_BUDGET_CENTS`            | 每日/单局 AI 费用上限                |
| `AI_MIN_RESERVATION_CENTS`                                   | 未知价格请求的最小预留               |
| `AI_PRICE_*_CENTS_PER_MILLION`                               | 每百万 token 站点价格                |
| `AI_PROCESS_BUDGET_CENTS`                                    | Worker 进程生命周期紧急上限          |
| `AI_QUEUE_CONNECT_TIMEOUT_MS` / `AI_QUEUE_RESULT_TIMEOUT_MS` | AI 队列等待上限                      |
| `AI_OBSERVER_*_DELAY_MS`                                     | 全 AI 观战局各阶段节拍               |
| `AI_TAKEOVER_PROVIDER_ID` / `AI_TAKEOVER_MODEL_ID`           | AI 接管默认模型                      |
| `*_WORKER_CONCURRENCY`                                       | 各队列并发数                         |
| `ROOM_CREATE_RATE_LIMIT`                                     | 建房限流                             |
| `TRANSCRIPTION_MAX_SECONDS`                                  | 转写最大时长                         |

真实密钥绝不能提交到 Git，也不能写成 `NEXT_PUBLIC_*` 环境变量。

## 六、HTTPS 与反向代理

Compose 中的 Caddy 会自动申请和续期 Let's Encrypt 证书。只要 `.env` 中的
`SITE_ADDRESS` 是 `https://你的域名`，`ACME_EMAIL` 填写有效邮箱即可。

本地测试可以保持：

```text
SITE_ADDRESS=http://localhost
ACME_EMAIL=off
```

## 七、生产边界

当前仓库是单实例集成候选。以下能力尚未验收为多实例生产版：

- 房间、玩家会话、邀请码、阶段计时仍驻留在单个 API 进程内存中。
- Worker 当前从部署环境变量加载模型配置，管理后台变更后需要同步环境并重启 Worker。
- S3 转写与事件持久化的异步链路还没有完整接成生产落点。
- 100 并发房间、目标手机性能、Redis 队列压力和 30 分钟内存稳定性需要单独压测。

## 八、回滚

使用 Docker 镜像时，建议每次发布打标签：

```bash
docker compose build
docker compose up -d
```

如需回滚到上一个镜像，可保留旧镜像标签或使用 Git 历史中的 `compose.yaml` 重新构建。
