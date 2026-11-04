import { lazy, memo, Suspense, type ReactElement } from 'react'

// markdown 渲染器 + highlight.js 占了产物的一大半，拆成按需加载：
// 首屏只要聊天骨架，第一次出现助手消息时才拉这个块。
const Renderer = lazy(() => import('./MarkdownRenderer'))

/**
 * markdown 渲染的壳层。
 * 块还在下载时先按纯文本显示——总比一片空白强，而且此时用户多半正在等首个 token。
 */
export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}): ReactElement {
  return (
    <Suspense
      fallback={<div className="whitespace-pre-wrap text-[14.5px] leading-7 text-foreground/90">{text}</div>}
    >
      <Renderer text={text} streaming={streaming} />
    </Suspense>
  )
})
