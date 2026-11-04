import { useEffect, useRef, type ReactElement } from 'react'
import { Loader2, Terminal } from 'lucide-react'
import { MessageRow } from './MessageRow'
import type { ApprovalDecision } from '../lib/a2a'
import type { SessionMessage as Msg } from '../lib/sessions'

/** 消息流：空态、消息列表、执行中提示，并负责「贴着底部滚动」 */
export function MessageList({
  messages,
  streaming,
  onApproval,
}: {
  messages: Msg[]
  streaming: boolean
  onApproval: (messageId: string, approvalId: string, decision: ApprovalDecision) => Promise<void>
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const el = event.currentTarget
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
              <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px]">meicode --a2a-port 8787</code>
              ，然后在下方输入任务。左侧可改端点地址。
            </p>
          </div>
        ) : null}

        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            onApproval={(approvalId, decision) => onApproval(msg.id, approvalId, decision)}
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
  )
}
