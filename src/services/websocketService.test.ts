import { describe, it, expect, vi } from 'vitest'
import { sendInterrupt } from './websocketService'

describe('sendInterrupt', () => {
  it('sends { type: "interrupt" } over the WebSocket', () => {
    const send = vi.fn()
    const mockWs = { readyState: 1, send } as any

    sendInterrupt(mockWs)

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'interrupt' }))
  })

  it('does nothing when WebSocket is not OPEN', () => {
    const send = vi.fn()
    const mockWs = { readyState: 3, send } as any

    sendInterrupt(mockWs)

    expect(send).not.toHaveBeenCalled()
  })
})
