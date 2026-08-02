# 月夜狼人杀

一个面向简体中文玩家的真人 + AI 狼人杀 Web 项目。真人可通过房间码加入，空位由
DeepSeek 或 Kimi 补齐；也可以创建全 AI 对局，让观察者在席位之外查看 AI 自动完成
发言、技能和投票。

当前仓库是可安装、可构建的集成候选。规则引擎、七个响应式页面、REST/Socket.IO
边界、AI 适配器、Worker 队列、Redis 分布式费用保险丝和数据库模型都已落地。房间与
计时权威状态目前仍是单 API 进程内存实现，Worker 也尚未动态加载管理后台的 Prisma
供应商记录；因此它适合作为单实例集成候选，不能在未完成外部基础设施验收前直接宣称
为多实例生产版。

## 获取代码与使用

- 仓库地址：https://github.com/XiaoYu-yu/moonlit-werewolf
- Git 克隆：
  ```bash
  git clone https://github.com/XiaoYu-yu/moonlit-werewolf.git
  cd moonlit-werewolf
  ```
- 不装 Git 也可以下载 ZIP：打开仓库页面，点击绿色 `Code` 按钮，选择 `Download ZIP`，
  解压后进入 `moonlit-werewolf` 文件夹。

运行需要 Node.js 24+ 和 pnpm 11.9+。Windows 用户可以双击根目录的
`一键启动狼人杀.cmd` 自动安装依赖并启动，首次运行后访问 `http://localhost:3000`，
开发邀请码为 `MOONLIT-DEV`。详细启动步骤见下方“本地快速启动”；需要真实 AI 时，按
“配置AI模型”说明粘贴 DeepSeek/Kimi 密钥，不配置也能通过规则兜底试玩。

## 已实现范围

- 6/9/12 人固定角色预设，以及狼人、预言家、女巫、猎人、守卫完整核心规则。
- 服务端权威状态、幂等动作、超时合法兜底、两轮平票和阵营胜负判定。
- 首页、房间大厅、身份揭示、白天讨论、夜间操作、结算和模型管理七个页面。
- 桌面与手机独立响应式布局，Motion/CSS 可中断动效，自适应高/中/低性能档。
- REST 建房/入房、HttpOnly 玩家会话、Socket.IO 房间快照与玩家私有状态。
- Kimi/DeepSeek 真实结构化调用、超时重试、跨供应商备用和确定性合法兜底。
- 全 AI 观察者房间：观察者不占席位，对局自动推进，并使用独立认证的全知私密状态。
- 全 AI 房间按身份、夜间、发言和投票采用不同节拍；当前席位会显示真实调用状态，模型
  返回的简短最终判断摘要进入观察者私密“AI 思路频道”。系统不请求或展示隐藏思维链；
  无密钥、超时或非法输出会明确标为“规则兜底/非模型输出”。
- 真人与 AI 公开发言写入有界历史；AI 仅携带自己的短期摘要，重连可恢复聊天。
- BullMQ AI、转写和事件持久化任务边界；供应商失败时确定性合法动作兜底。
- Redis Lua 原子预留每日/单局预算；超时按保守成本结算，任务重放不重复调用供应商。
- 管理端只展示 Kimi/DeepSeek 的服务端真实配置、状态、调用、延迟、错误和费用估算，不
  填充演示统计；供应商密钥使用版本化 AES-256-GCM 加密，API 只返回掩码并支持旧密钥
  轮换。费用估算不冒充供应商账单：未配置 token 单价时会明确使用保守预算值。
- PostgreSQL/Prisma 数据模型、Redis/MinIO/Caddy Compose 部署基线。
- 可选短音效、能力检测触感、降低动态效果和浏览器本地偏好。

首版不包含账号、战绩、好友、支付、警长、向公众开放的观战、完整回放和 AI 语音播报。

## 工程结构

```text
apps/
  web/          Next.js + React 客户端
  api/          NestJS REST + Socket.IO 权威服务
  worker/       BullMQ AI、转写和异步事件 Worker
packages/
  contracts/    前后端共享公共/私有类型
  game-core/    确定性规则引擎
  ai-gateway/   多供应商适配、结构化动作与费用保护
  database/     Prisma schema 与数据库边界
imgs_ui/        已确认的 14 张桌面/手机 UI 原型
```

## 本地快速启动

需要 Node.js 24+ 和 pnpm 11.9。首次安装：

```powershell
corepack enable
pnpm install
pnpm build:packages
pnpm --filter @werewolf/database db:generate
```

### Windows 双击启动

不安装 PostgreSQL/Redis 也可以直接试玩。在资源管理器中双击项目根目录的
`一键启动狼人杀.cmd`，脚本会自动：

