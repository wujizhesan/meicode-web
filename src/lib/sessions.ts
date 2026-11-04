import type { ApprovalDecision, ApprovalRequest, ToolEvent } from './a2a'

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  at: number
  streaming?: boolean
  stopped?: boolean
  tools?: ToolEvent[]
  ask?: ApprovalRequest
  askResolved?: ApprovalDecision | 'timeout'
}

export interface Session {
  id: string
  title: string
  messages: SessionMessage[]
  contextId?: string
  updatedAt: number
}

export interface SessionStore {
  activeId: string
  sessions: Session[]
}

/** 单条会话最多留多少轮消息、最多留多少条会话：localStorage 只有 5MB 左右，不能无限攒 */
const MAX_MESSAGES_PER_SESSION = 120
const MAX_SESSIONS = 20
const STORAGE_KEY = 'meicode.sessions.v1'

export function newId(): string {
  return crypto.randomUUID()
}

export function createSession(): Session {
  return { id: newId(), title: '新会话', messages: [], updatedAt: Date.now() }
}

export function emptyStore(): SessionStore {
  const session = createSession()
  return { activeId: session.id, sessions: [session] }
}

/** 标题取第一条用户消息的前 24 个字 */
export function deriveTitle(messages: SessionMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return '新会话'
  const text = first.text.replace(/\s+/g, ' ').trim()
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

function sanitize(store: SessionStore): SessionStore {
  const sessions = store.sessions
    .filter((session) => session && typeof session.id === 'string' && Array.isArray(session.messages))
    .slice(0, MAX_SESSIONS)
    .map((session) => ({
      ...session,
      // 刷新后不应残留「流式中」状态，否则会一直转圈且发不出消息
      messages: session.messages
        .slice(-MAX_MESSAGES_PER_SESSION)
        .map((message) => ({ ...message, streaming: false })),
    }))
  if (sessions.length === 0) return emptyStore()
  const activeId = sessions.some((session) => session.id === store.activeId) ? store.activeId : sessions[0].id
  return { activeId, sessions }
}

export function loadStore(): SessionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as SessionStore
    if (!parsed || !Array.isArray(parsed.sessions)) return emptyStore()
    return sanitize(parsed)
  } catch {
    return emptyStore()
  }
}

export function saveStore(store: SessionStore): void {
  try {
    // 只保留最近的会话，按更新时间倒序后再存
    const sessions = [...store.sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS)
      .map((session) => ({ ...session, messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION) }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId: store.activeId, sessions }))
  } catch {
    // 配额满了就先丢最旧的会话再试一次；仍失败就安静放弃，不能因为持久化把界面搞崩
    try {
      const trimmed: SessionStore = {
        activeId: store.activeId,
        sessions: store.sessions.slice(0, 5).map((session) => ({ ...session, messages: session.messages.slice(-20) })),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      /* ignore */
    }
  }
}
