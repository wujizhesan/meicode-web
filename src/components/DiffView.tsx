import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'

/** unified diff 渲染：@@ 头灰、+ 绿底、- 红底，长 diff 默认折叠 */
export function DiffView({ diff }: { diff: string }): ReactElement {
  const lines = diff.split('\n')
  const [open, setOpen] = useState(lines.length <= 14)

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 bg-white/[0.03] px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? '收起变更' : `展开变更（${lines.length} 行）`}
      </button>
      {open ? (
        <div className="overflow-x-auto font-mono text-[11.5px] leading-5">
          {lines.map((line, index) => {
            const marker = line[0]
            const tone = line.startsWith('@@')
              ? 'bg-white/5 text-cyan-300/80'
              : marker === '+'
                ? 'bg-emerald-500/10 text-emerald-300'
                : marker === '-'
                  ? 'bg-rose-500/10 text-rose-300'
                  : 'text-muted-foreground'
            return (
              <div key={index} className={cn('whitespace-pre px-2', tone)}>
                {line === '' ? ' ' : line}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