1. 检查 Node.js、pnpm 和项目依赖，首次运行时自动安装缺失依赖。
2. 按需构建共享包，并以开发模式启动内存 API 与 Web。
3. 等待两个服务健康后自动打开 `http://localhost:3000`。
4. 再次双击时复用已有服务，不会重复占用端口。

创建房间的邀请码为 `MOONLIT-DEV`。结束后双击 `停止狼人杀.cmd`；后台输出保存在
`.runtime/logs/`，该目录不会提交到版本库。

要在这个双击版本中使用真实模型，先双击 `配置AI模型.cmd`，在隐藏输入框中粘贴 Kimi
和/或 DeepSeek 密钥，再双击 `一键启动狼人杀.cmd`。密钥只以当前 Windows 用户可解密
的 DPAPI 密文保存在忽略提交的 `.runtime/provider-secrets.json` 中；API 子进程启动后，
Web 子进程不会继承密钥。更换配置后再次双击启动器会安全重启服务。双击
`清除AI密钥.cmd` 会删除密文并停止仍可能持有解密值的本地服务。

快捷入口刻意不启动 Redis/Worker。配置密钥时，API 直接使用同一套结构化模型网关完成
真实调用；没有密钥或供应商失败时使用确定性合法兜底，因此模型故障不会卡死对局。
模型管理页在本地开发环境使用管理密钥 `dev-admin-key` 读取真实运行数据。创建“AI
观战局”后，只有该房主的私密频道会收到模型显式返回的最终判断摘要；普通玩家房间和
公共 Socket 事件不会收到这些文字。

### 手动启动

打开第一个 PowerShell：

```powershell
$env:NODE_ENV = "development"
$env:DEV_INVITE_CODE = "MOONLIT-DEV"
$env:CORS_ORIGINS = "http://localhost:3000"
$env:API_PORT = "3001"
pnpm --filter @werewolf/api build
pnpm --filter @werewolf/api start
```

再打开第二个 PowerShell：

```powershell
pnpm --filter @werewolf/web dev
```

访问 `http://localhost:3000`，使用邀请码 `MOONLIT-DEV` 创建房间。本地默认 API 为
`http://localhost:3001/api/v1`；只有网络连接失败时，页面才会明确提供“本地演示模式”，
业务校验错误不会被伪装成演示成功。

Worker 需要 Redis：

```powershell
$env:REDIS_URL = "redis://localhost:6379"
pnpm --filter @werewolf/worker dev
```

## 环境配置

复制 `.env.example` 为 `.env` 仅用于 Docker Compose。公开部署前必须替换所有
`replace-with-*` 和开发值。`POSTGRES_PASSWORD` 与 `DATABASE_URL` 中的密码必须保持
一致；若密码包含 `@`、`:`、`/` 等字符，连接地址中的密码部分需要进行 URL 编码。

关键变量：

| 变量                                                         | 用途                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `SITE_ADDRESS` / `ACME_EMAIL`                                | Caddy 域名与 HTTPS 证书邮箱                        |
| `POSTGRES_PASSWORD` / `DATABASE_URL` / `REDIS_URL`           | PostgreSQL 凭据、连接地址与 Redis                  |
| `APP_ENCRYPTION_KEY` / `ADMIN_API_KEY`                       | Provider AES-256-GCM 加密密钥和管理接口密钥        |
| `APP_ENCRYPTION_KEY_PREVIOUS`                                | 密钥轮换期间可读取的逗号分隔旧密钥                 |
| `TRUST_PROXY`                                                | Caddy 到 API 的可信代理跳数；Compose 默认一跳      |
| `DEV_INVITE_CODE`                                            | 仅开发环境创建房间的固定邀请码                     |
| `NEXT_PUBLIC_API_URL`                                        | 浏览器 API 基址，可写域名、`/api` 或完整 `/api/v1` |
| `NEXT_PUBLIC_SOCKET_URL`                                     | Socket.IO 服务基址                                 |
| `KIMI_API_KEY` / `DEEPSEEK_API_KEY`                          | 两个可玩供应商密钥，绝不能加 `NEXT_PUBLIC_`        |
| `KIMI_MODEL` / `DEEPSEEK_MODEL`                              | 各供应商当前使用的服务端模型 ID                    |
| `DASHSCOPE_ASR_MODEL`                                        | 启用服务端转写时使用的 DashScope ASR 模型          |
| `AI_DAILY_BUDGET_CENTS` / `AI_MATCH_BUDGET_CENTS`            | 以分为单位的每日与单局预算                         |
| `AI_MIN_RESERVATION_CENTS`                                   | 未知价格请求的非零最低预留                         |
| `AI_PRICE_*_{INPUT,OUTPUT}_CENTS_PER_MILLION`                | 各供应商每百万 token 的站点价格                    |
| `AI_PROCESS_BUDGET_CENTS`                                    | 可选的 Worker 进程生命周期紧急上限；留空即关闭     |
| `AI_QUEUE_CONNECT_TIMEOUT_MS` / `AI_QUEUE_RESULT_TIMEOUT_MS` | Redis 入队和完整 AI 重试链的等待上限               |
| `AI_OBSERVER_{ROLE,NIGHT,VOTE,SPEECH}_DELAY_MS`              | 全 AI 观战局各阶段的最短决策节拍                   |
| `AI_OBSERVER_SUMMARY_READ_MS`                                | 摘要返回后、权威动作执行前的最短阅读时间           |
| `AI_TAKEOVER_PROVIDER_ID` / `AI_TAKEOVER_MODEL_ID`           | 掉线接管座位未指定模型时的默认供应商与模型         |
| `*_WORKER_CONCURRENCY`                                       | AI、转写和持久化队列的独立并发上限                 |
| `ROOM_CREATE_RATE_LIMIT`                                     | 单客户端每分钟建房上限                             |

