# Changelog

本项目目前没有正式 Release，所有变更记录在 `main` 分支。

## 2026-08-03

- 公开 GitHub 仓库：`XiaoYu-yu/moonlit-werewolf`。
- 新增 README“获取代码与使用”章节。
- 新增 `docs/` 文档体系：使用、部署、架构、FAQ、贡献、安全。
- 升级 Next.js 到 `16.2.12`，修复生产依赖审计中的高危公告。
- 修复 Docker 镜像构建中 pnpm 非 TTY 依赖检查导致的失败。
- GitHub Actions 全绿：格式、类型、281 项测试、生产构建、浏览器 E2E、容器镜像。

## 2026-07-22

- 完成 Phase 09 前端 UI 重构。
- 首页、大厅、身份揭示、讨论、夜晚、投票、结算、AI 观战和管理页切换到新的界面系统。
- 完成桌面/移动响应式、键盘焦点、Dialog 焦点管理、320/390px 边界验收。
- 独立界面复审通过：P0=0、P1=0。

## 2026-07-20

- 新增 `docs/UI_SCREEN_CONTENT_PROMPTS.md`，为外部 UI 设计提供完整屏幕内容说明。

## 2026-07-19

- 修复本地安全边界：API 不再默认监听所有网卡，生产管理密钥必须显式配置。
- 修复 AI 结构化行动完整性与来源真实性。
- 全 AI 观战局新增分阶段节拍、暂停/恢复和 AI 思路频道。
- 新增受限 AI 可视分析抽屉与公开/私有状态隔离。

## 2026-07-18

- 建立 pnpm TypeScript monorepo。
- 完成共享契约、确定性规则引擎和 16 项单元测试。
- 完成 Next.js Web、NestJS API、BullMQ Worker 垂直切片。
- 完成 Kimi/DeepSeek 双供应商运行时与模型管理。
- 新增 Windows 双击启动器、停止器和 DPAPI 密钥保护脚本。
- 新增 Docker Compose、Caddy、GitHub CI 生产基线。
