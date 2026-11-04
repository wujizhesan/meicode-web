import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, deriveTitle, emptyStore, loadStore, saveStore, type SessionStore } from './sessions'

const KEY = 'meicode.sessions.v1'

function memoryStorage(options: { failFirstWrite?: boolean } = {}) {
  const data = new Map<string, string>()
  let writes = 0
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++
      if (options.failFirstWrite && writes === 1) throw new Error('QuotaExceededError')
      data.set(key, value)
    },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => { data.clear() },
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    dump: () => data,
    writeCount: () => writes,
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('deriveTitle', () => {
  it('取第一条用户消息', () => {
    expect(deriveTitle([
      { id: '1', role: 'assistant', text: '先说话的是我', at: 0 },
      { id: '2', role: 'user', text: '帮我看下日志', at: 1 },
    ])).toBe('帮我看下日志')
  })

  it('超过 24 字截断并加省略号', () => {
    const long = '一'.repeat(40)
    expect(deriveTitle([{ id: '1', role: 'user', text: long, at: 0 }])).toBe(`${'一'.repeat(24)}…`)
  })

  it('把换行和多余空格压成单空格', () => {
    expect(deriveTitle([{ id: '1', role: 'user', text: '  第一行\n\n第二行  ', at: 0 }])).toBe('第一行 第二行')
  })

  it('没有用户消息时回落到默认标题', () => {
    expect(deriveTitle([])).toBe('新会话')
  })
})

describe('loadStore', () => {
  it('没有存档时给出一个空会话', () => {
    const store = loadStore()
    expect(store.sessions).toHaveLength(1)
    expect(store.activeId).toBe(store.sessions[0].id)
  })

  it('存档损坏时回退到空会话而不是抛错', () => {
    localStorage.setItem(KEY, '{not json')
    expect(() => loadStore()).not.toThrow()
    expect(loadStore().sessions).toHaveLength(1)
  })

  it('载入时清掉残留的 streaming 标记，避免刷新后一直转圈', () => {
    localStorage.setItem(KEY, JSON.stringify({
      activeId: 's1',
      sessions: [{
        id: 's1',
        title: 't',
        updatedAt: 1,
        messages: [{ id: 'm1', role: 'assistant', text: '半截', at: 1, streaming: true }],
      }],
    }))
    expect(loadStore().sessions[0].messages[0].streaming).toBe(false)
  })

  it('activeId 指向不存在的会话时回落到第一个', () => {
    const session = { id: 's2', title: 't', updatedAt: 1, messages: [] }
    localStorage.setItem(KEY, JSON.stringify({ activeId: 'nope', sessions: [session] }))
    expect(loadStore().activeId).toBe('s2')
  })
})

describe('saveStore', () => {
  it('存下来的内容能原样读回', () => {
    const store = emptyStore()
    store.sessions[0].messages.push({ id: 'm1', role: 'user', text: '你好', at: 1 })
    saveStore(store)

    const loaded = loadStore()
    expect(loaded.activeId).toBe(store.activeId)
    expect(loaded.sessions[0].messages[0].text).toBe('你好')
  })

  it('只保留最近 20 条会话', () => {
    const store: SessionStore = {
      activeId: 's0',
      sessions: Array.from({ length: 30 }, (_, index) => ({
        id: `s${index}`,
        title: `会话 ${index}`,
        updatedAt: index,
        messages: [],
      })),
    }
    saveStore(store)
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as SessionStore
    expect(saved.sessions).toHaveLength(20)
    // 更新时间倒序，最新的 s29 应保留
    expect(saved.sessions[0].id).toBe('s29')
  })

  it('配额写失败时不抛错，退化成精简存档再试一次', () => {
    vi.stubGlobal('localStorage', memoryStorage({ failFirstWrite: true }))
    const store = emptyStore()
    expect(() => saveStore(store)).not.toThrow()
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })
})

describe('createSession', () => {
  it('新会话标题为「新会话」且无消息', () => {
    const session = createSession()
    expect(session.title).toBe('新会话')
    expect(session.messages).toEqual([])
    expect(session.contextId).toBeUndefined()
  })
})
