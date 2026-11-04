# MeiCode Web 控制台

MeiCode 的浏览器端界面。不重新实现 Agent，只做「前端」这一层：通过 A2A（JSON-RPC over HTTP + SSE）连接本机运行的 `meicode --a2a-port`，把流式结果渲染出来。

## 技术栈

| 层 | 选型 |
|---|---|
| 构建 | Vite 8 + TypeScript |
| UI | React 19 + Tailwind CSS 3.4（shadcn 风格变量与组件写法） |
| 图标 | lucide-react |
| Markdown | react-markdown + remark-gfm + rehype-highlight（highlight.js） |

## 跑起来

前提：Node 20+，以及一个在跑的 MeiCode A2A 服务（`meicode --a2a-port 8787`）。

```bash
npm install
npm run dev        # http://localhost:5273
```

默认把 `/a2a`、`/health`、`/.well-known` 代理到 `http://127.0.0.1:8787`；服务在别处就改环境变量：

```bash
MEICODE_A2A=http://127.0.0.1:9000 npm run dev
```

浏览器直连会被 CORS 拦住（MeiCode 的 A2A 服务不带 CORS 头），所以开发期一律走 Vite 代理。

## 打包

`npm run build` 会把 markdown 渲染器拆成独立块：

| 文件 | 大小 | 何时加载 |
|---|---|---|
| `index.js` | 282 kB（gzip 88 kB） | 首屏 |
| `MarkdownRenderer.js` | 330 kB（gzip 102 kB） | 第一次渲染助手消息时 |
| `MarkdownRenderer.css` | 1.1 kB | 同上（highlight.js 主题） |

加载期间 Suspense 先按纯文本显示，不会白屏。

## 出错时的降级

React 默认「一棵子树抛错，整页卸载」。这里放了两层 `ErrorBoundary`：

- **消息级**：每条助手消息单独包一层，某条渲染炸了只降级这一条（显示错误信息 + 重试），
  同一次对话里其他内容照常
- **整页级**：`main.tsx` 里包住 `App`，真到大面积崩溃时给一个「重试 / 刷新页面」的界面，
  而不是白屏

`componentDidCatch` 里带了 `label`（如 `message m-123`），控制台能直接定位是哪一块挂的。

## 测试

```bash
npm test      # vitest run
```

覆盖两处最容易静默出错的地方：

- `lib/a2a.ts`：SSE 分帧（粘包、半包、末帧无空行）、`data:` 多行拼接、心跳帧、三个 opt-in 请求头、
  JSON-RPC error 帧、`meicode/ask` 回调
- `lib/sessions.ts`：标题截断、坏存档回退、刷新时清除 `streaming` 残留、20 条会话上限、配额写失败时的降级

## 没有模型额度时

```bash
npm run mock       # 起一个假的 A2A 服务（8787），按 12 字符切片流式吐一段固定 markdown
```

用来验证流式渲染、代码高亮、表格、停止按钮，不消耗任何 token。

## 目录

```
src/
  App.tsx              仅做组装（~100 行），状态与渲染都在下面这些模块里
  hooks/
    useSessions.ts     会话存储：持久化、增删切换、按消息 id 打补丁
    useA2aStream.ts    发送/停止/审批回传、artifact 归并、任务状态
    useTaskHistory.ts  服务端历史：列表、防抖搜索、点开还原会话
  components/
    Sidebar.tsx        品牌、会话列表、历史面板、端点配置
    ChatHeader.tsx     状态条与任务状态徽章
    MessageList.tsx    消息流与贴底滚动
    MessageRow.tsx     单条消息（用户/错误/助手）
    ToolList.tsx       工具卡片（参数、成败、耗时、diff、输出）
    ApprovalCard.tsx   权限询问
    ErrorBoundary.tsx  渲染错误隔离（单条消息降级 / 整页兜底）
    Markdown.tsx       markdown + 代码块
    DiffView.tsx       unified diff 红绿对比
    ToolOutput.tsx     工具正文输出
    Composer.tsx       多行输入
  lib/
    a2a.ts             协议类型 + SSE 帧解析 + 各 RPC 封装
    sessions.ts        会话模型、localStorage 持久化与容量上限
mock/a2a-mock.mjs      假的 A2A 服务端
```

## 协议对接的几个细节

- 方法名 `message/stream`，响应是 SSE，每帧形如 `data: {"jsonrpc":"2.0","id":..,"result":{..}}`
- 事件三种：`task`（快照）、`statusUpdate`（状态/进度）、`artifactUpdate`（产出文本）
- `artifactUpdate.append` 为 `false` 表示**替换**该 artifact 的全文，`true` 表示追加。真实 MeiCode 走的是前者（一次性下发），mock 走后者（逐段），两种都要能渲染
- 一个任务可能有多个 artifact，按 `artifactId` 分别累积再按到达顺序拼接，避免后到的产物覆盖前面的

