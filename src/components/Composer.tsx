import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { cn } from '../lib/utils'

export function Composer({
  onSend,
  onStop,
  streaming,
}: {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
}): ReactElement {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  // 随内容长高，最高 200px 后内部滚动
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const submit = (): void => {
    const text = value.trim()
    if (!text || streaming) return
    setValue('')
    onSend(text)
  }

  return (
    <div className="px-6 pb-6">
      <div
        className={cn(
          'mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border bg-card/80 p-2 shadow-lg shadow-black/20 transition',
          'focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder="给 MeiCode 一个任务…（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-6 outline-none placeholder:text-muted-foreground/70"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="mb-0.5 flex h-8 items-center gap-1.5 rounded-lg bg-destructive/90 px-3 text-[13px] font-medium text-destructive-foreground transition hover:bg-destructive"
          >
            <Square size={12} fill="currentColor" />
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="mb-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition enabled:hover:brightness-110 disabled:opacity-30"
            aria-label="发送"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground/60">
        {streaming ? '正在生成，可随时停止' : 'MeiCode 会读取文件并执行命令，请在执行前确认工作目录'}
      </p>
    </div>
  )
}
