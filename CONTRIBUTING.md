# 参与开发

使用 Node.js 22.12+，运行 `npm ci` 和 `npm run dev` 启动客户端。

提交 PR 前运行：

```sh
npm run typecheck
npm test
npm run test:e2e
```

请在 PR 中说明问题、变更后的行为与验证结果。平台适配变更请附可复现的操作步骤，并检查已有正文保护、填充回读及账号会话隔离。

Issue、日志、截图及测试夹具请去掉 API Key、Cookie、个人配置和账号隐私。生图集成测试使用模拟响应，无需真实付费服务。

用户配置通过设置页导出导入；请勿提交 `.user.json` 文件。新增模型时同步检查 `src/image-pricing.ts` 的参考价和计价条件。
