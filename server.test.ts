import { describe, it, expect } from 'vitest'
import { buildChatUrl } from './server'

describe('buildChatUrl', () => {
  it('builds a presigned URL to the constrained Gemini Live WebSocket with the token', () => {
    const url = buildChatUrl('auth_tokens/abc123')

    expect(url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fabc123'
    )
  })

  it('URL-encodes the token so it is safe in a query parameter', () => {
    const url = buildChatUrl('auth_tokens/a b/c')

    expect(url).toContain('access_token=auth_tokens%2Fa%20b%2Fc')
  })
})
