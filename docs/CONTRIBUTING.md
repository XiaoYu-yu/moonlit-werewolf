# 贡献指南

欢迎提交 Bug 修复、功能改进、文档优化和测试补充。参与前请先阅读
`AGENTS.md` 和 `docs/ARCHITECTURE.md`，理解项目边界与隐私约束。

## 一、开发环境

```bash
corepack enable
pnpm install
pnpm build:packages
pnpm --filter @werewolf/database db:generate
```

## 二、本地运行

开发 API：

```bash
pnpm --filter @werewolf/api build
pnpm --filter @werewolf/api start
```

开发 Web：

```bash
pnpm --filter @werewolf/web dev
```

## 三、提交前检查

所有提交必须通过：

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

新增或修改核心规则、AI 网关、权限边界时，必须补充对应测试。

浏览器测试：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## 四、分支与提交规范

- 从 `main` 新建分支，例如 `fix/room-join-timeout`、`feat/observer-pacing`。
- 提交信息使用简洁的祈使句，例如：
  - `Fix room join timeout handling`
  - `Add FAQ documentation`
  - `Refactor observer pacing`
- 不要提交 `.env`、`.runtime/`、`node_modules/`、`dist/`、构建产物或真实密钥。
- 不要改动与本次改动无关的文件。

## 五、Pull Request

1. Fork 仓库并创建分支。
2. 完成修改并通过全部检查。
3. 提交并推送到自己的 Fork。
4. 向 `XiaoYu-yu/moonlit-werewolf` 的 `main` 分支发起 Pull Request。
5. 在 PR 描述中说明问题、改动和验证结果。

## 六、行为准则

- 保持简体中文文档与用户界面。
- 不请求、不展示隐藏思维链或原始模型 trace。
- 不破坏服务端权威状态和玩家隐私边界。
- 不把真实供应商密钥加入源码、日志、截图或测试输出。
