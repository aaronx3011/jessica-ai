# Vera Voice Assistant

Bilingual (ES/EN) real-time voice assistant powered by Gemini Live, fronting the "Quinto Vector" podcast co-host persona. Streams PCM audio bidirectionally between browser and Gemini via a Direct Connection opened with a backend-minted Presigned URL.

## Language

**Presigned URL**:
A short-lived WebSocket URL minted by the backend for a Chat session. It embeds an Ephemeral Token so the browser can open a Direct Connection to Gemini Live without holding credentials.
_avoid_: signed URL, auth URL

**Ephemeral Token**:
A short-lived credential issued by the Gemini Live token service that lets a client authenticate directly to Gemini Live without holding a long-lived key. The backend exchanges its API key for one when minting a Presigned URL.
_avoid_: access token, API key

**Direct Connection**:
The browser's WebSocket to Gemini Live, opened with a Presigned URL. The client sends the session setup, audio, Interrupts and Turn signals over it directly.
_avoid_: raw socket, direct socket

**WebSocket Proxy** (historical):
The previous architecture in which the backend relayed all Gemini traffic between the browser and Gemini. Removed by the Direct Connection migration.
_avoid_: relay, bridge

**Interrupt**:
The act of user speech causing the assistant to stop its current audio output immediately.
_avoid_: Barge-in, override, cancel

**Turn**:
A unit of conversation during which one party speaks. Transitions are managed client-side over the Direct Connection.
_avoid_: Exchange, round

**Client Turn**:
The period during which the user is speaking and sending audio to Gemini.
_avoid_: User turn, input window

**Model Turn**:
The period during which Gemini is generating and streaming audio to the client.
_avoid_: Server turn, response window

**Turn Change**:
The transition point where speaking party changes (client → model or model → client).
_avoid_: Handoff, switch

**Turn Complete**:
A flag sent by either party indicating their turn is finished and the other may speak.
_avoid_: Done, finished

**Voice Activity Detection (VAD)**:
Client-side algorithm that distinguishes human speech from silence and steady background noise using RMS and variance analysis.
_avoid_: Voice detection, speech detection
