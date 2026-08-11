import { buildSetupMessage } from './chatSetup'

export type WebSocketCallbacks = {
  onReady: () => void
  onTranscript: (text: string) => void
  onAudioChunk: (base64: string) => void
  onTurnComplete: () => void
  onClose: () => void
  onError: (error: string) => void
}

export interface ChatUrl {
  url: string
  expiresAt: string
}

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
