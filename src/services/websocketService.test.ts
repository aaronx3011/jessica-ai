import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect, sendInterrupt } from './websocketService'

class MockWebSocket {
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {}
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

describe('connect', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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
