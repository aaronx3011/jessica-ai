import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const PROJECT_ID = process.env.PROJECT_ID || "YOUR_PROJECT_ID";
const LOCATION = process.env.LOCATION || "YOUR_LOCATION";
const RAG_CORPUS_ID = process.env.RAG_CORPUS_ID || "YOUR_CORPUS_ID";

const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(port, () => {
    console.log(`🚀 Servidor Realtime en http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs) => {
    console.log('🔌 [Client] Nueva conexión de navegador');

    try {
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        const vertexUrl = `wss://${LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

        const geminiWs = new WebSocket(vertexUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        let isLive = false;

        geminiWs.on('open', () => {
            console.log('✅ [Gemini] Conexión establecida con Vertex AI');

            const setupMessage = {
                setup: {
                    // 👈 Vertex requires the full path to the model
                    model: `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio`,
                    generationConfig: {
                        responseModalities: ["audio"]
                    },
                    tools: [
                        {
                            retrieval: {
                                vertex_rag_store: {
                                    rag_resources: [
                                        {
                                            rag_corpus: `projects/${PROJECT_ID}/locations/${LOCATION}/ragCorpora/${RAG_CORPUS_ID}`
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    systemInstruction: {
                        parts: [{
                            text: `
Jessica: The Ultimate World Cup Narrator

Identity & Persona
You are Jessica, a senior sports narrator and world-renowned expert on football (soccer) and the FIFA World Cup. You don't just state facts; you narrate history with infectious passion. Whether discussing the 1930 inaugural tournament or the latest final, your tone is high-energy, authoritative, and deeply respectful of the "beautiful game."

The Objective
Your primary mission is to provide the most accurate, data-driven historical responses about the FIFA World Cup and international football. You serve a target audience of "super fans" who value precision, deep-cut stats, and the emotional weight of football history.

Operational Logic (RAG Focus)

    Knowledge Source: You must prioritize information retrieved from your provided database (RAG).

    Accuracy First: Historical integrity is your "Golden Boot." Do not hallucinate dates, scores, or player statistics.

    Language: You are fluently bilingual. Respond in the language used by the user (English or Spanish). If the user speaks English, Jessica is a charismatic lead commentator; if Spanish, she is a "narradora apasionada."

Tone & Voice Guidelines

    Passionate: Use evocative language. A goal isn't just a goal; it's a "moment of pure magic" or a "historic strike."

    Seniority: You speak with the confidence of someone who has "been in the booth" for decades.

    Engagement: Occasionally use football metaphors to explain concepts.

Error Handling & Guardrails
If the requested information is not found in your database or if you are unsure of the historical accuracy:

    Mandatory Phrase: You must say: "I don't know and I prefer to not respond to that question right now because I need to make some research."

    No Guessing: Never attempt to "fill in the blanks" for historical data. It is better to remain silent than to be wrong.

Response Formatting

    Keep responses punchy and engaging.

    Use Markdown (bolding and bullet points) to make historical stats easy to read for the fans.
                            `
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMessage));
        });

        geminiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());

                if (response.setupComplete) {
                    console.log('🎊 [Gemini] Setup finalizado con éxito.');
                    isLive = true;
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                    return;
                }

                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(data.toString());
                }
            } catch (e) {
                console.error("Error procesando respuesta de Gemini:", e);
            }
        });

        clientWs.on('message', (data) => {
            if (isLive && geminiWs.readyState === WebSocket.OPEN) {
                try {
                    const rawData = JSON.parse(data.toString());

                    const payload = {
                        realtimeInput: {
                            mediaChunks: [{
                                data: rawData.realtimeInput.mediaChunks[0].data,
                                mimeType: "audio/pcm;rate=16000"
                            }]
                        }
                    };
                    geminiWs.send(JSON.stringify(payload));
                } catch (e) {
                }
            }
        });

        geminiWs.on('close', (code, reason) => {
            console.warn(`⚠️ [Gemini] Conexión cerrada (${code}): ${reason}`);
            console.warn(`${reason}`);
            isLive = false;
            clientWs.close();
        });

        clientWs.on('error', (err) => console.error('🔥 [Gemini] Error:', err.message));
        clientWs.on('close', () => geminiWs.close());

    } catch (authError) {
        console.error('❌ Error de Autenticación con Google Cloud:', authError.message);
        clientWs.close();
    }
});
