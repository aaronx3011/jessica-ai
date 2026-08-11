# Gemini Voice Chat: Jessica - The Ultimate World Cup Narrator

A real-time, bi-directional voice chat application powered by Google's **Gemini Live API** and the **Gemini 2.5 Flash Native Audio** model. 

This project brings to life **Vera**, the AI co-presenter of the "Quinto Vector" program. The browser streams raw PCM audio directly to Gemini Live over a WebSocket, using an ephemeral presigned URL minted by the backend (the API key never leaves the server).

## 🚀 Features

* **Real-Time Voice Interaction:** Full-duplex audio streaming using WebSockets and the browser's `AudioContext`.
* **Native Audio Model:** Utilizes `gemini-live-2.5-flash-native-audio` for highly expressive, low-latency voice responses.
* **Web Search Grounding:** Gemini searches the web for current data before answering factual questions.
* **Direct Connection:** The browser connects straight to Gemini Live; the server only mints the ephemeral token/presigned URL.
* **Docker-Ready:** Structured for easy containerization and deployment to production environments.

## 📋 Prerequisites

Before running the project, you will need:
1. **Node.js** (v20+ recommended)
2. **A Gemini API key** from Google AI Studio: https://aistudio.google.com/apikey

## ⚙️ Environment Variables

Create a `.env` file in the root directory and add your Google configuration:

```env
PORT=3000
GEMINI_API_KEY=your-google-ai-studio-api-key
```

## 🛠️ Local Development

1. Install Dependencies:
    ```Bash

    npm install
    ```

2. Add your `GEMINI_API_KEY` to `.env` (see `.env.example`).

3. Start the Development Server:
    ``` Bash

    npm run dev
    ```

    The server will start at http://localhost:3000.

## 🐳 Production Deployment (Docker)

This application is designed to be deployed using Docker, ensuring that secrets and keys are securely passed at runtime rather than baked into the image.

1. Build the Image:

   ```Bash

    docker build -t gemini-voice-chat:latest .
    ```

2. Run the Container:
    Ensure your .env file (with `GEMINI_API_KEY`) is securely located on your host server.
   ```Bash

    docker run -d \
      --name jessica-server \
      -p 3000:3000 \
      --env-file /path/to/secure/.env \
      gemini-voice-chat:latest

```
> Note: For production environments, ensure you place a reverse proxy (like Nginx or Caddy) in front of the container to handle SSL/HTTPS, as browsers require HTTPS for microphone access.

## 📁 Project Structure

    server.ts: The Express server that serves the static frontend and mints the ephemeral Gemini Live presigned URL (`POST /api/chat-url`).

    public/index.html: The frontend client that captures microphone input via ScriptProcessor, converts it to base64 PCM16, and plays incoming audio chunks.

    package.json: Project dependencies and scripts.

✍️ Author

Developed by aaronx3011.
