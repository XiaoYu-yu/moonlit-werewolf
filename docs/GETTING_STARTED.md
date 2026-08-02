# 下载与使用

这份文档面向第一次接触月夜狼人杀的用户，覆盖从 GitHub 下载、安装依赖、启动本地服务到
配置真实 AI 的完整流程。

## 一、下载方式

### 方式 1：Git 克隆（推荐）

需要先安装 Git。打开终端执行：

```bash
git clone https://github.com/XiaoYu-yu/moonlit-werewolf.git
cd moonlit-werewolf
```

以后更新代码：

```bash
git pull
```

### 方式 2：直接下载 ZIP

不需要安装 Git：

1. 打开仓库：https://github.com/XiaoYu-yu/moonlit-werewolf
2. 点击页面右上角绿色的 `Code` 按钮。
3. 点击 `Download ZIP`。
4. 解压 ZIP，进入解压出来的 `moonlit-werewolf` 文件夹。

## 二、运行环境

| 软件    | 版本要求                      | 说明                   |
| ------- | ----------------------------- | ---------------------- |
| Node.js | 24+                           | 必须                   |
| pnpm    | 11.9+                         | 推荐使用 Corepack 安装 |
| 浏览器  | Chrome / Edge / Safari 最新版 | 必须                   |
| Git     | 任意较新版本                  | 仅 Git 克隆方式需要    |
| Docker  | 任意较新版本                  | 仅生产部署需要         |

Windows 用户可以执行：

```powershell
corepack enable
```

之后 pnpm 会自动使用 `package.json` 中声明的版本。

## 三、Windows 一键启动

下载并解压完成后，在项目根目录双击：

```text
一键启动狼人杀.cmd
```

脚本会自动完成以下工作：

1. 检查 Node.js、pnpm 和项目依赖。
2. 首次运行自动安装缺失依赖。
3. 按需构建共享包并启动内存版 API。
4. 启动 Web 服务并自动打开 `http://localhost:3000`。

创建房间时使用开发邀请码：

```text
MOONLIT-DEV
```

结束游戏后双击：

```text
停止狼人杀.cmd
```

后台日志保存在 `.runtime/logs/`，不会提交到 Git。

### 配置真实 AI 密钥

双击：

```text
配置AI模型.cmd
```

在隐藏输入框中粘贴 DeepSeek 或 Kimi 的 API Key。密钥会使用当前 Windows 用户的 DPAPI
加密保存在 `.runtime/` 中，不会写入源码。

清除密钥：

```text
清除AI密钥.cmd
```

## 四、手动启动（Windows / macOS / Linux）

安装依赖：

```bash
corepack enable
pnpm install
pnpm build:packages
pnpm --filter @werewolf/database db:generate
```

启动 API：

```bash
pnpm --filter @werewolf/api build
pnpm --filter @werewolf/api start
```

启动 Web：

```bash
pnpm --filter @werewolf/web dev
```

浏览器访问：

```text
http://localhost:3000
```

API 健康检查：

```text
http://localhost:3001/api/v1/health
```

## 五、开始游戏

1. 打开首页。
2. 输入昵称，点击创建房间。
3. 邀请码填写 `MOONLIT-DEV`。
4. 选择 6/9/12 人预设。
5. 空位可以填充 AI，选择 DeepSeek 或 Kimi。
6. 点击开始，等待身份下发。

其他人加入时，只需要在首页输入房间码和昵称即可。如果没有真实 AI 密钥，AI 会使用
服务端确定性规则兜底，不会卡住对局。

## 六、环境变量

完整环境变量表见 [部署文档](./DEPLOYMENT.md#环境变量说明)。本地试玩通常不需要手动配置，
但以下变量常用：

| 变量                 | 作用                                |
| -------------------- | ----------------------------------- |
| `DEV_INVITE_CODE`    | 开发环境建房邀请码                  |
| `DEEPSEEK_API_KEY`   | DeepSeek API Key                    |
| `DEEPSEEK_MODEL`     | DeepSeek 模型 ID                    |
| `KIMI_API_KEY`       | Kimi API Key                        |
| `KIMI_MODEL`         | Kimi 模型 ID                        |
| `APP_ENCRYPTION_KEY` | Provider 密钥加密密钥，生产必须配置 |

注意：带 `NEXT_PUBLIC_` 前缀的变量会进入浏览器；真实供应商 Key 永远不要加这个前缀。

## 七、遇到问题

先查看 [FAQ](./FAQ.md)。常见问题包括端口被占用、依赖安装失败、AI 一直规则兜底、
邀请码错误、如何部署到公网等。
