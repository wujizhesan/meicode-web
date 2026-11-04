import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { CrashScreen, ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 兜住整页崩溃：出问题时给一个能重试/刷新的界面，而不是白屏 */}
    <ErrorBoundary fallback={(error, reset) => <CrashScreen error={error} onRetry={reset} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