## 工具卡片（opt-in）

A2A 原本只透出文本产物，看不到模型调用了什么工具。前端会带上请求头 `x-meicode-tool-events: 1`，
服务端据此额外推送 `name: "meicode/tool"` 的 artifact，每帧 `parts[0].text` 是一段 JSON：

```json
{ "phase": "start", "callId": "call_x", "tool": "find_files", "args": "pattern=**/*, path=src" }
{ "phase": "end",   "callId": "call_x", "tool": "find_files", "success": true, "durationMs": 22, "summary": "成功" }
```

前端按 `callId` 归并成卡片（执行中转圈、成功打勾、失败打叉，右侧显示耗时）。参数会被截断到
200 字符以内——`write_file` 的 `content` 可能有几十 KB，原样进事件流会把 SSE 带宽和渲染都拖垮。

编辑类工具（`edit_file` / `write_file`）的 end 帧还会多一个 `diff` 字段，内容就是 unified diff：

```json
{ "phase": "end", "tool": "edit_file", "success": true, "diff": "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c" }
```

卡片里渲染成可折叠的红绿对比（`+` 绿底、`-` 红底、`@@` 灰底），超过 14 行默认折叠。
服务端把 diff 截断到 4000 字符，工具层默认最多 400 行。

end 帧还带 `output`（工具正文，工具层已截到 8KB，服务端再兜一层到 8000 字符）。
卡片里是可折叠的输出块：8 行以内或 600 字符以内直接展开，否则收起，展开后限高 320px 可滚动。

不带这个头的客户端（包括 MeiCode 自己的 A2A 工具）看到的产物和以前完全一样。

## 多会话

左侧是会话列表，按最近更新时间排序，每个会话独立保存消息与 `contextId`。

- 存储：`localStorage` 的 `meicode.sessions.v1`，最多 20 条会话、每条 120 条消息
- 标题取第一条用户消息的前 24 字
- 刷新后恢复上次活跃的会话；刷新时会把残留的 `streaming` 标记清掉，避免一直转圈
- 「流式中」由消息自身状态推导，不是独立布尔值——中途切走再切回来仍然正确
- 同一时刻只允许跑一个任务：另一个会话在跑时，输入框上方会提示，发送会被拦掉
  （两路并发会让 `abort` 和消息补丁互相打架）

## 服务端历史与会话续接

侧栏底部的「服务端历史」通过 `tasks/list` 拉取服务端保留的任务（默认最近 100 条），
点某一条会 `tasks/get` 取出它的 `history` 并还原成一个本地会话；同一 `contextId`
已经打开过就直接切过去，不重复建会话。搜索框走服务端：把关键词作为 `query` 传给 `tasks/list`，按任务正文匹配（大小写不敏感），
输入停 250ms 才发请求。这样命中的是全部历史任务，不只是已加载的那一页。

**续接是真的续接**：发送时会带 `x-meicode-context-history: 1`，服务端据此把同
`contextId` 下已有的消息灌进模型上下文。在此之前每个 `message/send` 都是新任务、
只带当前这条消息——多轮对话在服务端其实是无记忆的（问「我刚才说的数字是多少」必然答不知道）。

## 交互审批

A2A 默认是无人值守：需要确认的动作直接拒绝，所以 Web 端原本做不了写操作。
前端会再带一个请求头 `x-meicode-interactive: 1`，服务端据此切到 `default` 权限模式，
把权限询问变成事件推过来：

```json
{ "approvalId": "request_x", "tool": "run_command", "args": "command=touch a.txt", "reason": "", "timeoutMs": 120000 }
```

用户点「允许一次 / 本次会话都允许 / 拒绝」后，前端调用 JSON-RPC：

```json
{ "jsonrpc": "2.0", "id": "...", "method": "meicode/approval",
  "params": { "approvalId": "request_x", "decision": "once" } }
```

服务端收到答复才继续执行。**120 秒不答复、任务被取消或连接断开，一律按拒绝处理**——
宁可停手，也不会默认放行。

工具卡片的耗时会把审批等待单独拆出来显示（`等待确认 13.9s · 173ms`），
否则会出现「touch 花了 29 秒」这种误导。

## 已知限制

- **没有鉴权**：`meicode --a2a-port` 不带 token 时只放行本机回环地址；要对外需要 `--a2a-token`，本前端还没做 Bearer 输入框
- **审批没有防重放**：`approvalId` 一次性有效，但没有绑定来源 IP/会话签名；要对外部署得配合 `--a2a-token`
- **工具输出有上限**：单个工具最多带 8KB（工具层截断），超出部分前端看不到，也不能从卡片反向操作
- 首屏 JS 282 kB（gzip 88 kB），markdown 渲染器与 highlight.js 单独成块（330 kB，gzip 102 kB），
  第一次出现助手消息时才加载；高亮主题 CSS 跟着那个块走，首屏不为它付代价

## License

[MIT](./LICENSE)
