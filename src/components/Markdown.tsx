import { memo, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { cn } from '../lib/utils'

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }): ReactElement {
  const [copied, setCopied] = useState(false)
  const language = /language-(\w+)/.exec(className ?? '')?.[1] ?? 'text'
  const text = String(children ?? '').replace(/\n$/, '')

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-[#0b0d12]">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{language}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-6">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

/**
 * 助手消息的 markdown 渲染。
 * 块级代码由 CodeBlock 自己带 <pre>，这里把默认 pre 换成透传，避免嵌套两层的边框和滚动容器。
 * 流式期间的半截文本（未闭合的围栏、半个列表）由 react-markdown 自行容忍。
 */
export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}): ReactElement {
  return (
    <div className={cn('md-body text-[14.5px]', streaming && 'streaming')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className ?? '')
            if (!isBlock) {
              return <code className={className}>{children}</code>
            }
            return <CodeBlock className={className}>{children}</CodeBlock>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
