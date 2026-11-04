import type { ReactElement } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { DiffView } from './DiffView'
import { ToolOutput } from './ToolOutput'
import type { ToolEvent } from '../lib/a2a'

function formatDuration(tool: ToolEvent): string {
  const waited = tool.waitedMs && tool.waitedMs > 1000 ? `等待确认 ${(tool.waitedMs / 1000).toFixed(1)}s · ` : ''
  if (typeof tool.durationMs !== 'number') return waited
  const elapsed = tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`
  return waited + elapsed
}

/** 一次任务里的工具调用列表：名字、参数摘要、成败、耗时、diff 与输出 */
export function ToolList({ tools }: { tools: ToolEvent[] }): ReactElement {
  return (
    <div className="mb-3 space-y-1.5">
      {tools.map((tool) => (
        <div key={tool.callId} className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
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
              {tool.phase === 'end' ? (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">{formatDuration(tool)}</span>
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
