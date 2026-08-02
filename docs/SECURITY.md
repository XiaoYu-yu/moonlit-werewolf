# 安全说明

## 报告漏洞

如果你发现安全问题，请不要在公开 Issue 中直接贴出漏洞细节或密钥。请通过仓库 Issue
描述“哪个模块、什么条件、影响范围”，并在确认前不要公开利用方式。

## 密钥与凭据

本项目涉及两类敏感信息：

- DeepSeek/Kimi/DashScope 等供应商 API Key。
- `APP_ENCRYPTION_KEY`、`ADMIN_API_KEY`、数据库密码、S3 密钥。

这些值只能放在服务端 `.env` 或受保护的本地密钥存储中，绝不能提交到 Git、写入
`NEXT_PUBLIC_*`、截图、日志或聊天记录。

## 本地 Windows 密钥

`配置AI模型.cmd` 使用当前 Windows 用户的 DPAPI 加密保存密钥，密文位于忽略提交的
`.runtime/provider-secrets.json`。只有启动 API 的子进程会获得解密值，Web 子进程不会
继承这些密钥。

## 生产部署检查清单

- [ ] 替换所有 `replace-with-*` 占位值。
- [ ] 使用至少 32 字节随机 `APP_ENCRYPTION_KEY`。
- [ ] 使用足够长的随机 `ADMIN_API_KEY`。
- [ ] 数据库和 Redis 不向公网开放端口。
- [ ] Caddy 启用 HTTPS，不使用明文生产地址。
- [ ] `TRUST_PROXY` 与真实代理层数一致。
- [ ] 不把 MinIO 控制台暴露到公网。
- [ ] 设置每日/单局 AI 费用预算。
- [ ] 定期更新依赖并运行生产依赖审计。

## 隐私边界

- 身份和夜间行动只能通过玩家私有状态下发。
- AI 观战全知状态只属于明确创建的 AI-only 房间房主。
- 系统不请求、不存储、不展示隐藏思维链或原始 provider trace。
- 任何隐私边界修改都必须先经过服务端授权校验，再更新前端展示。
