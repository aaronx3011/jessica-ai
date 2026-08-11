import { describe, it, expect } from 'vitest'
import { buildSetupMessage, VERA_SYSTEM_PROMPT } from './chatSetup'

describe('buildSetupMessage', () => {
  it('targets the Gemini Live model with audio-only response', () => {
    const msg = buildSetupMessage()

    expect(msg.setup.model).toBe('models/gemini-2.5-flash-native-audio-latest')
    expect(msg.setup.generationConfig.responseModalities).toEqual(['AUDIO'])
  })

  it('keeps the agent behavior: Sulafat voice, google search, transcription, compression', () => {
    const msg = buildSetupMessage()

    expect(msg.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat')
    expect(msg.setup.generationConfig.maxOutputTokens).toBe(16384)
    expect(msg.setup.tools).toEqual([{ googleSearch: {} }])
    expect(msg.setup.outputAudioTranscription).toEqual({})
    expect(msg.setup.contextWindowCompression).toEqual({
      triggerTokens: 25000,
      slidingWindow: { targetTokens: 12000 },
    })
  })

  it('carries the full Vera system prompt', () => {
    const msg = buildSetupMessage()
    const text = msg.setup.systemInstruction.parts[0].text

    expect(text).toBe(VERA_SYSTEM_PROMPT)
    expect(text).toContain('VERA - QUINTO VECTOR')
    expect(text).toContain('Eres **Vera**')
    expect(text).toContain('Sergio')
    expect(text.length).toBeGreaterThan(1000)
  })
})
