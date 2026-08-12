export type AudioCaptureHandle = {
  audioCtx: AudioContext
  processor: ScriptProcessorNode
  stream: MediaStream
}

const VOICE_HOLD_CHUNKS = 12
const CHUNK_SIZE = 1024

export async function startMicCapture(
  onChunk: (base64: string) => void,
  onNoiseDetected?: (noisy: boolean) => void,
  onLevel?: (rms: number) => void,
  onVoiceStart?: () => void,
  voiceStartMinRms?: number,
  onSpeakingChange?: (isSpeaking: boolean) => void
): Promise<AudioCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { noiseSuppression: true, echoCancellation: true },
    video: false,
  })

  const audioCtx = new AudioContext({ sampleRate: 16000 })
  const source = audioCtx.createMediaStreamSource(stream)
  const processor = audioCtx.createScriptProcessor(CHUNK_SIZE, 1, 1)

  source.connect(processor)
  processor.connect(audioCtx.destination)

  let rmsWindow: number[] = []
  let noiseFloor = 0
  let lastNoisy = false
  let noisyChunks = 0
  let voiceHangover = 0

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)

    let sumSq = 0
    for (let i = 0; i < input.length; i++) {
      sumSq += input[i] * input[i]
    }
    const rms = Math.sqrt(sumSq / input.length)
    if (onLevel) onLevel(rms)

    let suppressChunk = false

    if (onNoiseDetected) {
      const prevVoiceHangover = voiceHangover

      if (noiseFloor === 0) {
        noiseFloor = rms
      } else if (rms < noiseFloor) {
        noiseFloor = rms
      } else {
        noiseFloor += (rms - noiseFloor) * 0.01
      }

      rmsWindow.push(rms)
      if (rmsWindow.length > 16) rmsWindow.shift()

      if (rmsWindow.length >= 8) {
        const avg = rmsWindow.reduce((a, b) => a + b, 0) / rmsWindow.length
        const variance = rmsWindow.reduce((sum, v) => sum + (v - avg) ** 2, 0) / rmsWindow.length

        const minRms = voiceStartMinRms !== undefined ? voiceStartMinRms : 0.01
        const isVoice = rms > noiseFloor * 3 && rms > minRms * 0.5
        const isSteadyNoise = variance < 0.00005 && avg > Math.max(0.02, noiseFloor * 2)

        if (isVoice) {
          voiceHangover = VOICE_HOLD_CHUNKS
          noisyChunks = Math.max(0, noisyChunks - 1)
        } else if (voiceHangover > 0) {
          voiceHangover--
        }

        if (isSteadyNoise && !isVoice && voiceHangover === 0) {
          suppressChunk = true
          noisyChunks++
        } else if (!isVoice) {
          noisyChunks = Math.max(0, noisyChunks - 1)
        }

        const noisy = noisyChunks > 12
        if (noisy !== lastNoisy) {
          lastNoisy = noisy
          onNoiseDetected(noisy)
        }

        if (onVoiceStart && prevVoiceHangover === 0 && voiceHangover > 0) {
          if (voiceStartMinRms === undefined || rms > voiceStartMinRms) {
            onVoiceStart()
          }
        }
        
        if (onSpeakingChange && (prevVoiceHangover > 0) !== (voiceHangover > 0)) {
          onSpeakingChange(voiceHangover > 0)
        }
      }
    }

    if (suppressChunk) {
      const silent = new Int16Array(input.length)
      onChunk(btoa(String.fromCharCode(...new Uint8Array(silent.buffer))))
    } else {
      const pcm16 = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff
      }
      onChunk(btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer))))
    }
  }

  return { audioCtx, processor, stream }
}

export function stopMicCapture(handle: AudioCaptureHandle | null): void {
  if (!handle) return
  try { handle.processor.disconnect() } catch {}
  try { handle.stream.getTracks().forEach(t => t.stop()) } catch {}
  try { handle.audioCtx.close() } catch {}
}

let masterGain: GainNode | null = null

export async function createPlaybackContext(): Promise<AudioContext> {
  const ctx = new AudioContext()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  masterGain = ctx.createGain()
  masterGain.connect(ctx.destination)
  return ctx
}

export function muteOutput(): void {
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(0);
    masterGain.gain.setValueAtTime(0, masterGain.context.currentTime);
    masterGain.gain.value = 0;
  }
}

export function unmuteOutput(): void {
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(0);
    masterGain.gain.setValueAtTime(1, masterGain.context.currentTime);
    masterGain.gain.value = 1;
  }
}

const activeSources = new Set<AudioBufferSourceNode>()

const MAX_QUEUE_AHEAD_SECONDS = 2

export function stopPlayback(): void {
  for (const src of activeSources) {
    try { 
      src.onended = null;
      src.stop(0); 
    } catch {}
    try { src.disconnect() } catch {}
  }
  activeSources.clear()
}

export function playAudioFragment(
  audioCtx: AudioContext,
  base64: string,
  nextStartTime: { current: number }
): void {
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }

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
    src.connect(masterGain ?? audioCtx.destination)
    activeSources.add(src)
    src.onended = () => activeSources.delete(src)

    const now = audioCtx.currentTime
    const queueAhead = nextStartTime.current - now
    if (queueAhead < 0 || queueAhead >= MAX_QUEUE_AHEAD_SECONDS) {
      nextStartTime.current = now + 0.1
    }
    src.start(nextStartTime.current)
    nextStartTime.current += audioBuffer.duration
  } catch (err) {
    console.error('[Audio] Error playing fragment:', err)
  }
}
