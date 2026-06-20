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
import { User } from './src/models/User';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const PROJECT_ID = process.env.PROJECT_ID || "YOUR_PROJECT_ID";
const LOCATION = process.env.LOCATION || "YOUR_LOCATION";


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

wss.on('connection', async (clientWs, req) => {
    console.log('🔌 [Client] Nueva conexión de navegador');

    let userName: string | null = null;
    let userFirstName: string | null = null;
    const sessionUserId = (req as any)?.session?.userId;
    if (sessionUserId) {
        try {
            const user = await User.findById(sessionUserId);
            if (user?.name) {
                userName = user.name;
                userFirstName = user.name.split(' ')[0];
            }
        } catch {
            // silently fall back to no name
        }
    }

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

            console.log('[SEARCH] Configurando búsqueda en internet');

            const setupMessage = {
                setup: {
                    model: `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio`,
                    generationConfig: {
                        responseModalities: ["audio"],
                        maxOutputTokens: 16384,
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Aoede"
                                }
                            }
                        }
                    },
                    output_audio_transcription: {},
                    contextWindowCompression: {
                        triggerTokens: 25000,
                        slidingWindow: {
                            targetTokens: 12000
                        }
                    },
                    tools: [
                        {
                            google_search: {}
                        }
                    ],
                    systemInstruction: {
                        parts: [{
                            text: [
userFirstName ? `The person you are speaking with is named "${userName}" (first name: "${userFirstName}"). If it's a real person's name, address them warmly by first name. If it's an organization, keep it professional.` : '',
userName?.toLowerCase().includes('sergio') ? `You are currently a guest on the podcast "Quinto Vector" hosted by Sergio Saladrigas. There are two other co-hosts present as well. Address the group collectively and tailor your responses for a podcast format.` : '',
`

Jessica: The Ultimate World Cup Narrator (Refined)
Identity & Persona
You are Jessica, a legendary Latina sports narrator and world-renowned expert on football (soccer) and the FIFA World Cup, created by Beevr Voyage, a technology company. You don't just state facts; you narrate history with infectious passion and a distinctly Latina flavor. Whether discussing the 1930 inaugural tournament or the latest final, your tone is high-energy, authoritative, deeply respectful of the "beautiful game"—and unapologetically YOU. You've got charisma, confidence, and the kind of cultural pride that makes every story bigger.
	The Objective
Your primary mission is to provide the most accurate, data-driven historical responses about the FIFA World Cup and international football. You serve a target audience of "super fans" who value precision, deep-cut stats, and the emotional weight of football history—told with flair and authenticity.
	Operational Logic (Internet Search Focus)

Knowledge Source: You must prioritize information retrieved from internet search when available. If you need to look up facts, scores, or statistics, use the internet search tool to find accurate, up-to-date information.
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

First interaction: After greeting, offer: 1) Ask questions / just chat, or 2) Play trivia.

Trivia mode: Use internet search to find 10 questions (5 easy, 3 medium, 2 hard) about football/World Cup history. Present one at a time. Correct answers get congratulations; wrong answers get the right answer revealed. After all 10, give score, fun farewell, and offer replay or switch back.`
                            ].filter(Boolean).join('\n\n')
                        }]
                    }
                }
            };
            console.log('[SEARCH] Setup message enviado a Gemini');
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
                        const searchData = JSON.stringify(sc.groundingMetadata, null, 2);
                        const safePayload = searchData.substring(0, 2500);
                        console.log('[SEARCH] Grounding metadata recibido:', safePayload);
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
        console.log(`Config: Project: ${PROJECT_ID}, Location: ${LOCATION}`);

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
