// MeiCode A2A 客户端：JSON-RPC over HTTP，流式用 SSE。
// 协议定义与 D:\MeiCode-Full\src\a2a\types.ts 保持一致。

export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'

export interface A2APart {
  kind: 'text'
  text: string
}

export interface A2AMessage {
  messageId: string
  role: 'ROLE_USER' | 'ROLE_AGENT'
  parts: A2APart[]
  contextId?: string
  taskId?: string
}

export interface A2AStatus {
  state: TaskState
  timestamp: string
  message?: A2AMessage
}

export interface A2AArtifact {
  artifactId: string
  name?: string
  parts: A2APart[]
}

export interface A2ATask {
  id: string
  contextId: string
  status: A2AStatus
  history: A2AMessage[]
  artifacts: A2AArtifact[]
}

export interface A2AStreamResponse {
  task?: A2ATask
  statusUpdate?: { taskId: string; contextId: string; status: A2AStatus; final?: boolean }
  artifactUpdate?: { taskId: string; contextId: string; artifact: A2AArtifact; append: boolean; lastChunk: boolean }
}

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
])

export interface StreamHandlers {
  onEvent: (event: A2AStreamResponse) => void
  onContext?: (contextId: string) => void
  onAsk?: (request: ApprovalRequest) => void
}

export interface StreamOptions {
  endpoint: string
  text: string
  contextId?: string
  signal?: AbortSignal
  /** 让服务端把工具调用作为 meicode/tool artifact 一起下发（opt-in，避免影响其他客户端） */
  toolEvents?: boolean
  /** 交互模式：权限询问以 meicode/ask 事件下发，由客户端答复后继续 */
  interactive?: boolean
}

/** 工具调用事件负载，与 MeiCode 侧 src/a2a.ts 的 JSON 结构对应 */
export interface ToolEvent {
  phase: 'start' | 'end'
  callId: string
  tool: string
  args?: string
  success?: boolean
  durationMs?: number
  /** 其中等待人工审批的时间（服务端已从 durationMs 里扣除） */
  waitedMs?: number
  summary?: string
  /** 编辑类工具的 unified diff（服务端截断到 4000 字符） */
  diff?: string
  /** 工具正文输出（服务端截断到 8000 字符） */
  output?: string
}

export const TOOL_ARTIFACT_NAME = 'meicode/tool'
export const ASK_ARTIFACT_NAME = 'meicode/ask'

/** 权限询问负载 */
export interface ApprovalRequest {
  approvalId: string
  tool: string
  args: string
  reason: string
  timeoutMs: number
}

export type ApprovalDecision = 'once' | 'session' | 'deny'

/** 回传审批结果；服务端超时（默认 120s）会按拒绝处理 */
export async function respondApproval(
  endpoint: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'meicode/approval',
      params: { approvalId, decision },
    }),
  })
  if (!response.ok) throw new Error(`审批回传失败：HTTP ${response.status}`)
  const payload = await response.json() as { error?: { message?: string } }
  if (payload.error) throw new Error(payload.error.message ?? '审批回传被拒绝')
}

/** 把一段 SSE 文本拆成事件帧（`data: {...}`）。导出用于测试。 */
export function parseSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let rest = buffer
  let index = rest.indexOf('\n\n')
  while (index >= 0) {
    frames.push(rest.slice(0, index))
    rest = rest.slice(index + 2)
    index = rest.indexOf('\n\n')
  }
  return { frames, rest }
}

/** 从单个帧里取出 data 负载；没有 data 行（心跳/注释）返回 null。 */
export function framePayload(frame: string): unknown | null {
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return null
  return JSON.parse(dataLines.join('\n'))
}

export async function streamMessage(
  options: StreamOptions,
  handlers: StreamHandlers,
): Promise<void> {
  const body = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/stream',
    params: {
      message: {
        messageId: crypto.randomUUID(),
        role: 'ROLE_USER',
        parts: [{ kind: 'text', text: options.text }],
        ...(options.contextId ? { contextId: options.contextId } : {}),
      },
    },
  }

  const response = await fetch(options.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(options.toolEvents ? { 'x-meicode-tool-events': '1' } : {}),
      ...(options.interactive ? { 'x-meicode-interactive': '1' } : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`)
  }
  if (!response.body) throw new Error('服务端没有返回可读流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (frame: string): void => {
    const payload = framePayload(frame)
    if (payload === null) return
    const envelope = payload as {
      result?: A2AStreamResponse
      error?: { message?: string; code?: number }
    }
    if (envelope.error) {
      throw new Error(envelope.error.message ?? `服务端错误 ${envelope.error.code ?? ''}`)
    }
    if (!envelope.result) return
    const askArtifact = envelope.result.artifactUpdate?.artifact
    if (askArtifact?.name === ASK_ARTIFACT_NAME && handlers.onAsk) {
      try {
        handlers.onAsk(JSON.parse(askArtifact.parts.map((part) => part.text).join('')) as ApprovalRequest)
      } catch {
        // 负载坏了就当没这个事件，绝不让解析异常打断整条流
      }
    }
    const contextId = envelope.result.task?.contextId
      ?? envelope.result.statusUpdate?.contextId
      ?? envelope.result.artifactUpdate?.contextId
    if (contextId) handlers.onContext?.(contextId)
    handlers.onEvent(envelope.result)
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { frames, rest } = parseSseFrames(buffer)
    buffer = rest
    for (const frame of frames) dispatch(frame)
  }
  // 收尾：最后可能还剩一帧没有以空行结束
  buffer += decoder.decode()
  if (buffer.trim()) dispatch(buffer)
}
