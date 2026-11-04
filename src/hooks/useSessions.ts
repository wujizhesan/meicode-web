import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createSession,
  deriveTitle,
  loadStore,
  saveStore,
  type Session,
  type SessionMessage as Msg,
  type SessionStore,
} from '../lib/sessions'

/**
 * 会话状态的唯一入口：持久化、增删切换、按消息打补丁。
 * 所有写操作都走 setStore 的函数式更新，避免闭包拿到旧 store。
 */
export function useSessions() {
  const [store, setStore] = useState<SessionStore>(loadStore)

  useEffect(() => {
    saveStore(store)
  }, [store])

  const active = useMemo(
    () => store.sessions.find((session) => session.id === store.activeId) ?? store.sessions[0],
    [store],
  )

  const messages = active?.messages ?? []
  // 「流式中」由消息自身状态推导：切走再切回来仍能正确显示，刷新后也不会卡住
  const streaming = messages.some((message) => message.streaming)
  const busyElsewhere = store.sessions.some(
    (session) => session.id !== active?.id && session.messages.some((message) => message.streaming),
  )

  /** 当前会话的消息更新：同时刷新标题与更新时间 */
  const setMessages = useCallback((updater: (prev: Msg[]) => Msg[]): void => {
    setStore((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => {
        if (session.id !== prev.activeId) return session
        const nextMessages = updater(session.messages)
        return { ...session, messages: nextMessages, title: deriveTitle(nextMessages), updatedAt: Date.now() }
      }),
    }))
  }, [])

  /**
   * 按消息 id 打补丁，扫所有会话——流式过程中用户可能切到别的会话，
   * 只改 active 会话会把结果写丢。
   */
  const patch = useCallback((id: string, fn: (message: Msg) => Msg): void => {
    setStore((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => (
        session.messages.some((message) => message.id === id)
          ? {
              ...session,
              messages: session.messages.map((message) => (message.id === id ? fn(message) : message)),
              updatedAt: Date.now(),
            }
          : session
      )),
    }))
  }, [])

  /** contextId 写回发起任务的会话，而不是「当前」会话——中途切换会话才不会串 */
  const setContextFor = useCallback((sessionId: string, contextId: string): void => {
    setStore((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => (
        session.id === sessionId ? { ...session, contextId } : session
      )),
    }))
  }, [])

  const switchSession = useCallback((id: string): void => {
    setStore((prev) => ({ ...prev, activeId: id }))
  }, [])

  const removeSession = useCallback((id: string): void => {
    setStore((prev) => {
      const remaining = prev.sessions.filter((session) => session.id !== id)
      if (remaining.length === 0) {
        const session = createSession()
        return { activeId: session.id, sessions: [session] }
      }
      return { activeId: prev.activeId === id ? remaining[0].id : prev.activeId, sessions: remaining }
    })
  }, [])

  const createNew = useCallback((): void => {
    setStore((prev) => {
      const session = createSession()
      return { activeId: session.id, sessions: [session, ...prev.sessions] }
    })
  }, [])

  /** 从服务端历史还原出来的会话：置顶并激活 */
  const openSession = useCallback((session: Session): void => {
    setStore((prev) => ({ activeId: session.id, sessions: [session, ...prev.sessions] }))
  }, [])

  return {
    store,
    active,
    messages,
    streaming,
    busyElsewhere,
    setMessages,
    patch,
    setContextFor,
    switchSession,
    removeSession,
    createNew,
    openSession,
  }
}
