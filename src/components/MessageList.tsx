import { useEffect, useRef, type ReactElement } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, Terminal } from 'lucide-react'
import { MessageRow } from './MessageRow'
import type { ApprovalDecision } from '../lib/a2a'
import type { SessionMessage as Msg } from '../lib/sessions'

/**
 * 消息流。
 *
 * 长会话只渲染视口附近的行：一条 markdown 消息可能几百像素高，120 条铺满 DOM 后
 * 滚动会明显掉帧。行高不固定，所以用动态测量（measureElement）而不是固定 estimate。
 * 空态和执行中提示不参与虚拟化。
 */
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

  // 末尾那一行是「正在工作…」，跟消息一起参与虚拟化，否则它会盖在最后一条上
  const rowCount = messages.length + (streaming ? 1 : 0)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    overscan: 4,
  })

  // 贴着底部时，内容变化（流式追加、新消息）继续跟随
  useEffect(() => {
    if (!stickToBottom.current || rowCount === 0) return
    virtualizer.scrollToIndex(rowCount - 1, { align: 'end' })
  }, [messages, rowCount, virtualizer])

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const el = event.currentTarget
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
    >
      <div className="mx-auto max-w-3xl">
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
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const message = messages[item.index]
              return (
                <div
                  key={message ? message.id : 'streaming-footer'}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                  className="pb-6"
                >
                  {message ? (
                    <MessageRow
                      msg={message}
                      onApproval={(approvalId, decision) => onApproval(message.id, approvalId, decision)}
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <Loader2 size={13} className="animate-spin" />
                      MeiCode 正在工作…
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
