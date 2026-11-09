# Changelog

## Unreleased

- 历史搜索兼容旧服务端：`listTasks` 在服务端忽略 `query` 时按任务正文本地兜底过滤。
  这层过滤只剔除「所有消息都不含关键词」的任务，对服务端已过滤的结果是幂等的；
  代价是旧服务端下只能搜到已加载的这一页。新增 6 个用例覆盖大小写、空关键词、
  坏 `history`、幂等性与旧服务端降级。
- README 新增「服务端版本要求」：明确工具事件、交互审批、上下文历史、
  `tasks/list` 的 `query` 四项扩展自服务端源码 `7dadd87` 起提供，仍记在 *Unreleased*，
  公开仓库与 npm `0.1.6` 均不含；列出旧版上各功能的静默缺席表现，避免被当成连接故障排查。
- README 补上线上演示地址，醒目标注它是脚本化假数据（不读文件、不执行命令、不调模型），
  并说明发布平台的 `?sharecode=` 门禁不能省略（不带时静态资源也返回 403）。
- README 的 Node 前提由 `20+` 更正为 `22.12+`（Vite 8 要求 ≥20.19 或 ≥22.12，CI 固定 22）；
  测试章节补上 ErrorBoundary 与新增的协议用例；把过时的产物体积数字改成实测值
  （首屏 282 → 318.8 kB / gzip 88 → 99.9 kB）。
- 新建本文件：此前前端仓库没有 CHANGELOG。

## 0.1.0 (2026-11-04)

首个可公开演示的版本。

- 协议层：JSON-RPC over HTTP + SSE，覆盖粘包 / 半包 / 末帧无空行、`data:` 多行拼接与心跳帧；
  三个 opt-in 请求头、`meicode/ask` 审批回调、JSON-RPC error 帧
- 界面：多会话（localStorage，20 会话 / 120 消息上限）、服务端历史与搜索、工具卡片与
  unified diff、审批卡片、Markdown 与代码高亮
- 架构：把 702 行的 `App.tsx` 拆成 3 个 hooks + 11 个组件，组装层约 100 行
- 性能：Markdown 渲染器懒加载（首屏不加载 highlight.js）、消息列表虚拟滚动
  （120 条消息时 DOM 仅 7–8 行）
- 健壮性：消息级与整页级双层 ErrorBoundary
- 工程化：Vitest 32 例、GitHub Actions（typecheck + build + test）、MIT License
- 演示：自包含的 `server/demo.mjs`（构建产物 + 脚本化假 A2A 后端同端口），可一键部署