不要把真实密钥提交到仓库、客户端 bundle、截图或上下文日志。

PowerShell 可生成符合要求的 Provider 加密密钥：

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
"base64:$([Convert]::ToBase64String($bytes))"
```

把输出写入部署主机的 `APP_ENCRYPTION_KEY`。轮换时将旧值暂放
`APP_ENCRYPTION_KEY_PREVIOUS`，待记录重新加密后移除。

AI 费用先在 Redis 中以北京时间日桶和 `matchId` 原子预留，再按供应商返回的累计费用
结算。所有金额内部以千分之一分的整数保存，未知价格和超时不会按零费用释放。
`AI_PROCESS_BUDGET_CENTS` 不是每日预算：它只在显式配置时启用，并在 Worker 重启后
重新计数；日/局上限始终由 Redis 账本负责。

API 的 AI 结果等待上限会覆盖“单次供应商超时 × 每供应商尝试次数 × 主/备用供应商数”
并额外保留 5 秒队列调度余量。生产环境若显式配置了更短的
`AI_QUEUE_RESULT_TIMEOUT_MS` 会在监听端口前失败，避免 API 已采用兜底动作而 Worker
仍在后台继续消耗模型预算。队列严重拥塞、跨进程取消和真实 Redis 延迟仍需在部署环境
压测。

全 AI 观战局采用分阶段节拍：身份确认默认 650ms，夜间决策 5s，投票 4.5s，公开发言
12s；模型返回摘要后还会保留至少 2.5s 阅读时间。真实供应商响应耗时会计入这段节拍，
不会在响应完成后重复等待全部时间。暂停会冻结已返回的结果和剩余阅读时间，恢复时沿用
同一回合，不会再次请求或计费。这些设置只影响全 AI 观战局，不会给普通真人房间增加
等待。

## HTTP 与实时事件

HTTP 前缀为 `/api/v1`：

- `POST /rooms`
- `POST /rooms/ai-observer`
- `POST /rooms/:code/join`
- `GET /rooms/:code/observer`
- `PUT /rooms/:id/ai-seats`
- `POST /rooms/:id/start`
- `POST /audio/transcriptions`
- `GET|POST /admin/providers`
- `PATCH /admin/providers/:slug`
- `GET|POST /admin/invites`
- `GET /admin/usage`
- `GET /health`

Socket.IO namespace 为 `/game`。客户端事件包括 `room.join`、`seat.ready`、
`chat.send`、`game.action.submit`、`host.control` 和 `presence.heartbeat`；服务端事件
包括 `room.snapshot`、`player.private_state`、`game.event`、`phase.timer`、
`ai.status` 和 `error`。只有 AI 观察者房主会收到 `observer.private_state`。

任何身份、夜间合法目标和阵营私有信息都必须从 `player.private_state` 获取，不能从
公共房间快照推断。`observer.private_state` 仅用于明确创建的全 AI 房间，不能替代普通
真人房间的玩家私有状态。它的 `activeDecision` 和有界 `aiThoughtHistory` 是观察者
频道的权威来源；房间级 `ai.status` 只广播席位、阶段、状态和时间等元数据，绝不携带
摘要正文、提示词、模型原始响应或隐藏推理。

## 验证

```powershell
pnpm format:check
pnpm typecheck
pnpm test
$env:DATABASE_URL = "postgresql://werewolf:werewolf@localhost:5432/werewolf?schema=public"
pnpm --filter @werewolf/database db:validate
pnpm build
pnpm audit --prod --audit-level moderate --registry=https://registry.npmjs.org/
pnpm test:e2e
```

2026-07-18 的根级验收基线为：单元/集成测试共 213 项通过、Playwright 11/11 通过、
Prisma 初始迁移与当前 schema 生成 SQL 完全一致、中等级别生产依赖审计无已知漏洞。
首页初始脚本实测 241,550 B gzip，首屏夜村资源 150,910 B；两项都低于计划预算。

使用临时环境变量验证 DeepSeek 结构化动作，不要把密钥写进命令历史：

```powershell
$secure = Read-Host -AsSecureString "DeepSeek API key"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:DEEPSEEK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  pnpm smoke:deepseek
} finally {
  Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
```

Playwright 在桌面与手机视口验收实时建房/入房、Socket 同步、本地完整阶段流、断网演示
降级、布局溢出、视觉基线、控制台错误和关键资源加载。真实权威流程还会从 UI 创建
6 人房、补齐 5 个 AI，验证身份隔离、粗粒度夜晚、合法夜间动作、天亮、真人/AI 公开
发言和首轮投票；还会验收桌面与手机全 AI 观战、观察者身份边界、自动行动、真实模型
管理空状态以及服务端只返回 Kimi/DeepSeek。决策频道专项测试会经过真实
OpenAI-compatible HTTP 适配路径，验证模型摘要、阶段节拍、暂停恢复、无效响应兜底及
公共事件零泄漏；测试使用本地可控供应商服务，不消耗真实密钥。测试启动命令会先构建
API 的完整工作区依赖闭包，因而不依赖残留的 `dist/`。GitHub CI 会重复运行格式、类型、
单测、Prisma、构建、生产依赖审计、Playwright，并构建 API、迁移、Worker 与 Web 镜像。

## Docker Compose

在装有 Docker 的 Linux/VPS 上：

```bash
cp .env.example .env
# 编辑 .env，替换域名、数据库、对象存储、管理和模型密钥
docker compose config
docker compose up --build -d
curl -fsS "https://YOUR_DOMAIN/api/v1/health"
```

MinIO 控制台默认不发布到主机端口。如需管理，请通过受控内网或 SSH 隧道访问，不要把
默认凭据和 9001 端口暴露到公网。

当前 Windows 开发机没有 Docker CLI，因此容器镜像必须在 Linux 主机或 CI 上再次
实际构建、启动并执行迁移/健康检查后，才能视为完成生产部署。

## 当前生产边界

- 房间、玩家会话、邀请码、阶段计时和动作幂等集合仍驻留在单个 API 进程内存中；进程
  重启不能恢复进行中的房间，多 API 实例需要 Redis 适配器、锁和持久化房间仓库。
- 管理 API 可以加密保存供应商记录；不启用 Redis 的本地 API 直连路径会立即使用这些
  配置并记录真实调用、延迟、错误和费用。启用 Redis/BullMQ 后，Worker 当前仍从部署
  环境变量加载模型，因此后台配置变更需同步环境并重启 Worker，尚未支持动态热加载。
- 语音转写当前由 API 直接调用适配器；转写 Worker、S3 临时音频和事件持久化队列已有
  契约与处理边界，但尚未接成有对象存储和数据库落点的完整异步链路。
- AI 结果等待上限覆盖配置中的正常重试链；如果真实 Redis 队列拥塞超过额外 5 秒余量，
  API 仍可能先采用确定性兜底，而已激活任务缺少跨进程取消协议。
- 当前健康接口适合作为进程存活检查，不替代 PostgreSQL、Redis、对象存储和供应商的
  完整 readiness 监控。
- 本机无法证明真实 Redis Lua、PostgreSQL 迁移、Docker/Linux 镜像运行、100 房压力、
  目标手机 LCP/INP/60fps/120Hz 和 30 分钟内存稳定性；这些是上线前验收项。

## 性能约束

- 动效优先使用 `transform` 和 `opacity`，复杂交互使用可中断弹簧。
- 根据降低动态效果、设备能力和运行时帧率选择高/中/低效果档。
- 页面后台、离屏或阶段结束时暂停环境动画；粒子集中在单一 Canvas。
- 场景使用响应式 AVIF/WebP，非当前阶段资源延迟加载。
- 目标预算：LCP ≤ 2.5 秒、INP ≤ 200ms、CLS ≤ 0.1、首屏 JS ≤ 350KB gzip。

这些数值是发布门槛，不是仅凭构建成功即可成立的声明；需要在目标手机和生产网络上
用浏览器性能追踪再次测量。
