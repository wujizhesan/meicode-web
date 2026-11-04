import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/** 工具正文输出：短输出直接展开，长输出默认折叠，避免把对话流撑成日志墙 */
export function ToolOutput({ output }: { output: string }): ReactElement {
  const lines = output.split('\n')
  const [open, setOpen] = useState(lines.length <= 8 && output.length <= 600)

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 bg-white/[0.03] px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? '收起输出' : `展开输出（${lines.length} 行 / ${output.length} 字符）`}
      </button>
      {open ? (
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words bg-black/20 px-2 py-1.5 font-mono text-[11.5px] leading-5 text-muted-foreground">
          {output}
        </pre>
      ) : null}
    </div>
  )
}
