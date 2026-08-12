import { buildSetupMessage } from './chatSetup'

export type WebSocketCallbacks = {
  onReady: () => void
  onTranscript: (text: string) => void
  onAudioChunk: (base64: string) => void
  onTurnComplete: () => void
  onInterrupted?: () => void
  onClose: () => void
  onError: (error: string) => void
}

export interface ChatUrl {
  url: string
  expiresAt: string
}

export type SessionStatus = 'connecting' | 'ready' | 'reconnecting' | 'disconnected'

export type SessionCallbacks = WebSocketCallbacks & {
  onReconnected: () => void
  onStatus: (status: SessionStatus) => void
}

export interface SessionConfig {
  baseDelayMs?: number
  maxDelayMs?: number
  refreshBeforeMs?: number
}

export interface LiveSession {
  close: () => void
  sendAudio: (base64: string) => void
  interrupt: () => void
}

const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 15000
const DEFAULT_REFRESH_BEFORE_MS = 30000

export async function fetchChatUrl(): Promise<ChatUrl> {
  const res = await fetch('/api/chat-url', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`No se pudo obtener la URL de chat (${res.status})`)
  }
  return res.json()
}

export function connect(url: string, callbacks: WebSocketCallbacks): WebSocket {
  const ws = new WebSocket(url)

  ws.onopen = () => {
    console.log('[WS] Conectado a Gemini Live')
    ws.send(JSON.stringify(buildSetupMessage()))
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.setupComplete) {
        callbacks.onReady()
        return
      }

      if (msg.outputTranscription?.text) {
        callbacks.onTranscript(msg.outputTranscription.text)
      }

      if (msg.serverContent?.outputTranscription?.text) {
        callbacks.onTranscript(msg.serverContent.outputTranscription.text)
      }

      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            callbacks.onAudioChunk(part.inlineData.data)
          }
        }
      }

      if (msg.serverContent?.interrupted) {
        callbacks.onInterrupted?.()
      }

      if (msg.serverContent?.turnComplete) {
        callbacks.onTurnComplete()
      }
    } catch {
      console.error('[WS] Error parsing message')
    }
  }

  ws.onclose = () => {
    console.log('[WS] Conexión cerrada')
    callbacks.onClose()
  }

  ws.onerror = () => {
    console.error('[WS] Error de conexión')
    callbacks.onError('Error de conexión con Gemini Live')
  }

  return ws
}

export function sendAudioChunk(ws: WebSocket, base64: string): void {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({
    realtimeInput: {
      mediaChunks: [{
        mimeType: 'audio/pcm;rate=16000',
        data: base64,
      }],
    },
  }))
}

export function sendInterrupt(ws: WebSocket): void {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({
    clientContent: {
      turns: [],
      turnComplete: true,
    },
  }))
}

export function openLiveSession(
  fetchUrl: () => Promise<ChatUrl>,
  callbacks: SessionCallbacks,
  config: SessionConfig = {}
): LiveSession {
  const baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const refreshBeforeMs = config.refreshBeforeMs ?? DEFAULT_REFRESH_BEFORE_MS

  let disposed = false
  let socket: WebSocket | null = null
  let attempt = 0
  let generation = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshRequested = false

  function scheduleRefresh(expiresAt: string) {
    if (refreshTimer) clearTimeout(refreshTimer)
    const msToExpiry = new Date(expiresAt).getTime() - Date.now()
    const delay = Math.max(0, msToExpiry - refreshBeforeMs)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refresh()
    }, delay)
  }

  function delayFor(attemptNumber: number): number {
    const delay = baseDelayMs * 2 ** Math.max(0, attemptNumber - 1)
    return Math.min(delay, maxDelayMs)
  }

  function scheduleRetry() {
    attempt += 1
    const delay = delayFor(attempt)
    callbacks.onStatus('reconnecting')
    retryTimer = setTimeout(() => {
      retryTimer = null
      connectOnce()
    }, delay)
  }

  function connectOnce() {
    if (disposed) return
    const gen = ++generation
    callbacks.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')

    fetchUrl().then(({ url, expiresAt }) => {
      if (disposed || gen !== generation) return
      scheduleRefresh(expiresAt)
      socket = connect(url, {
        onReady: () => {
          if (gen !== generation) return
          const reconnected = attempt > 0
          attempt = 0
          callbacks.onStatus('ready')
          callbacks.onReady()
          if (reconnected) callbacks.onReconnected()
        },
        onTranscript: callbacks.onTranscript,
        onAudioChunk: callbacks.onAudioChunk,
        onTurnComplete: callbacks.onTurnComplete,
        onInterrupted: callbacks.onInterrupted,
        onClose: () => {
          if (gen !== generation) return
          socket = null
          if (disposed) return
          if (refreshRequested) refreshRequested = false
          scheduleRetry()
        },
        onError: callbacks.onError,
      })
    }).catch((error) => {
      if (disposed || gen !== generation) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
      scheduleRetry()
    })
  }

  function refresh() {
    if (disposed) return
    refreshRequested = true
    socket?.close()
  }

  function close() {
    if (disposed) return
    disposed = true
    if (retryTimer) clearTimeout(retryTimer)
    if (refreshTimer) clearTimeout(refreshTimer)
    retryTimer = null
    refreshTimer = null
    socket?.close()
    socket = null
  }

  connectOnce()

  return {
    close,
    sendAudio: (base64: string) => {
      if (socket) sendAudioChunk(socket, base64)
    },
    interrupt: () => {
      if (socket) sendInterrupt(socket)
    },
  }
}