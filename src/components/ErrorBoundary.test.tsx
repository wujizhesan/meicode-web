// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CrashScreen, ErrorBoundary } from './ErrorBoundary'

let shouldThrow = true

function Bomb(): React.ReactElement {
  if (shouldThrow) throw new Error('渲染炸了')
  return <div>恢复正常</div>
}

beforeEach(() => {
  shouldThrow = true
  // React 会把捕获到的错误打到 console.error，测试里静音以免噪音淹没结果
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('子节点正常时原样渲染', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeTruthy()
  })

  it('子组件抛错时降级成提示条，而不是让整棵树卸载', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这条消息渲染失败')).toBeTruthy()
    expect(screen.getByText('渲染炸了')).toBeTruthy()
  })

  it('点「重试」后重新渲染子组件', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这条消息渲染失败')).toBeTruthy()

    shouldThrow = false
    fireEvent.click(screen.getByText('重试'))
    expect(screen.getByText('恢复正常')).toBeTruthy()
  })

  it('支持自定义 fallback', () => {
    render(
      <ErrorBoundary fallback={(error) => <div>自定义：{error.message}</div>}>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('自定义：渲染炸了')).toBeTruthy()
  })
})

describe('CrashScreen', () => {
  it('给出错误信息与两个出口', () => {
    render(<CrashScreen error={new Error('整页挂了')} onRetry={() => {}} />)
    expect(screen.getByText('界面出错了')).toBeTruthy()
    expect(screen.getByText('整页挂了')).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
    expect(screen.getByText('刷新页面')).toBeTruthy()
  })

  it('点重试会回调', () => {
    const onRetry = vi.fn()
    render(<CrashScreen error={new Error('x')} onRetry={onRetry} />)
    fireEvent.click(screen.getByText('重试'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
