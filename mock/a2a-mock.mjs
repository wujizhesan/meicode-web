// 本地 mock A2A 服务：只实现 message/stream，用来在没有模型额度的情况下验证前端。
// 用法：node mock/a2a-mock.mjs [port]
// 协议与 D:\MeiCode-Full\src\a2a 保持一致：POST /a2a，JSON-RPC 2.0，SSE 帧为 `data: {...}\n\n`。
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8787)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const REPLY = `## 收到任务

我看了一下你的项目结构，这里是几个要点：

1. **入口**在 \`src/cli.tsx\`，参数解析拆在 \`src/cli-fast.ts\`
2. 渲染层是 Ink，组件只有三个：\`App\` / \`ChatView\` / \`Input\`
3. 测试规模 168 个文件、1182 个用例

### 一个示例

\`\`\`ts
export function statusLine(mode: string, round: number, tokens: number): string {
  return \`\${mode} · R\${round} · \${tokens} tokens\`
}
\`\`\`

| 模块 | 行数 |
|---|---|
| src/tui | 2121 |
| src/a2a | 1573 |

> 以上数字来自 \`npm run metrics\`，不是我编的。

需要我继续改哪一块？`

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mock: true }))
    return
  }
  if (req.method === 'GET' && req.url?.startsWith('/.well-known/agent-card.json')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ name: 'MeiCode Mock Agent', version: '0.0.0-mock', capabilities: { streaming: true } }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }

  let raw = ''
  for await (const chunk of req) raw += chunk
  let body = {}
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } }))
    return
  }

  const id = body.id ?? null
  const contextId = body?.params?.message?.contextId ?? `ctx-${Date.now()}`
  const taskId = `task-${Date.now()}`

  if (body.method !== 'message/stream') {
    res.writeHead(200, { 'content-type': 'application/a2a+json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }))
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  const send = (result) => sse(res, { jsonrpc: '2.0', id, result })
  const ts = () => new Date().toISOString()

  send({ statusUpdate: { taskId, contextId, status: { state: 'TASK_STATE_SUBMITTED', timestamp: ts() } } })
  await sleep(200)
  send({ statusUpdate: { taskId, contextId, status: { state: 'TASK_STATE_WORKING', timestamp: ts() } } })

  let closed = false
  req.on('close', () => { closed = true })

  // 按 12 字符切片，模拟真实 token 流
  const chunks = []
  for (let i = 0; i < REPLY.length; i += 12) chunks.push(REPLY.slice(i, i + 12))
  for (let i = 0; i < chunks.length; i++) {
    if (closed) return
    send({
      artifactUpdate: {
        taskId,
        contextId,
        artifact: { artifactId: 'answer', name: 'answer', parts: [{ kind: 'text', text: chunks[i] }] },
        append: true,
        lastChunk: i === chunks.length - 1,
      },
    })
    await sleep(18)
  }

  send({
    statusUpdate: {
      taskId,
      contextId,
      status: { state: 'TASK_STATE_COMPLETED', timestamp: ts() },
      final: true,
    },
  })
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock A2A 服务已启动: http://127.0.0.1:${port}/a2a`)
})
