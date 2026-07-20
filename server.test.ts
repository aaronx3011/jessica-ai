import { describe, it, expect, vi } from 'vitest'
import { handleClientMessage } from './server'

describe('handleClientMessage', () => {
  it('forwards realtimeInput to Gemini as-is', () => {
    const send = vi.fn()
    const geminiWs = { readyState: 1, send } as any
    const rawData = {
      realtimeInput: {
        mediaChunks: [{ data: 'abcd', mimeType: 'audio/pcm;rate=16000' }],
      },
    }

    handleClientMessage(rawData, geminiWs, true)

    expect(send).toHaveBeenCalledWith(JSON.stringify(rawData))
  })

  it('sends clientContent barge-in on interrupt message', () => {
    const send = vi.fn()
    const geminiWs = { readyState: 1, send } as any

    handleClientMessage({ type: 'interrupt' }, geminiWs, true)

    expect(send).toHaveBeenCalledWith(
      JSON.stringify({
        clientContent: {
          turns: [],
          turnComplete: true,
        },
      })
    )
  })

  it('does nothing when isLive is false', () => {
    const send = vi.fn()
    const geminiWs = { readyState: 1, send } as any

    handleClientMessage({ type: 'interrupt' }, geminiWs, false)

    expect(send).not.toHaveBeenCalled()
  })

  it('does nothing when geminiWs is not OPEN', () => {
    const send = vi.fn()
    const geminiWs = { readyState: 3, send } as any

    handleClientMessage({ type: 'interrupt' }, geminiWs, true)

    expect(send).not.toHaveBeenCalled()
  })
})
