export type AudioCaptureHandle = {
  audioCtx: AudioContext
  processor: ScriptProcessorNode
  stream: MediaStream
}

export async function startMicCapture(
  onChunk: (base64: string) => void
): Promise<AudioCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

  const audioCtx = new AudioContext({ sampleRate: 16000 })
  const source = audioCtx.createMediaStreamSource(stream)
  const processor = audioCtx.createScriptProcessor(4096, 1, 1)

  source.connect(processor)
  processor.connect(audioCtx.destination)

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    const pcm16 = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff
    }
    const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
    onChunk(base64)
  }

  return { audioCtx, processor, stream }
}

export function stopMicCapture(handle: AudioCaptureHandle | null): void {
  if (!handle) return
  try { handle.processor.disconnect() } catch {}
  try { handle.stream.getTracks().forEach(t => t.stop()) } catch {}
  try { handle.audioCtx.close() } catch {}
}

export async function createPlaybackContext(): Promise<AudioContext> {
  const ctx = new AudioContext()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  return ctx
}

export function playAudioFragment(
  audioCtx: AudioContext,
  base64: string,
  nextStartTime: { current: number }
): void {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const pcm16 = new Int16Array(bytes.buffer)
    const sampleRate = 24000

    const audioBuffer = audioCtx.createBuffer(1, pcm16.length, sampleRate)
    const channel = audioBuffer.getChannelData(0)
    for (let i = 0; i < pcm16.length; i++) {
      channel[i] = pcm16[i] / 32768
    }

    const src = audioCtx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(audioCtx.destination)

    const now = audioCtx.currentTime
    if (nextStartTime.current < now) {
      nextStartTime.current = now + 0.1
    }
    src.start(nextStartTime.current)
    nextStartTime.current += audioBuffer.duration
  } catch (err) {
    console.error('[Audio] Error playing fragment:', err)
  }
}
