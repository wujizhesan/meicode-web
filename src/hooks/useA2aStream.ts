import { useCallback, useRef, useState } from 'react'
import {
  ASK_ARTIFACT_NAME,
  respondApproval,
  streamMessage,
  TOOL_ARTIFACT_NAME,
  type ApprovalDecision,
  type TaskState,
  type ToolEvent,
} from '../lib/a2a'
import { newId, type SessionMessage as Msg } from '../lib/sessions'

interface Options {
  endpoint: string
  sessionId?: string
  contextId?: string
  /** 别的会话正在跑，本会话就别再起一路 */
  busyElsewhere: boolean
  setMessages: (updater: (prev: Msg[]) => Msg[]) => void
  patch: (id: string, fn: (message: Msg) => Msg) => void
  setContextFor: (sessionId: string, contextId: string) => void
  /** 连接失败时通知外层把在线状态打掉 */
  onConnectionLost: () => void
}

/** 一轮任务：发送、流式事件归并、取消、审批回传 */
export function useA2aStream(options: Options) {
  const { endpoint, sessionId, contextId, busyElsewhere, setMessages, patch, setContextFor, onConnectionLost } = options
  const [taskState, setTaskState] = useState<TaskState | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // 一次任务内按 artifactId 累积：真实服务端一次性下发，mock 逐段追加，两种都要能拼
  const artifactIds = useRef<string[]>([])
  const artifactMap = useRef<Record<string, string>>({})
  const toolMap = useRef<Map<string, ToolEvent>>(new Map())

  const send = useCallback(async (text: string): Promise<void> => {
    // 同一时刻只跑一个任务：两个会话各跑一路会让 abort/patch 互相打架
    if (busyElsewhere || !sessionId) return

    const assistantId = newId()
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', text, at: Date.now() },
      { id: assistantId, role: 'assistant', text: '', at: Date.now(), streaming: true },
    ])
    setTaskState('TASK_STATE_SUBMITTED')
    artifactIds.current = []
    artifactMap.current = {}
    toolMap.current = new Map()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamMessage(
        { endpoint, text, contextId, signal: controller.signal, toolEvents: true, interactive: true, contextHistory: true },
        {
          onContext: (value) => setContextFor(sessionId, value),
          onAsk: (request) => patch(assistantId, (message) => ({ ...message, ask: request, askResolved: undefined })),
          onEvent: (event) => {
            if (event.task) setTaskState(event.task.status.state)
            if (event.statusUpdate) setTaskState(event.statusUpdate.status.state)
            if (!event.artifactUpdate) return

            const { artifact, append } = event.artifactUpdate
            const chunk = artifact.parts.map((part) => part.text).join('')

            // 工具事件走单独通道：不进正文拼接，而是渲染成工具卡片
            if (artifact.name === TOOL_ARTIFACT_NAME) {
              try {
                toolMap.current.set(artifact.artifactId, JSON.parse(chunk) as ToolEvent)
              } catch {
                return
              }
              const tools = [...toolMap.current.values()]
              patch(assistantId, (message) => ({ ...message, tools }))
              return
            }

            // 审批事件由 onAsk 单独处理，别让它混进正文
            if (artifact.name === ASK_ARTIFACT_NAME) return

            if (!artifactIds.current.includes(artifact.artifactId)) {
              artifactIds.current.push(artifact.artifactId)
            }
            artifactMap.current[artifact.artifactId] = append
              ? (artifactMap.current[artifact.artifactId] ?? '') + chunk
              : chunk
            const merged = artifactIds.current
              .map((id) => artifactMap.current[id])
              .filter(Boolean)
              .join('\n\n')
            patch(assistantId, (message) => ({ ...message, text: merged }))
          },
        },
      )
      patch(assistantId, (message) => ({ ...message, streaming: false }))
    } catch (error) {
      if (controller.signal.aborted) {
        patch(assistantId, (message) => ({ ...message, streaming: false, stopped: true }))
        setTaskState('TASK_STATE_CANCELED')
      } else {
        const detail = error instanceof Error ? error.message : String(error)
        patch(assistantId, (message) => ({ ...message, streaming: false }))
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'error', text: `连接失败：${detail}`, at: Date.now() },
        ])
        setTaskState('TASK_STATE_FAILED')
        onConnectionLost()
      }
    } finally {
      abortRef.current = null
    }
  }, [busyElsewhere, contextId, endpoint, onConnectionLost, patch, sessionId, setContextFor, setMessages])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  const resolveApproval = useCallback(async (
    messageId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> => {
    await respondApproval(endpoint, approvalId, decision)
    patch(messageId, (message) => ({ ...message, askResolved: decision }))
  }, [endpoint, patch])

  const resetTaskState = useCallback((): void => {
    setTaskState(null)
  }, [])

  return { send, stop, resolveApproval, taskState, resetTaskState }
}
