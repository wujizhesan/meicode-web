// 演示服务：一个进程同时提供「构建产物」和「假的 A2A 后端」。
// 目的：给这个前端一个能公开访问的链接，而不需要把本机的 MeiCode 暴露出去。
// 不依赖任何第三方库，node server/demo.mjs 即可。
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const port = Number(process.env.PORT ?? 5274)
const dist = resolve(process.cwd(), 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const now = () => new Date().toISOString()
let seq = 0
const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** 演示用的历史任务，让左侧「服务端历史」不是空的 */
const history = [
  { id: 'task-demo-1', contextId: 'ctx-demo-1', text: '读一下 src/version.ts 告诉我版本号', answer: '版本号是 0.1.6。', state: 'TASK_STATE_COMPLETED' },
  { id: 'task-demo-2', contextId: 'ctx-demo-2', text: '把 src/tui/App.tsx 的状态行抽成函数', answer: '已抽成 statusLine()，并用它替换了两处重复拼接。', state: 'TASK_STATE_COMPLETED' },
  { id: 'task-demo-3', contextId: 'ctx-demo-3', text: '跑一下 npm test 看有没有红', answer: '168 个测试文件全部通过，耗时 5m12s。', state: 'TASK_STATE_COMPLETED' },
].map((item, index) => ({
  id: item.id,
  contextId: item.contextId,
  status: { state: item.state, timestamp: new Date(Date.now() - (index + 1) * 3600_000).toISOString() },
  history: [
    { messageId: `${item.id}-u`, role: 'ROLE_USER', parts: [{ kind: 'text', text: item.text }] },
    { messageId: `${item.id}-a`, role: 'ROLE_AGENT', parts: [{ kind: 'text', text: item.answer }] },
  ],
  artifacts: [],
}))

const REPLY_MARKDOWN = `## 这里是演示

你现在看到的是一个**静态部署的前端**，后端被换成了脚本化的假 A2A 服务——
它不会读你的文件、不会执行任何命令，只会按关键词返回固定内容。

- 输入里带「工具」或「文件」→ 看工具卡片和 diff
- 带「代码」→ 看语法高亮
- 其他 → 就是这段说明

> 真实版本连的是本机的 MeiCode CLI，支持流式输出、工具执行与人工审批。
`

const REPLY_TOOLS = `## 做了什么

我看了下 \`src/lib/a2a.ts\`，发现分帧逻辑有个隐患：遇到粘包时只取第一帧。

### 改动

\`\`\`ts
export function parseSseFrames(buffer: string) {
  const frames: string[] = []
  let rest = buffer
  let index = rest.indexOf('\\n\\n')
  while (index >= 0) {
    frames.push(rest.slice(0, index))
    rest = rest.slice(index + 2)
    index = rest.indexOf('\\n\\n')
  }
  return { frames, rest }
}
\`\`\`

| 场景 | 处理 |
|---|---|
| 一帧一个 chunk | 正常返回 |
| 多帧粘包 | 循环切分 |
| 半包 | 留在 rest |

需要我继续补测试吗？
`

const REPLY_CODE = `## 一个例子

用 \`useVirtualizer\` 做动态行高的列表：

\`\`\`tsx
const virtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 140, // 只是初值，真实高度靠 measureElement 回填
  overscan: 4,
})
\`\`\`

关键点：**行高不固定时不要用固定 estimate 当最终值**，滚动位置会整体漂移。
`

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/** 把长文本按 18 字符切片，模拟模型逐字吐 */
function chunks(text, size = 18) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

async function streamTask(res, reqId, params) {
  const text = String(params?.message?.parts?.[0]?.text ?? '')
  const contextId = params?.message?.contextId ?? id('ctx')
  const taskId = id('task')
  const wantsTools = /工具|文件|diff|改/.test(text)
  const wantsCode = /代码|示例|高亮/.test(text)
  const reply = wantsTools ? REPLY_TOOLS : wantsCode ? REPLY_CODE : REPLY_MARKDOWN

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  const send = (result) => sse(res, { jsonrpc: '2.0', id: reqId, result })
  const status = (state, extra = {}) => send({
    statusUpdate: { taskId, contextId, status: { state, timestamp: now() }, ...extra },
  })

  let closed = false
  // 注意：请求体读完后 req 会立刻触发 close，用 res 才能判断「客户端真的走了」
  res.on('close', () => { closed = !res.writableEnded })

  send({
    task: {
      id: taskId,
      contextId,
      status: { state: 'TASK_STATE_SUBMITTED', timestamp: now() },
      history: [{ messageId: id('msg'), role: 'ROLE_USER', parts: [{ kind: 'text', text }] }],
      artifacts: [],
    },
  })
  await sleep(120)
  if (closed) return
  status('TASK_STATE_WORKING')

  if (wantsTools) {
    const steps = [
      { tool: 'read_file', args: 'path=src/lib/a2a.ts', output: "export function parseSseFrames(buffer: string) {\n  const frames: string[] = []\n  // ...\n}" },
      {
        tool: 'edit_file',
        args: 'path=src/lib/a2a.ts, old_text=index >= 0, new_text=while loop',
        output: '已替换 1 处',
        diff: '@@ -4,4 +4,9 @@\n export function parseSseFrames(buffer: string) {\n   const frames: string[] = []\n-  const index = rest.indexOf(\'\\n\\n\')\n-  if (index < 0) return { frames, rest }\n+  let index = rest.indexOf(\'\\n\\n\')\n+  while (index >= 0) {\n+    frames.push(rest.slice(0, index))\n+    rest = rest.slice(index + 2)\n+    index = rest.indexOf(\'\\n\\n\')\n+  }\n   return { frames, rest }',
      },
      { tool: 'run_command', args: 'command=npm test src/lib/a2a.test.ts', output: 'Test Files  1 passed (1)\n     Tests  14 passed (14)' },
    ]

    for (const [index, step] of steps.entries()) {
      if (closed) return
      const callId = `call_${index}`
      const artifactId = id('tool')
      send({
        artifactUpdate: {
          taskId, contextId,
          artifact: { artifactId, name: 'meicode/tool', parts: [{ kind: 'text', text: JSON.stringify({ phase: 'start', callId, tool: step.tool, args: step.args }) }] },
          append: false, lastChunk: false,
        },
      })
      await sleep(520)
      if (closed) return
      send({
        artifactUpdate: {
          taskId, contextId,
          artifact: {
            artifactId,
            name: 'meicode/tool',
            parts: [{
              kind: 'text',
              text: JSON.stringify({
                phase: 'end', callId, tool: step.tool, success: true, durationMs: 18 + index * 7,
                summary: '成功',
                ...(step.diff ? { diff: step.diff } : {}),
                ...(step.output ? { output: step.output } : {}),
              }),
            }],
          },
          append: false, lastChunk: true,
        },
      })
      await sleep(140)
    }
  }

  const artifactId = id('report')
  for (const [index, chunk] of chunks(reply).entries()) {
    if (closed) return
    send({
      artifactUpdate: {
        taskId, contextId,
        artifact: { artifactId, name: 'response.txt', parts: [{ kind: 'text', text: chunk }] },
        append: index > 0,
        lastChunk: false,
      },
    })
    await sleep(24)
  }

  status('TASK_STATE_COMPLETED', { final: true })
  res.end()
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, mock: true })
  }

  if (req.method === 'POST' && (url.pathname === '/a2a' || url.pathname === '/')) {
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return sendJson(res, 400, { error: { message: 'JSON 解析失败' } })
    }

    const method = String(body?.method ?? '')
    const reqId = body?.id ?? null
    const params = body?.params ?? {}

    if (method === 'tasks/list') {
      const query = String(params.query ?? '').trim().toLowerCase()
      const tasks = query
        ? history.filter((task) => task.history.some((message) => message.parts[0].text.toLowerCase().includes(query)))
        : history
      return sendJson(res, 200, { jsonrpc: '2.0', id: reqId, result: { tasks, totalSize: tasks.length } })
    }

    if (method === 'tasks/get') {
      const task = history.find((item) => item.id === params.id)
      if (!task) return sendJson(res, 200, { jsonrpc: '2.0', id: reqId, error: { code: -32004, message: '任务不存在' } })
      return sendJson(res, 200, { jsonrpc: '2.0', id: reqId, result: { task } })
    }

    if (method === 'message/stream') {
      return streamTask(res, reqId, params)
    }

    if (method === 'meicode/approval') {
      return sendJson(res, 200, { jsonrpc: '2.0', id: reqId, result: { ok: true } })
    }

    return sendJson(res, 200, { jsonrpc: '2.0', id: reqId, error: { code: -32601, message: `演示服务不支持 ${method}` } })
  }

  // 静态文件
  const pathname = decodeURIComponent(url.pathname)
  const candidate = normalize(join(dist, pathname === '/' ? 'index.html' : pathname))
  if (!candidate.startsWith(dist)) {
    return sendJson(res, 403, { error: 'forbidden' })
  }
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(dist, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`demo: http://localhost:${port}  (static=${dist})`)
})
