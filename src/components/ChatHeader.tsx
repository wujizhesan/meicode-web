import type { ReactElement } from 'react'
import { CircleDot } from 'lucide-react'
import { cn } from '../lib/utils'
import { TERMINAL_STATES, type TaskState } from '../lib/a2a'

const STATE_LABEL: Record<TaskState, string> = {
  TASK_STATE_SUBMITTED: '已提交',
  TASK_STATE_WORKING: '执行中',
  TASK_STATE_COMPLETED: '完成',
  TASK_STATE_FAILED: '失败',
  TASK_STATE_CANCELED: '已取消',
}

/** 顶部状态条：执行状态 + 任务状态徽章 + 协议说明 */
export function ChatHeader({ streaming, taskState }: { streaming: boolean; taskState: TaskState | null }): ReactElement {
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <CircleDot size={14} className={streaming ? 'animate-pulse text-primary' : ''} />
        {streaming ? '正在执行' : '空闲'}
        {taskState ? (
          <span
            className={cn(
              'ml-1 rounded-full border px-2 py-0.5 text-[11px]',
              TERMINAL_STATES.has(taskState)
                ? 'border-border text-muted-foreground'
                : 'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            {STATE_LABEL[taskState]}
          </span>
        ) : null}
      </div>
      <div className="hidden whitespace-nowrap text-[11px] text-muted-foreground/60 sm:block">
        JSON-RPC · message/stream · SSE
      </div>
    </header>
  )
}
