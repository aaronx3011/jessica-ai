import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect, sendInterrupt, openLiveSession } from './websocketService'

class MockWebSocket {
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  static instances: MockWebSocket[] = []
  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.onclose?.()
  }
}

const noop = () => vi.fn()

function handlers() {
  return {
    onReady: noop(),
    onTranscript: noop(),
    onAudioChunk: noop(),
    onTurnComplete: noop(),
    onClose: noop(),
    onError: noop(),
  }
}

function sessionHandlers() {
  return {
    ...handlers(),
    onReconnected: noop(),
    onStatus: noop(),
  }
}

function chatUrl(token: number, expiresInMs = 60000): { url: string; expiresAt: string } {
  return {
    url: `wss://example.com?token=${token}`,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  MockWebSocket.instances = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('connect', () => {
  it('connects with the given URL', () => {
    const ws = connect('wss://example.com/ws?access_token=abc', handlers())
    expect((ws as unknown as MockWebSocket).url).toBe('wss://example.com/ws?access_token=abc')
  })

  it('sends the Gemini setup message on open', () => {
    const ws = connect('wss://example.com', handlers()) as unknown as MockWebSocket
    ws.onopen?.()
    const sent = JSON.parse(ws.sent[0])
    expect(sent.setup).toBeDefined()
    expect(sent.setup.model).toBe('models/gemini-2.5-flash-native-audio-latest')
    expect(sent.setup.generationConfig.responseModalities).toEqual(['AUDIO'])
  })

  it('calls onReady when setupComplete is received', () => {
    const cb = handlers()
    const ws = connect('wss://example.com', cb) as unknown as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) })
    expect(cb.onReady).toHaveBeenCalled()
  })

  it('calls onAudioChunk for modelTurn audio parts', () => {
    const cb = handlers()
    const ws = connect('wss://example.com', cb) as unknown as MockWebSocket
    ws.onmessage?.({
      data: JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { data: 'QXVkaW8=' } }],
          },
        },
      }),
    })
    expect(cb.onAudioChunk).toHaveBeenCalledWith('QXVkaW8=')
  })

  it('calls onTurnComplete when serverContent.turnComplete is received', () => {
    const cb = handlers()
    const ws = connect('wss://example.com', cb) as unknown as MockWebSocket
    ws.onmessage?.({
      data: JSON.stringify({ serverContent: { turnComplete: true } }),
    })
    expect(cb.onTurnComplete).toHaveBeenCalled()
  })

  it('calls onInterrupted when serverContent.interrupted is received', () => {
    const cb = { ...handlers(), onInterrupted: noop() }
    const ws = connect('wss://example.com', cb) as unknown as MockWebSocket
    ws.onmessage?.({
      data: JSON.stringify({ serverContent: { interrupted: true } }),
    })
    expect(cb.onInterrupted).toHaveBeenCalled()
    expect(cb.onTurnComplete).not.toHaveBeenCalled()
  })
})

describe('sendInterrupt', () => {
  it('sends the raw Gemini barge-in message over the WebSocket', () => {
    const send = vi.fn()
    const mockWs = { readyState: 1, send } as any

    sendInterrupt(mockWs)

    expect(send).toHaveBeenCalledWith(
      JSON.stringify({ clientContent: { turns: [], turnComplete: true } })
    )
  })

  it('does nothing when WebSocket is not OPEN', () => {
    const send = vi.fn()
    const mockWs = { readyState: 3, send } as any

    sendInterrupt(mockWs)

    expect(send).not.toHaveBeenCalled()
  })
})

