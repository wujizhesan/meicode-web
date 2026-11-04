import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Check, CircleDot, Loader2, Plug, Plus, ShieldAlert, ShieldCheck, Terminal, Trash2, X } from 'lucide-react'
import { Composer } from './components/Composer'
import { DiffView } from './components/DiffView'
import { ToolOutput } from './components/ToolOutput'
import { Markdown } from './components/Markdown'
import { cn, formatTime } from './lib/utils'
import { respondApproval, streamMessage, TERMINAL_STATES, ASK_ARTIFACT_NAME, TOOL_ARTIFACT_NAME, type ApprovalDecision, type ApprovalRequest, type TaskState, type ToolEvent } from './lib/a2a'
import { createSession, deriveTitle, loadStore, newId, saveStore, type SessionMessage as Msg, type SessionStore } from './lib/sessions'

const STATE_LABEL: Record<TaskState, string> = {
  TASK_STATE_SUBMITTED: '已提交',
  TASK_STATE_WORKING: '执行中',
  TASK_STATE_COMPLETED: '完成',
  TASK_STATE_FAILED: '失败',
  TASK_STATE_CANCELED: '已取消',
}

export function App(): ReactElement {
  const [store, setStore] = useState<SessionStore>(loadStore)
  const [taskState, setTaskState] = useState<TaskState | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem('meicode.a2a') ?? '/a2a')

  const active = useMemo(
    () => store.sessions.find((session) => session.id === store.activeId) ?? store.sessions[0],
    [store],
  )
  const messages = active?.messages ?? []
  const contextId = active?.contextId
  // 「流式中」由消息自身状态推导：切走再切回来仍能正确显示，刷新后也不会卡住
  const streaming = messages.some((message) => message.streaming)
  const busyElsewhere = store.sessions.some(
    (session) => session.id !== active?.id && session.messages.some((message) => message.streaming),
  )

  const abortRef = useRef<AbortController | null>(null)
  const artifactIds = useRef<string[]>([])
  const artifactMap = useRef<Record<string, string>>({})
  const toolMap = useRef<Map<string, ToolEvent>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    localStorage.setItem('meicode.a2a', endpoint)
  }, [endpoint])

  useEffect(() => {
    saveStore(store)
  }, [store])

  useEffect(() => {
    let cancelled = false
    fetch('/health')
      .then((r) => { if (!cancelled) setOnline(r.ok) })
      .catch(() => { if (!cancelled) setOnline(false) })
    return () => { cancelled = true }
  }, [endpoint])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  /** 当前会话的消息更新：同时刷新标题与更新时间 */
  const setMessages = useCallback((updater: (prev: Msg[]) => Msg[]): void => {
    setStore((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => {
        if (session.id !== prev.activeId) return session
        const nextMessages = updater(session.messages)
        return { ...session, messages: nextMessages, title: deriveTitle(nextMessages), updatedAt: Date.now() }
      }),
    }))
  }, [])

  /**
   * 按消息 id 打补丁，扫所有会话——流式过程中用户可能切到别的会话，
   * 只改 active 会话会把结果写丢。
   */
  const patch = useCallback((id: string, fn: (m: Msg) => Msg): void => {
    setStore((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => (
        session.messages.some((message) => message.id === id)
          ? { ...session, messages: session.messages.map((message) => (message.id === id ? fn(message) : message)), updatedAt: Date.now() }
          : session
      )),
    }))
  }, [])

  const switchSession = useCallback((id: string): void => {
    setStore((prev) => ({ ...prev, activeId: id }))
  }, [])

  const removeSession = useCallback((id: string): void => {
    setStore((prev) => {
      const remaining = prev.sessions.filter((session) => session.id !== id)
      if (remaining.length === 0) {
        const session = createSession()
        return { activeId: session.id, sessions: [session] }
      }
      return { activeId: prev.activeId === id ? remaining[0].id : prev.activeId, sessions: remaining }
    })
  }, [])

  const send = useCallback(async (text: string): Promise<void> => {
    // 同一时刻只跑一个任务：两个会话各跑一路会让 abort/patch 互相打架
    if (busyElsewhere) return
    const sessionId = active?.id
    if (!sessionId) return
    const assistantId = newId()
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', text, at: Date.now() },
      { id: assistantId, role: 'assistant', text: '', at: Date.now(), streaming: true },
    ])
    setTaskState('TASK_STATE_SUBMITTED')
    stickToBottom.current = true
    artifactIds.current = []
    artifactMap.current = {}
    toolMap.current = new Map()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamMessage(
        { endpoint, text, contextId, signal: controller.signal, toolEvents: true, interactive: true },
        {
          // contextId 写回发起任务的会话，而不是「当前」会话——中途切换会话才不会串
          onContext: (value) => setStore((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) => (
              session.id === sessionId ? { ...session, contextId: value } : session
            )),
          })),
          onAsk: (request) => patch(assistantId, (m) => ({ ...m, ask: request, askResolved: undefined })),
          onEvent: (event) => {
            if (event.task) setTaskState(event.task.status.state)
            if (event.statusUpdate) setTaskState(event.statusUpdate.status.state)
            if (event.artifactUpdate) {
              const { artifact, append } = event.artifactUpdate
              const chunk = artifact.parts.map((p) => p.text).join('')

              // 工具事件走单独通道：不进正文拼接，而是渲染成工具卡片
              if (artifact.name === TOOL_ARTIFACT_NAME) {
                try {
                  toolMap.current.set(artifact.artifactId, JSON.parse(chunk) as ToolEvent)
                } catch {
                  return
                }
                const tools = [...toolMap.current.values()]
                patch(assistantId, (m) => ({ ...m, tools }))
                return
              }

              // 审批事件由 lib/a2a 的 onAsk 单独处理，别让它混进正文
              if (artifact.name === ASK_ARTIFACT_NAME) return

              // 正文产物：真实服务端一次性下发（append=false），mock 逐段追加，两种都要处理；
              // 按 artifactId 分别保存再拼起来，多段产物不会互相覆盖。
              if (!artifactIds.current.includes(artifact.artifactId)) {
                artifactIds.current.push(artifact.artifactId)
              }
              artifactMap.current[artifact.artifactId] = append
                ? (artifactMap.current[artifact.artifactId] ?? '') + chunk
                : chunk
              const merged = artifactIds.current
                .map((id) => artifactMap.current[id])
                .filter(Boolean)
                .join('\n\n')
              patch(assistantId, (m) => ({ ...m, text: merged }))
            }
          },
        },
      )
      patch(assistantId, (m) => ({ ...m, streaming: false }))
    } catch (error) {
      if (controller.signal.aborted) {
        patch(assistantId, (m) => ({ ...m, streaming: false, stopped: true }))
        setTaskState('TASK_STATE_CANCELED')
      } else {
        const detail = error instanceof Error ? error.message : String(error)
        patch(assistantId, (m) => ({ ...m, streaming: false }))
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'error', text: `连接失败：${detail}`, at: Date.now() },
        ])
        setTaskState('TASK_STATE_FAILED')
        setOnline(false)
      }
    } finally {
      abortRef.current = null
    }
  }, [active?.id, busyElsewhere, contextId, endpoint, patch, setMessages])

  const resolveApproval = useCallback(async (
    messageId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> => {
    await respondApproval(endpoint, approvalId, decision)
    patch(messageId, (m) => ({ ...m, askResolved: decision }))
  }, [endpoint, patch])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback((): void => {
    abortRef.current?.abort()
    setTaskState(null)
    setStore((prev) => {
      const session = createSession()
      return { activeId: session.id, sessions: [session, ...prev.sessions] }
    })
  }, [])

  const stateBadge = useMemo(() => {
    if (!taskState) return null
    const terminal = TERMINAL_STATES.has(taskState)
    return (
      <span
        className={cn(
          'rounded-full border px-2 py-0.5 text-[11px]',
          terminal
            ? 'border-border text-muted-foreground'
            : 'border-primary/40 bg-primary/10 text-primary',
        )}
      >
        {STATE_LABEL[taskState]}
      </span>
    )
  }, [taskState])

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <Terminal size={18} className="text-primary" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">MeiCode</div>
            <div className="text-[11px] text-muted-foreground">控制台 · Web</div>
          </div>
        </div>

        <button
          type="button"
          onClick={reset}
          className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <Plus size={14} />
          新会话
        </button>

        <div className="flex-1 overflow-y-auto px-2">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
            会话 · {store.sessions.length}
          </div>
          <div className="space-y-1">
            {[...store.sessions]
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .map((session) => {
                const rounds = session.messages.filter((message) => message.role === 'user').length
                const isActive = session.id === active?.id
                const running = session.messages.some((message) => message.streaming)
                return (
                  <div
                    key={session.id}
                    className={cn(
                      'group flex items-start gap-2 rounded-lg border px-2.5 py-2 transition',
                      isActive
                        ? 'border-primary/40 bg-primary/[0.08]'
                        : 'border-transparent hover:border-border/70 hover:bg-background/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => switchSession(session.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        {running ? <Loader2 size={11} className="shrink-0 animate-spin text-primary" /> : null}
                        <span className={cn('truncate text-[13px]', isActive ? 'text-foreground' : 'text-foreground/80')}>
                          {session.title}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {rounds} 轮 · {session.contextId ? '有上下文' : '无上下文'}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label="删除会话"
                      onClick={() => removeSession(session.id)}
                      className="mt-0.5 rounded p-0.5 text-muted-foreground/50 opacity-0 transition hover:bg-white/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
          </div>
        </div>

        <div className="border-t border-border p-3">
          <label className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
            <Plug size={12} /> A2A 端点
          </label>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px] outline-none focus:border-primary/50"
          />
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                online === null ? 'bg-muted-foreground' : online ? 'bg-emerald-400' : 'bg-destructive',
              )}
            />
            {online === null ? '检测中' : online ? '已连接' : '未连接'}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CircleDot size={14} className={streaming ? 'animate-pulse text-primary' : ''} />
            {streaming ? '正在执行' : '空闲'}
            {stateBadge ? <span className="ml-1">{stateBadge}</span> : null}
          </div>
          <div className="hidden whitespace-nowrap text-[11px] text-muted-foreground/60 sm:block">
            JSON-RPC · message/stream · SSE
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        >
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 ? (
              <div className="mt-16 text-center">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card">
                  <Terminal size={22} className="text-primary" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight">接入 MeiCode 的浏览器控制台</h1>
                <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-muted-foreground">
                  先启动服务端：
                  <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px]">
                    meicode --a2a-port 8787
                  </code>
                  ，然后在下方输入任务。左侧可改端点地址。
                </p>
              </div>
            ) : null}

            {messages.map((m) => (
              <MessageRow
                key={m.id}
                msg={m}
                onApproval={(approvalId, decision) => resolveApproval(m.id, approvalId, decision)}
              />
            ))}

            {streaming ? (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 size={13} className="animate-spin" />
                MeiCode 正在工作…
              </div>
            ) : null}
          </div>
        </div>

        {busyElsewhere ? (
          <div className="mx-auto mb-2 max-w-3xl px-6 text-[11.5px] text-amber-300/80">
            另一个会话正在执行，完成或停止后才能在这里发起新任务
          </div>
        ) : null}
        <Composer onSend={(text) => { void send(text) }} onStop={stop} streaming={streaming} />
      </main>
    </div>
  )
}

