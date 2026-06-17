# Gemini Voice Chat: Jessica - The Ultimate World Cup Narrator

A real-time, bi-directional voice chat application powered by Google Cloud's Vertex AI and the **Gemini 2.5 Flash Native Audio** model. 

This project brings to life **Jessica**, an AI-driven senior sports narrator and world-renowned expert on football and the FIFA World Cup. The application streams raw PCM audio directly between the browser and Vertex AI via WebSockets, utilizing a Retrieval-Augmented Generation (RAG) corpus for deep, accurate historical football data.

## 🚀 Features

* **Real-Time Voice Interaction:** Full-duplex audio streaming using WebSockets and the browser's `AudioContext`.
* **Native Audio Model:** Utilizes `gemini-live-2.5-flash-native-audio` for highly expressive, low-latency voice responses.
* **Vertex AI RAG Integration:** Connects to a Google Cloud Vertex AI Rag Corpus to ensure historical accuracy and prevent hallucinations regarding sports statistics.
* **Bilingual Persona:** Jessica dynamically responds in English or Spanish with high-energy sports commentary flair.
* **Docker-Ready:** Structured for easy containerization and deployment to production environments.

## 📋 Prerequisites

Before running the project, you will need:
1. **Node.js** (v20+ recommended)
2. **Google Cloud Project** with the following enabled:
   * Vertex AI API
   * A populated RAG Corpus (Vertex AI Search/Agent Builder)
3. **Google Cloud Service Account** with the **Vertex AI User** role. Download the JSON key for this account.

## ⚙️ Environment Variables

Create a `.env` file in the root directory and add your Google Cloud configuration:


```env
PORT=3000
PROJECT_ID=your-google-cloud-project-id
LOCATION=your-gcp-region (e.g., us-central1)
# Internet search via Google Search Grounding (no additional config needed)
```

## 🛠️ Local Development

1. Install Dependencies:
    ```Bash

    npm install
    ```

2. Authenticate with Google Cloud:
    Set the path to your downloaded Service Account JSON key:

    ```Bash

    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account.json"
    ```

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
    Ensure your .env file and service-account.json are securely located on your host server. Mount the JSON key as a read-only volume.
   ```Bash

    docker run -d \
      --name jessica-server \
      -p 3000:3000 \
      --env-file /path/to/secure/.env \
      -e GOOGLE_APPLICATION_CREDENTIALS="/app/secrets/service-account.json" \
      -v /path/to/host/service-account.json:/app/secrets/service-account.json:ro \
      gemini-voice-chat:latest

```
> Note: For production environments, ensure you place a reverse proxy (like Nginx or Caddy) in front of the container to handle SSL/HTTPS, as browsers require HTTPS for microphone access.

## 📁 Project Structure

    server.ts: The Express server handling WebSocket upgrades, Google Cloud authentication, and Vertex AI BidiGenerateContent streams.

    public/index.html: The frontend client that captures microphone input via ScriptProcessor, converts it to base64 PCM16, and plays incoming audio chunks.

    package.json: Project dependencies and scripts.

✍️ Author

Developed by aaronx3011.
