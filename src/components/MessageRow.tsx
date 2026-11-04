import type { ReactElement } from 'react'
import { ApprovalCard } from './ApprovalCard'
import { Markdown } from './Markdown'
import { ToolList } from './ToolList'
import { formatTime } from '../lib/utils'
import type { ApprovalDecision } from '../lib/a2a'
import type { SessionMessage as Msg } from '../lib/sessions'

/** 单条消息：用户气泡 / 错误条 / 助手（审批卡 + 工具卡 + markdown + 流式光标） */
export function MessageRow({
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
