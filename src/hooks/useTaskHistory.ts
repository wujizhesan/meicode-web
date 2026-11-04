import { useCallback, useEffect, useState } from 'react'
import { getTask, listTasks, taskTitle, type A2ATask } from '../lib/a2a'
import { newId, type Session, type SessionMessage as Msg } from '../lib/sessions'

interface Options {
  endpoint: string
  /** 用于判断某个 contextId 是否已经打开过，避免重复建会话 */
  findSessionByContext: (contextId: string) => Session | undefined
  onOpenExisting: (sessionId: string) => void
  onOpenSession: (session: Session) => void
}

/** 服务端历史：列表、搜索（服务端匹配）、点开还原成会话 */
export function useTaskHistory(options: Options) {
  const { endpoint, findSessionByContext, onOpenExisting, onOpenSession } = options
  const [tasks, setTasks] = useState<A2ATask[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (keyword?: string): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setTasks(await listTasks(endpoint, 100, keyword))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  // 搜索交给服务端做，输入停 250ms 再发，避免每敲一个字都打一次 RPC
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => { void refresh(query) }, 250)
    return () => clearTimeout(timer)
  }, [open, query, refresh])

  const toggle = useCallback((): void => {
    setOpen((prev) => {
      const next = !prev
      if (next && tasks.length === 0) void refresh()
      return next
    })
  }, [refresh, tasks.length])

  const openTask = useCallback(async (taskId: string): Promise<void> => {
    setError('')
    try {
      const task = await getTask(endpoint, taskId)
      const existing = task.contextId ? findSessionByContext(task.contextId) : undefined
      if (existing) {
        onOpenExisting(existing.id)
        return
      }
      const messages: Msg[] = []
      for (const message of task.history ?? []) {
        const text = message.parts.map((part) => part.text).join('')
        if (!text.trim()) continue
        messages.push({
          id: newId(),
          role: message.role === 'ROLE_USER' ? 'user' : 'assistant',
          text,
          at: Date.now(),
        })
      }
      onOpenSession({
        id: newId(),
        title: taskTitle(task),
        messages,
        contextId: task.contextId,
        updatedAt: Date.now(),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [endpoint, findSessionByContext, onOpenExisting, onOpenSession])

  return { tasks, open, toggle, query, setQuery, loading, error, refresh, openTask }
}
