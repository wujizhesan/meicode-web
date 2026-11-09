import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  framePayload,
  parseSseFrames,
  streamMessage,
  filterTasksByQuery,
  listTasks,
  ASK_ARTIFACT_NAME,
  type A2ATask,
  type A2AStreamResponse,
} from './a2a'

afterEach(() => {
  vi.unstubAllGlobals()
})

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function stubFetch(frames: string[]) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => sseResponse(frames))
  vi.stubGlobal('fetch', mock)
  return mock
}

function rpcFrame(result: A2AStreamResponse): string {
  return `data: ${JSON.stringify({ jsonrpc: '2.0', id: '1', result })}\n\n`
}

describe('parseSseFrames', () => {
  it('一帧一个 chunk 时全部返回', () => {
    const { frames, rest } = parseSseFrames('data: a\n\ndata: b\n\n')
    expect(frames).toEqual(['data: a', 'data: b'])
    expect(rest).toBe('')
  })

  it('粘包时按空行切开', () => {
    const { frames } = parseSseFrames('data: a\n\ndata: b\n\ndata: c')
    expect(frames).toEqual(['data: a', 'data: b'])
  })

  it('半包时把残缺部分留在 rest 里', () => {
    const { frames, rest } = parseSseFrames('data: a\n\ndata: par')
    expect(frames).toEqual(['data: a'])
    expect(rest).toBe('data: par')
  })

  it('没有分隔符时全是 rest', () => {
    const { frames, rest } = parseSseFrames('data: only')
    expect(frames).toEqual([])
    expect(rest).toBe('data: only')
  })
})

describe('framePayload', () => {
  it('多行 data 按 SSE 规范用换行拼接', () => {
    expect(framePayload('data: {"a":\ndata: 1}')).toEqual({ a: 1 })
  })

  it('没有 data 行（心跳/注释）返回 null', () => {
    expect(framePayload(': keep-alive')).toBeNull()
  })

  it('坏 JSON 直接抛，交给调用方处理', () => {
    expect(() => framePayload('data: {oops')).toThrow()
  })
})

describe('streamMessage', () => {
  it('按需带上三个 opt-in 请求头', async () => {
    const fetchMock = stubFetch([rpcFrame({ statusUpdate: { taskId: 't', contextId: 'c', status: { state: 'TASK_STATE_WORKING', timestamp: 'now' } } })])

    await streamMessage(
      { endpoint: '/a2a', text: 'hi', toolEvents: true, interactive: true, contextHistory: true },
      { onEvent: () => {} },
    )

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({
      'x-meicode-tool-events': '1',
      'x-meicode-interactive': '1',
      'x-meicode-context-history': '1',
    })
  })

  it('不带开关时不会附加那些请求头', async () => {
    const fetchMock = stubFetch([rpcFrame({ statusUpdate: { taskId: 't', contextId: 'c', status: { state: 'TASK_STATE_WORKING', timestamp: 'now' } } })])

    await streamMessage({ endpoint: '/a2a', text: 'hi' }, { onEvent: () => {} })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).not.toHaveProperty('x-meicode-tool-events')
    expect(init.headers).not.toHaveProperty('x-meicode-interactive')
  })

  it('把 contextId 回传给 onContext，并逐帧派发事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      rpcFrame({ task: { id: 't1', contextId: 'ctx-1', status: { state: 'TASK_STATE_SUBMITTED', timestamp: 'now' }, history: [], artifacts: [] } }),
      rpcFrame({ artifactUpdate: { taskId: 't1', contextId: 'ctx-1', artifact: { artifactId: 'a1', parts: [{ kind: 'text', text: 'hello' }] }, append: true, lastChunk: true } }),
    ])))

    const events: A2AStreamResponse[] = []
    const contexts: string[] = []
    await streamMessage({ endpoint: '/a2a', text: 'hi' }, {
      onEvent: (event) => events.push(event),
      onContext: (id) => contexts.push(id),
    })

    expect(contexts).toEqual(['ctx-1', 'ctx-1'])
    expect(events).toHaveLength(2)
    expect(events[1].artifactUpdate?.artifact.parts[0].text).toBe('hello')
  })

  it('meicode/ask 帧触发 onAsk，且不影响 onEvent', async () => {
    const ask = { approvalId: 'r1', tool: 'run_command', args: 'command=ls', reason: '', timeoutMs: 120000 }
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      rpcFrame({ artifactUpdate: { taskId: 't1', contextId: 'c1', artifact: { artifactId: 'r1', name: ASK_ARTIFACT_NAME, parts: [{ kind: 'text', text: JSON.stringify(ask) }] }, append: false, lastChunk: false } }),
    ])))

    const asks: unknown[] = []
    let events = 0
    await streamMessage({ endpoint: '/a2a', text: 'hi' }, {
      onEvent: () => { events++ },
      onAsk: (request) => asks.push(request),
    })

    expect(asks).toEqual([ask])
    expect(events).toBe(1)
  })

  it('HTTP 非 2xx 抛出带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(streamMessage({ endpoint: '/a2a', text: 'hi' }, { onEvent: () => {} })).rejects.toThrow(/HTTP 500/)
  })

  it('JSON-RPC error 帧转成异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code: -32000, message: '配额不足' } })}\n\n`,
    ])))
    await expect(streamMessage({ endpoint: '/a2a', text: 'hi' }, { onEvent: () => {} })).rejects.toThrow('配额不足')
  })

  it('最后一帧没有空行结尾时也要派发', async () => {
    const frame = rpcFrame({ statusUpdate: { taskId: 't', contextId: 'c', status: { state: 'TASK_STATE_COMPLETED', timestamp: 'now' }, final: true } })
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([frame.slice(0, -1)])))

    let count = 0
    await streamMessage({ endpoint: '/a2a', text: 'hi' }, { onEvent: () => { count++ } })
    expect(count).toBe(1)
  })
})