function MessageRow({
  msg,
  onApproval,
}: {
  msg: Msg
  onApproval: (approvalId: string, decision: ApprovalDecision) => Promise<void>
}): ReactElement {
  if (msg.role === 'user') {
    return (
      <div className="animate-fade-in">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">你</span>
          <span>{formatTime(msg.at)}</span>
        </div>
        <div className="whitespace-pre-wrap rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-[14.5px] leading-7">
          {msg.text}
        </div>
      </div>
    )
  }

  if (msg.role === 'error') {
    return (
      <div className="animate-fade-in rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive-foreground">
        {msg.text}
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-primary">MeiCode</span>
        <span>{formatTime(msg.at)}</span>
        {msg.stopped ? <span className="text-amber-400/80">已停止</span> : null}
      </div>
      {msg.ask ? (
        <ApprovalCard
          request={msg.ask}
          resolved={msg.askResolved}
          onResolve={(decision) => onApproval(msg.ask!.approvalId, decision)}
        />
      ) : null}
      {msg.tools?.length ? <ToolList tools={msg.tools} /> : null}
      {msg.text ? (
        <Markdown text={msg.text} streaming={Boolean(msg.streaming)} />
      ) : (
        <div className="h-6 w-24 animate-pulse rounded bg-white/5" />
      )}
      {msg.streaming && msg.text ? (
        <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-primary align-middle" />
      ) : null}
    </div>
  )
}

function ToolList({ tools }: { tools: ToolEvent[] }): ReactElement {
  return (
    <div className="mb-3 space-y-1.5">
      {tools.map((tool) => (
        <div
          key={tool.callId}
          className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2"
        >
          <span className="mt-0.5 shrink-0">
            {tool.phase === 'start' ? (
              <Loader2 size={13} className="animate-spin text-primary" />
            ) : tool.success ? (
              <Check size={13} className="text-emerald-400" />
            ) : (
              <X size={13} className="text-destructive" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[12.5px] leading-6 text-foreground">{tool.tool}</span>
              {tool.args ? (
                <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">{tool.args}</span>
              ) : null}
              {tool.phase === 'end' && typeof tool.durationMs === 'number' ? (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
                  {tool.waitedMs && tool.waitedMs > 1000
                    ? `等待确认 ${(tool.waitedMs / 1000).toFixed(1)}s · `
                    : ''}
                  {tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`}
                </span>
              ) : null}
            </div>
            {tool.phase === 'end' && tool.summary && tool.summary !== '成功' ? (
              <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-muted-foreground">
                {tool.summary}
              </div>
            ) : null}
            {tool.phase === 'end' && tool.diff ? <DiffView diff={tool.diff} /> : null}
            {tool.phase === 'end' && tool.output ? <ToolOutput output={tool.output} /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function ApprovalCard({
  request,
  resolved,
  onResolve,
}: {
  request: ApprovalRequest
  resolved?: ApprovalDecision | 'timeout'
  onResolve: (decision: ApprovalDecision) => Promise<void>
}): ReactElement {
  const [busy, setBusy] = useState<ApprovalDecision | null>(null)
  const [error, setError] = useState('')

  if (resolved) {
    const label = resolved === 'deny'
      ? '已拒绝'
      : resolved === 'timeout'
        ? '超时未答复，已按拒绝处理'
        : resolved === 'session'
          ? '已允许（本次会话）'
          : '已允许（一次）'
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/60 bg-card/30 px-3 py-2 text-[12px] text-muted-foreground">
        <ShieldCheck size={13} className={resolved === 'deny' || resolved === 'timeout' ? 'text-destructive' : 'text-emerald-400'} />
        {label} · {request.tool}
      </div>
    )
  }

  const decide = async (decision: ApprovalDecision): Promise<void> => {
    setBusy(decision)
    setError('')
    try {
      await onResolve(decision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px] text-amber-300">
        <ShieldAlert size={13} />
        需要确认
        <span className="font-mono text-[12.5px] text-foreground">{request.tool}</span>
      </div>
      {request.args ? (
        <div className="mt-1 break-all font-mono text-[11.5px] leading-5 text-muted-foreground">{request.args}</div>
      ) : null}
      {request.reason ? (
        <div className="mt-1 text-[12px] leading-5 text-amber-200/80">{request.reason}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide('once')}
          className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition enabled:hover:brightness-110 disabled:opacity-50"
        >
          {busy === 'once' ? '处理中…' : '允许一次'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide('session')}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] text-foreground transition enabled:hover:border-primary/50 disabled:opacity-50"
        >
          {busy === 'session' ? '处理中…' : '本次会话都允许'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide('deny')}
          className="rounded-md border border-destructive/50 px-2.5 py-1 text-[12px] text-destructive transition enabled:hover:bg-destructive/10 disabled:opacity-50"
        >
          {busy === 'deny' ? '处理中…' : '拒绝'}
        </button>
        <span className="text-[11px] text-muted-foreground/70">
          {Math.round(request.timeoutMs / 1000)} 秒内不答复将按拒绝处理
        </span>
      </div>
      {error ? <div className="mt-1.5 text-[11.5px] text-destructive">{error}</div> : null}
    </div>
  )
}
