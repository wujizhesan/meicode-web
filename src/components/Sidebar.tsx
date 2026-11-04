import type { ReactElement } from 'react'
import { History, Loader2, Plug, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { taskTitle } from '../lib/a2a'
import type { Session } from '../lib/sessions'
import type { useTaskHistory } from '../hooks/useTaskHistory'

type TaskHistory = ReturnType<typeof useTaskHistory>

interface SidebarProps {
  sessions: Session[]
  activeId?: string
  online: boolean | null
  endpoint: string
  onEndpointChange: (value: string) => void
  onNew: () => void
  onSwitch: (id: string) => void
  onRemove: (id: string) => void
  history: TaskHistory
}

/** 左侧栏：品牌、新会话、会话列表、服务端历史、A2A 端点 */
export function Sidebar({
  sessions,
  activeId,
  online,
  endpoint,
  onEndpointChange,
  onNew,
  onSwitch,
  onRemove,
  history,
}: SidebarProps): ReactElement {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
      <div className="flex items-center gap-2 px-4 py-4">
        <Terminal size={18} className="text-primary" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">MeiCode</div>
          <div className="text-[11px] text-muted-foreground">控制台 · Web</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onNew}
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
      >
        <Plus size={14} />
        新会话
      </button>

      <div className="flex-1 overflow-y-auto px-2">
        <div className="mb-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          会话 · {sessions.length}
        </div>
        <div className="space-y-1">
          {[...sessions]
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map((session) => {
              const rounds = session.messages.filter((message) => message.role === 'user').length
              const isActive = session.id === activeId
              const running = session.messages.some((message) => message.streaming)
              return (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-start gap-2 rounded-lg border px-2.5 py-2 transition',
                    isActive
                      ? 'border-primary/40 bg-primary/[0.08]'
                      : 'border-transparent hover:border-border/70 hover:bg-background/60',
                  )}
                >
                  <button type="button" onClick={() => onSwitch(session.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      {running ? <Loader2 size={11} className="shrink-0 animate-spin text-primary" /> : null}
                      <span className={cn('truncate text-[13px]', isActive ? 'text-foreground' : 'text-foreground/80')}>
                        {session.title}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                      {rounds} 轮 · {session.contextId ? '有上下文' : '无上下文'}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="删除会话"
                    onClick={() => onRemove(session.id)}
                    className="mt-0.5 rounded p-0.5 text-muted-foreground/50 opacity-0 transition hover:bg-white/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
        </div>
      </div>

      <div className="mt-3 border-t border-border/60 px-2 pt-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={history.toggle}
            className="flex items-center gap-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground/70 transition hover:text-foreground"
          >
            <History size={11} />
            服务端历史{history.tasks.length > 0 ? ` · ${history.tasks.length}` : ''}
          </button>
          {history.open ? (
            <button
              type="button"
              onClick={() => void history.refresh(history.query)}
              className="flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground/70 transition hover:text-foreground"
            >
              <RefreshCw size={10} className={history.loading ? 'animate-spin' : ''} />
              {history.loading ? '刷新中' : '刷新'}
            </button>
          ) : null}
        </div>

        {history.open ? (
          <div className="mt-2">
            <input
              value={history.query}
              onChange={(event) => history.setQuery(event.target.value)}
              placeholder="按内容过滤"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-primary/50"
            />
            {history.error ? <div className="mt-1 px-1 text-[11px] text-destructive">{history.error}</div> : null}
            <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
              {history.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => void history.openTask(task.id)}
                  title={taskTitle(task)}
                  className="block w-full truncate rounded px-2 py-1 text-left text-[12px] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  {taskTitle(task)}
                </button>
              ))}
              {!history.loading && history.tasks.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-muted-foreground/60">服务端暂无历史任务</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <label className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          <Plug size={12} /> A2A 端点
        </label>
        <input
          value={endpoint}
          onChange={(event) => onEndpointChange(event.target.value)}
          spellCheck={false}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px] outline-none focus:border-primary/50"
        />
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              online === null ? 'bg-muted-foreground' : online ? 'bg-emerald-400' : 'bg-destructive',
            )}
          />
          {online === null ? '检测中' : online ? '已连接' : '未连接'}
        </div>
      </div>
    </aside>
  )
}
