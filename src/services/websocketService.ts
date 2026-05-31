export type WebSocketCallbacks = {
  onReady: () => void
  onTranscript: (text: string) => void
  onAudioChunk: (base64: string) => void
  onTurnComplete: () => void
  onClose: () => void
  onError: (error: string) => void
}

export function getWebSocketUrl(token?: string | null): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/ws`
  if (token) return `${url}?token=${encodeURIComponent(token)}`
  return url
}

export function connect(url: string, callbacks: WebSocketCallbacks): WebSocket {
  const ws = new WebSocket(url)

  ws.onopen = () => {
    console.log('[WS] Conectado al servidor')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.status === 'ready') {
        callbacks.onReady()
        return
      }

      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            callbacks.onAudioChunk(part.inlineData.data)
          }
        }
      }

      if (msg.outputTranscription?.text) {
        callbacks.onTranscript(msg.outputTranscription.text)
      }

      if (msg.serverContent?.outputTranscription?.text) {
        callbacks.onTranscript(msg.serverContent.outputTranscription.text)
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
    callbacks.onError('Error de conexión con el servidor')
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
