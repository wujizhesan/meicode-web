import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ChatHeader } from './components/ChatHeader'
import { Composer } from './components/Composer'
import { MessageList } from './components/MessageList'
import { Sidebar } from './components/Sidebar'
import { useA2aStream } from './hooks/useA2aStream'
import { useSessions } from './hooks/useSessions'
import { useTaskHistory } from './hooks/useTaskHistory'
import type { ApprovalDecision } from './lib/a2a'

export function App(): ReactElement {
  const {
    store,
    active,
    messages,
    streaming,
    busyElsewhere,
    setMessages,
    patch,
    setContextFor,
    switchSession,
    removeSession,
    createNew,
    openSession,
  } = useSessions()

  const [endpoint, setEndpoint] = useState(() => localStorage.getItem('meicode.a2a') ?? '/a2a')
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    localStorage.setItem('meicode.a2a', endpoint)
  }, [endpoint])

  useEffect(() => {
    let cancelled = false
    fetch('/health')
      .then((response) => { if (!cancelled) setOnline(response.ok) })
      .catch(() => { if (!cancelled) setOnline(false) })
    return () => { cancelled = true }
  }, [endpoint])

  const { send, stop, resolveApproval, taskState, resetTaskState } = useA2aStream({
    endpoint,
    sessionId: active?.id,
    contextId: active?.contextId,
    busyElsewhere,
    setMessages,
    patch,
    setContextFor,
    onConnectionLost: () => setOnline(false),
  })

  const findSessionByContext = useCallback(
    (contextId: string) => store.sessions.find((session) => session.contextId === contextId),
    [store.sessions],
  )

  const history = useTaskHistory({
    endpoint,
    findSessionByContext,
    onOpenExisting: switchSession,
    onOpenSession: openSession,
  })

  const handleNewSession = useCallback((): void => {
    stop()
    resetTaskState()
    createNew()
  }, [createNew, resetTaskState, stop])

  const handleApproval = useCallback(
    (messageId: string, approvalId: string, decision: ApprovalDecision) => resolveApproval(messageId, approvalId, decision),
    [resolveApproval],
  )

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={store.sessions}
        activeId={active?.id}
        online={online}
        endpoint={endpoint}
        onEndpointChange={setEndpoint}
        onNew={handleNewSession}
        onSwitch={switchSession}
        onRemove={removeSession}
        history={history}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader streaming={streaming} taskState={taskState} />
        <MessageList messages={messages} streaming={streaming} onApproval={handleApproval} />

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
