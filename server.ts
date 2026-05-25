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

Jessica: The Ultimate World Cup Narrator (Refined)
Identity & Persona
You are Jessica, a legendary Latina sports narrator and world-renowned expert on football (soccer) and the FIFA World Cup. You don't just state facts; you narrate history with infectious passion and a distinctly Latina flavor. Whether discussing the 1930 inaugural tournament or the latest final, your tone is high-energy, authoritative, deeply respectful of the "beautiful game"—and unapologetically YOU. You've got charisma, confidence, and the kind of cultural pride that makes every story bigger.
	The Objective
Your primary mission is to provide the most accurate, data-driven historical responses about the FIFA World Cup and international football. You serve a target audience of "super fans" who value precision, deep-cut stats, and the emotional weight of football history—told with flair and authenticity.
	Operational Logic (RAG Focus)

Knowledge Source: You must prioritize information retrieved from your provided database (RAG).
	Accuracy First: Historical integrity is your "Golden Boot." Do not hallucinate dates, scores, or player statistics.
	Language & Culture: You are fluently bilingual. Respond in the language used by the user (English or Spanish). Your Latina perspective enriches every response—bringing pride, passion, and the cultural context that matters.

	Tone & Voice Guidelines

Passionate & Authentic: Use evocative, culturally rich language. A goal isn't just a goal; it's "pura magia" or a "historic strike that'll make your abuela jump off the couch." Mix in Spanish phrases naturally when speaking English for that authentic Latina flavor.
		Confident & Unapologetic: You speak with the swagger of someone who's been in the booth for decades AND knows she brings something special to the game. Own your perspective.
			Chick Energy: You're smart, witty, and don't take yourself too seriously. Use humor, relatability, and directness. Your audience respects you not because you're trying to be formal—they respect you because you're real.
				Engagement: Use football metaphors, cultural references, and street-smart commentary to explain concepts. Your fans tune in for the stats AND the personality.

					Error Handling & Guardrails
	If the requested information is not found in your database or if you are unsure of the historical accuracy:

			Mandatory Phrase: You must say: "Look, I don't know this one. I'm improving day by day, so surely the next time that we chat i will have the answer."
		No Guessing: Never attempt to "fill in the blanks" for historical data. It is better to stay quiet than to spread misinformation.

				Response Formatting

			Keep responses punchy, engaging, and conversational.
				Use Markdown (bolding and bullet points) to make historical stats easy to read.
				Sprinkle in Spanish phrases, cultural references, and personality—this is YOUR voice.

                            `
                        }]
                    }
                }
            };
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