function fakeTask(id: string, texts: string[]): A2ATask {
  return {
    id,
    contextId: `ctx-${id}`,
    status: { state: 'TASK_STATE_COMPLETED', timestamp: 'now' },
    history: texts.map((text, index) => ({
      messageId: `m-${id}-${index}`,
      role: index === 0 ? 'ROLE_USER' : 'ROLE_AGENT',
      parts: [{ kind: 'text', text }],
    })),
    artifacts: [],
  }
}

describe('filterTasksByQuery', () => {
  const tasks = [
    fakeTask('t1', ['重构前端', '已完成拆分']),
    fakeTask('t2', ['查询 Database 索引', '没有命中']),
  ]

  it('空关键词或纯空格时原样返回', () => {
    expect(filterTasksByQuery(tasks)).toBe(tasks)
    expect(filterTasksByQuery(tasks, '   ')).toBe(tasks)
  })

  it('大小写不敏感，用户与助手消息都算正文', () => {
    expect(filterTasksByQuery(tasks, '重构').map((task) => task.id)).toEqual(['t1'])
    expect(filterTasksByQuery(tasks, '已完成').map((task) => task.id)).toEqual(['t1'])
    expect(filterTasksByQuery(tasks, 'DATABASE').map((task) => task.id)).toEqual(['t2'])
  })

  it('没有命中时返回空数组，history 缺失也不抛', () => {
    expect(filterTasksByQuery(tasks, '不存在')).toEqual([])
    expect(filterTasksByQuery([{ ...tasks[0], history: undefined as never }], '重构')).toEqual([])
  })

  it('对服务端已过滤的结果是幂等的', () => {
    const alreadyFiltered = [tasks[0]]
    expect(filterTasksByQuery(alreadyFiltered, '重构')).toEqual(alreadyFiltered)
  })
})

describe('listTasks 兼容旧服务端', () => {
  function stubRpc(result: unknown) {
    const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ jsonrpc: '2.0', id: '1', result }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('把 query 发给服务端，并在服务端忽略它时本地兜底过滤', async () => {
    const unfiltered = [fakeTask('t1', ['重构前端']), fakeTask('t2', ['查询数据库'])]
    const mock = stubRpc({ tasks: unfiltered, totalSize: 2 })

    const result = await listTasks('/a2a', 100, '重构')

    const init = mock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { method: string; params: { query: string } }
    expect(body.method).toBe('tasks/list')
    expect(body.params.query).toBe('重构')
    expect(result.map((task) => task.id)).toEqual(['t1'])
  })

  it('不带关键词时不额外过滤，也不发 query 参数', async () => {
    const all = [fakeTask('t1', ['重构前端']), fakeTask('t2', ['查询数据库'])]
    const mock = stubRpc({ tasks: all, totalSize: 2 })

    expect(await listTasks('/a2a', 100)).toEqual(all)

    const init = mock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { params: Record<string, unknown> }
    expect(body.params).not.toHaveProperty('query')
  })
})
