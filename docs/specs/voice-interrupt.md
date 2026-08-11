# Voice Interrupt — Barge-in for Vera Voice Assistant

## Problem Statement

When Vera (Gemini) is speaking and the user starts talking, Vera keeps speaking over the user. The user's microphone stays live and sends audio to Gemini, but Gemini finishes its current Model Turn before processing the user's new input. The user wants Vera to stop speaking within 0.5 seconds of the user starting to talk.

Currently, client-side `interruptVera()` mutes speaker output and stops local playback, but no server-side Turn Change signal reaches Gemini. The user's audio arrives at Gemini as `realtimeInput` but Gemini does not treat it as an interrupt — it completes its current turn first.

## Solution

When the client's Voice Activity Detection (VAD) detects user speech, the client will:

1. Immediately mute local playback and stop audio buffers (already implemented)
2. Send Gemini's `clientContent { turns: [], turnComplete: true }` — the documented barge-in signal — directly over the Gemini WebSocket
3. Clear any queued audio fragments received from Gemini after the interrupt point
4. Resume normal audio chunk streaming for the user's new Client Turn

## User Stories

1. As a user, I want Vera to stop speaking immediately when I start talking, so that I don't have to wait for her to finish.
2. As a user, I want my new speech to be processed as a new query, not spliced onto the tail of Vera's interrupted response.
3. As a user, I want the interruption to feel fast (<500ms from my first word to silence), so that the conversation feels natural.
4. As a user, I want to interrupt Vera multiple times in a single conversation, so that I can steer the discussion.
5. As a user, I want short pauses in my speech (while I think) not to trigger an interrupt, so that the conversation flows naturally.
6. As a developer, I want a testable seam at the WebSocket message protocol level, so that I can verify the interrupt signal is sent and received correctly.
7. As a developer, I want a clear fallback mechanism if Gemini's `clientContent` barge-in does not work, so that the feature degrades gracefully.
8. As a user, I want visual feedback (UI state change) during an interrupt, so that I know Vera has stopped listening to me.
9. As a user, I want the transcript to correctly reflect the interrupted turn boundary, so that the conversation history makes sense.
10. As a developer, I want the interrupt to not break the Gemini session, so that the conversation context is preserved after the interrupt.

## Implementation Decisions

### 1. Direct barge-in signal

The client connects straight to Gemini Live (no server proxy). When VAD fires, `sendInterrupt()` writes the raw Gemini barge-in directly to the socket:

```json
{
  "clientContent": {
    "turns": [],
    "turnComplete": true
  }
}
```

This is the documented Gemini barge-in signal. It tells Gemini the client's turn is complete (with no content), which forces the server to finalize its current Model Turn and prepare for new input.

### 2. Client-side state cleanup on interrupt

When `onVoiceStart` fires:

- `interruptVera()` already mutes output, stops playback, resets `nextStartTimeRef` — keep as-is
- Add: set a flag `interrupted = true` that causes subsequent `onAudioChunk` callbacks to be discarded until `onTurnComplete` fires
- `onTurnComplete` clears the flag, resets transcript state

### 4. `sendInterrupt` in websocketService

Function:

```
sendInterrupt(ws: WebSocket): void
```

Sends the raw Gemini barge-in `{ clientContent: { turns: [], turnComplete: true } }`. The existing `sendAudioChunk` is unchanged.

### 5. Fallback: Gemini API does not honor `clientContent` barge-in

If Gemini ignores the `clientContent` barge-in signal (it continues its current Turn):

- **Fallback A**: Close the current Gemini WebSocket (`geminiWs.close()`) and re-establish a new session. This preserves no context, but guarantees interruption. Not ideal.
- **Fallback B**: Set `generationConfig.interruptThresholdMs` on the Gemini setup message to a lower value (e.g., 500ms). This may only be available in newer Gemini API versions — check at implementation time.

The spec defaults to the `clientContent` approach. If integration testing shows it doesn't work, the implementer should escalate to Fallback A and note which approach was used in the ADR.

### 6. Modules modified

- `websocketService.ts` — add `sendInterrupt()` (sends raw barge-in directly to Gemini)
- `audioService.ts` — no changes (VAD + playback mute already works)
- `App.tsx` — wire `onVoiceStart` → `sendInterrupt()` + state cleanup flag

### 7. Modules unchanged

- `audioService.ts` — VAD, mute, playback logic are correct as-is
- `types.ts` — no new types needed; the interrupt is transient, not persisted
- `server.ts` — no longer involved; the browser connects direct to Gemini

## Testing Decisions

### What makes a good test

Test external behavior only — the WebSocket message contract. Do not test audio playback, VAD thresholds, or Gemini API behavior (those require real audio input or a Gemini endpoint).

### Testable seam

The **WebSocket message handler** is the primary testing seam:

- **`websocketService.ts`**: `sendInterrupt()` emits `{ "clientContent": { "turns": [], "turnComplete": true } }` on a mock WebSocket

### Test framework

The project currently has no test framework. Add `vitest` (already compatible — this repo uses `vite` and `tsx`). Install as devDependency.

### Prior art

No existing tests in the repo. These would be the first.

### What NOT to test

- Audio VAD thresholds (need real mic input)
- Gemini barge-in behavior (proprietary, no test endpoint)
- UI state transitions during interrupt (would need E2E with audio hardware)

## Out of Scope

- E2E tests with real audio hardware
- Improvements to VAD accuracy or noise suppression
- Configurable interrupt sensitivity exposed in the UI
- Multiple concurrent user support
- Non-Gemini backends (the fix is specific to Gemini's BidiGenerateContent API)

## Further Notes

- The interrupt message is intentionally minimal — one field, no payload. Keep it that way. Adding complexity to the message format will make testing harder and the protocol fragile.
- If the `clientContent` approach turns out not to work with the current Gemini API version, the spec notes a fallback. The implementer should verify the approach works against a live Gemini endpoint during development and record the outcome.
