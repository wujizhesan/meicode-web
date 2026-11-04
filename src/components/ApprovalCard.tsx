import { useState, type ReactElement } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '../lib/a2a'

const RESOLVED_LABEL: Record<ApprovalDecision | 'timeout', string> = {
  once: '已允许（一次）',
  session: '已允许（本次会话）',
  deny: '已拒绝',
  timeout: '超时未答复，已按拒绝处理',
}

/** 权限询问卡片：允许一次 / 本次会话都允许 / 拒绝 */
export function ApprovalCard({
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
    const denied = resolved === 'deny' || resolved === 'timeout'
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/60 bg-card/30 px-3 py-2 text-[12px] text-muted-foreground">
        <ShieldCheck size={13} className={denied ? 'text-destructive' : 'text-emerald-400'} />
        {RESOLVED_LABEL[resolved]} · {request.tool}
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