describe('openLiveSession', () => {
  async function settle() {
    return vi.advanceTimersByTimeAsync(0)
  }

  function openSocket(ws: MockWebSocket) {
    ws.onopen?.()
    return ws
  }

  function markReady(ws: MockWebSocket) {
    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) })
  }

  it('emits connecting', () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    openLiveSession(async () => chatUrl(1), cb)
    expect(cb.onStatus).toHaveBeenCalledWith('connecting')
  })

  it('reconnects with a fresh token after an unexpected close', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    let fetchCalls = 0
    openLiveSession(async () => { fetchCalls++; return chatUrl(fetchCalls) }, cb)

    await settle()
    const first = openSocket(MockWebSocket.instances[0])
    markReady(first)

    first.onclose?.()

    expect(cb.onStatus).toHaveBeenCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)

    expect(fetchCalls).toBe(2)
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(MockWebSocket.instances[1].url).toContain('token=2')
    const second = openSocket(MockWebSocket.instances[1])
    markReady(second)

    expect(cb.onReady).toHaveBeenCalledTimes(2)
    expect(cb.onReconnected).toHaveBeenCalledTimes(1)
    expect(cb.onStatus).toHaveBeenLastCalledWith('ready')
  })

  it('backs off exponentially, capped at the maximum delay', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    openLiveSession(async () => chatUrl(1), { ...cb })

    await settle()
    const ws = openSocket(MockWebSocket.instances[0])
    markReady(ws)

    ws.onclose?.() // retry 1 -> 1s
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockWebSocket.instances).toHaveLength(2)

    MockWebSocket.instances[1].onclose?.() // retry 2 -> 2s
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockWebSocket.instances).toHaveLength(3)

    MockWebSocket.instances[2].onclose?.() // retry 3 -> 4s
    await vi.advanceTimersByTimeAsync(4000)
    expect(MockWebSocket.instances).toHaveLength(4)
  })

  it('stops retrying when the session is explicitly closed', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    const session = openLiveSession(async () => chatUrl(1), cb)

    await settle()
    const ws = openSocket(MockWebSocket.instances[0])
    markReady(ws)

    session.close()
    await vi.advanceTimersByTimeAsync(10000)

    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('hands a fresh token to the retry connection', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    let fetchCalls = 0
    openLiveSession(async () => { fetchCalls++; return chatUrl(fetchCalls) }, cb)

    await settle()
    openSocket(MockWebSocket.instances[0]).onclose?.()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchCalls).toBe(2)
    expect(MockWebSocket.instances[1].url).toContain('token=2')
  })

  it('retries when fetching the chat URL fails', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    let calls = 0
    openLiveSession(async () => {
      calls++
      if (calls === 1) throw new Error('boom')
      return chatUrl(calls)
    }, cb)

    await settle()
    expect(cb.onError).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)

    expect(MockWebSocket.instances).toHaveLength(1)
    const ws = MockWebSocket.instances[0]
    ws.onopen?.()
    markReady(ws)
    expect(cb.onReady).toHaveBeenCalledTimes(1)
    expect(cb.onReconnected).toHaveBeenCalledTimes(1)
  })

  it('resets the backoff counter after a successful reconnect', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    let calls = 0
    openLiveSession(async () => { calls++; return chatUrl(calls) }, cb)

    await settle()
    openSocket(MockWebSocket.instances[0]).onclose?.()
    await vi.advanceTimersByTimeAsync(1000)
    const ws2 = openSocket(MockWebSocket.instances[1])
    markReady(ws2) // recovered -> attempt resets to 0

    ws2.onclose?.() // next drop should back off at 1s again, not 2s
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockWebSocket.instances).toHaveLength(3)
  })

  it('surfaces the original fetch error message', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    openLiveSession(async () => { throw new Error('custom server error') }, cb)

    await settle()
    expect(cb.onError).toHaveBeenCalledWith('custom server error')
  })

  it('refreshes the session shortly before token expiry', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    openLiveSession(async () => chatUrl(1, 60000), cb, { refreshBeforeMs: 30000 })

    await settle()
    const ws = openSocket(MockWebSocket.instances[0])
    markReady(ws)

    await vi.advanceTimersByTimeAsync(29000)
    expect(MockWebSocket.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(cb.onStatus).toHaveBeenCalledWith('reconnecting')
    expect(MockWebSocket.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('does not emit disconnected when closing the session', async () => {
    vi.useFakeTimers()
    const cb = sessionHandlers()
    const session = openLiveSession(async () => chatUrl(1), cb)

    await settle()
    const ws = openSocket(MockWebSocket.instances[0])
    markReady(ws)
    session.close()

    expect(cb.onClose).not.toHaveBeenCalled()
  })
})
