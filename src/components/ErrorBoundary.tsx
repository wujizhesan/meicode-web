import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** 出错时替换成什么；不传则用默认的紧凑提示条 */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** 只用于日志定位，比如 "message m-123" */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * 渲染错误隔离墙。
 * React 的默认行为是一棵子树抛错就让整页卸载（白屏），这里把它收窄成「一块内容降级」。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 生产环境这里可以接上报；现在至少让控制台能定位到是哪一块挂了
    console.error(`[ui] 渲染失败${this.props.label ? `（${this.props.label}）` : ''}`, error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return <InlineFallback error={error} onRetry={this.reset} />
  }
}

/** 消息级别的降级：只占一条消息的位置，不打断整个对话 */
function InlineFallback({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] text-destructive-foreground">
        <AlertTriangle size={14} />
        这条消息渲染失败
      </div>
      <div className="mt-1 break-all font-mono text-[11.5px] leading-5 text-destructive-foreground/70">
        {error.message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-foreground transition hover:border-primary/50"
      >
        <RotateCw size={11} />
        重试
      </button>
    </div>
  )
}

/** 整页级别的降级：至少还能看到「出事了」，而不是纯白 */
export function CrashScreen({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-destructive/40 bg-card px-6 py-5 text-center">
        <AlertTriangle size={22} className="mx-auto text-destructive" />
        <h1 className="mt-3 text-[15px] font-semibold">界面出错了</h1>
        <p className="mt-1 break-all font-mono text-[11.5px] leading-5 text-muted-foreground">{error.message}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition hover:brightness-110"
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground transition hover:border-primary/50"
          >
            刷新页面
          </button>
        </div>
      </div>
    </div>
  )
}
