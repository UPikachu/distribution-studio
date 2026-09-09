# 自动化验证

版本：0.2.3。日期：2026-09-10。本地执行环境：macOS / Apple Silicon，Node.js 22.23.2，Electron 44.3.0。

## 检查结果

- TypeScript 类型检查及 Vite / Electron 生产构建通过。
- 43 个单元测试通过，覆盖持久化恢复、版本冲突、任务快照、重复拦截、事务回滚、预约、HTML 清洗、图片引用与删除保护，以及生图配置和 API 响应处理。
- 完整 9 个 Electron 端到端测试通过，覆盖以下流程：
  1. 主稿、平台稿、图片导入、ZIP 导出、备份恢复与重启。
  2. 队列填充、重复任务拦截与人工登记发布链接。
  3. 保护平台编辑器内已有草稿。
  4. 九个平台编辑器夹具与 CSDN 跨域 iframe 填充。
  5. 未登录时暂停和继续、同平台多账号会话隔离。
  6. 正文冲突预检和编辑器框架回滚检测。
  7. 生图配置加密保存、导出导入、图片生成与插入。
  8. 最后选择的生图平台和各平台模型在切页、重启后恢复。
  9. 图片放大、原始尺寸、Esc 关闭、焦点恢复及删除确认。

E2E 启动真实 Electron 进程，使用独立临时工作区和本地平台响应。测试不需要真实账号或付费 API Key。

## 复现

```sh
nvm use
npm ci
npm run typecheck
npm test
npm run test:e2e
```

报告与截图写入 `playwright-report/` 和 `test-results/`。GitHub CI 在 macOS 和 Windows 执行类型检查、单元测试和构建，macOS 额外执行 Electron E2E。

## 打包

通过 `npm run dist:mac` 和 `npm run dist:win` 构建安装包，产物位于 `release/`。GitHub Release 提供下载及 SHA-256 校验和。

安装包暂未签名，macOS 包未公证。用户数据存放在系统应用数据目录，与源码和安装包分离。删除的未引用素材放入 `deleted-assets/`，可通过「导入图片」恢复。
