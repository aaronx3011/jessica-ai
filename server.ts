import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { GoogleAuth } from 'google-auth-library';
import { connectDB } from './src/db';
import authRouter from './src/auth';

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

app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET!,
  name: 'connect.sid',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600,
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

app.use('/auth', authRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`🚀 Servidor Realtime en http://localhost:${port}`);
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const reqUrl = new URL(req.url!, `http://${req.headers.host}`);
      if (reqUrl.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      sessionMiddleware(req as any, {} as any, () => {
        const query = reqUrl.searchParams;
        const token = query.get('token');
        let userId = (req as any).session?.userId;

        if (!userId && token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
            userId = decoded.userId;
          } catch {
            // Invalid JWT
          }
        }

        if (!userId) {
          console.warn('[WS] Unauthenticated WebSocket connection rejected');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
    });

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

            const ragCorpus = `projects/${PROJECT_ID}/locations/${LOCATION}/ragCorpora/${RAG_CORPUS_ID}`;
            console.log('[RAG] Configurando búsqueda en corpus:', ragCorpus);

            const setupMessage = {
                setup: {
                    // 👈 Vertex requires the full path to the model
                    model: `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio`,
                    generationConfig: {
                        responseModalities: ["audio"]
                    },
                    output_audio_transcription: {},
                    tools: [
                        {
                            retrieval: {
                                vertex_rag_store: {
                                    rag_resources: [
                                        {
                                            rag_corpus: ragCorpus
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    systemInstruction: {
                        parts: [{
                            text: `
...
                            `
                        }]
                    }
                }
            };
            console.log('[RAG] Setup message enviado a Gemini');
            geminiWs.send(JSON.stringify(setupMessage));
        });




        geminiWs.on('unexpected-response', (req, res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                console.error('🚫 Error detallado de Google:', body);
            });
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

                if (response.toolCall) {
                    console.log('[TOOL] Gemini solicitó herramienta:', JSON.stringify(response.toolCall, null, 2));
                }

                if (response.toolCallCancellation) {
                    console.log('[TOOL] Gemini canceló llamada a herramienta:', JSON.stringify(response.toolCallCancellation, null, 2));
                }

                if (response.serverContent) {
                    const sc = response.serverContent;
                    if (sc.groundingMetadata) {
                        const ragData = JSON.stringify(sc.groundingMetadata, null, 2);
                        const safePayload = ragData.substring(0, 2500);
                        console.log('[RAG] Grounding metadata recibido:', safePayload);
                    }
                    if (sc.modelTurn?.parts) {
                        for (const part of sc.modelTurn.parts) {
                            if (part.functionCall) {
                                console.log('[TOOL] FunctionCall en modelTurn:', JSON.stringify(part.functionCall, null, 2));
                            }
                            if (part.executableCode) {
                                console.log('[TOOL] ExecutableCode en modelTurn:', JSON.stringify(part.executableCode, null, 2));
                            }
                            if (part.codeExecutionResult) {
                                console.log('[TOOL] CodeExecutionResult:', JSON.stringify(part.codeExecutionResult, null, 2));
                            }
                        }
                    }
                    if (sc.inputTranscription?.text) {
                        console.log('[STT] Transcripción de entrada:', sc.inputTranscription.text);
                    }
                    if (sc.outputTranscription?.text) {
                        console.log('[TTS] Transcripción de salida:', sc.outputTranscription.text);
                    }
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

                    if (rawData.realtimeInput?.mediaChunks?.[0]?.data) {
                        const chunkSize = rawData.realtimeInput.mediaChunks[0].data.length;
                        console.log('[AUDIO] Enviando chunk de audio a Gemini, tamaño:', chunkSize, 'bytes');
                    }

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



        geminiWs.on('error', (err) => {
            console.error('❌ [Gemini WebSocket Error]:', err.message);
        });
        console.log(`Config: Project: ${PROJECT_ID}, Location: ${LOCATION}, RAG: ${RAG_CORPUS_ID}`);

        geminiWs.on('close', (code, reason) => {
            console.warn(`⚠️ [Gemini] Conexión cerrada (${code}): ${reason}`);
            console.warn(`${reason}`);
            isLive = false;
            clientWs.close();
        });

        clientWs.on('error', (err) => console.error('🔥 [Gemini] Error:', err.message));
        clientWs.on('close', () => geminiWs.close());

    } catch (authError) {
        console.error('❌ Error de Autenticación con Google Cloud:', authError instanceof Error ? authError.message : authError);
        clientWs.close();
    }
  });
})
.catch((err) => {
  console.error('❌ [Server] Failed to start:', err);
  process.exit(1);
});
