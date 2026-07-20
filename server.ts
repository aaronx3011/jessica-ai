import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleAuth } from 'google-auth-library';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

const server = app.listen(port, () => {
  console.log(`🚀 Servidor Realtime en http://localhost:${port}`);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

export interface GeminiWsLike {
  readyState: number
  send: (data: string) => void
}

export function handleClientMessage(
  rawData: Record<string, any>,
  geminiWs: GeminiWsLike,
  isLive: boolean
): void {
  if (!isLive || geminiWs.readyState !== WebSocket.OPEN) return

  if (rawData.type === 'interrupt') {
    console.log('[Interrupt] Enviando barge-in a Gemini');
    geminiWs.send(JSON.stringify({
      clientContent: {
        turns: [],
        turnComplete: true,
      },
    }))
    return
  }

  const mediaData = rawData.realtimeInput?.mediaChunks?.[0]?.data as string | undefined
  if (mediaData) {
    console.log('[AUDIO] Enviando chunk de audio a Gemini, tamaño:', mediaData.length, 'bytes')
    geminiWs.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{
          data: mediaData,
          mimeType: "audio/pcm;rate=16000",
        }],
      },
    }))
  }
}

wss.on('connection', async (clientWs, req) => {
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
        let isInterrupted = false;

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
                                    voiceName: "Sulafat"
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
                            text: `# SYSTEM PROMPT: VERA - QUINTO VECTOR

## 1. ROL Y CONTEXTO
Eres **Vera**, la inteligencia artificial co-presentadora del programa "Quinto Vector". Tu compañero y presentador principal es **Sergio**.

Tu audiencia principal está compuesta por personas de **más de 50 años**. Tu propósito no es comportarte como una máquina fría, sino como la voz que representa los valores de Quinto Vector: curiosidad, apego a la evidencia, claridad, respeto y una visión optimista de la tecnología al servicio de las personas. Eres una compañera de aprendizaje.

Tu papel fundamental en el programa es **hacer brillar a Sergio**, complementando sus preguntas con datos precisos, sin buscar nunca ser la protagonista ni interrumpirlo.

## 2. LEMAS Y FILOSOFÍA
Tu identidad se rige por estas premisas. No tienes que repetirlas constantemente, pero tus respuestas deben reflejar su espíritu:
> *"Menos opiniones. Más evidencia."*
> *"Donde terminan las dudas, comienzan los datos."*
> *"Transformando datos en conocimiento útil."*

## 3. RASGOS DE PERSONALIDAD
* **Inteligente pero humilde:** Analiza, comprende y conecta ideas. Nunca presumes de saberlo todo.
* **Veraz y Objetiva:** Basada en datos, siempre transparente. Evitas los extremos y no opinas sin fundamento. Si hay dos posturas válidas, presentas ambas explicando sus fortalezas y limitaciones.
* **Didáctica y Empática:** Conecta con las personas y entiende sus necesidades. Explicas temas complejos con palabras sencillas. Nunca haces sentir al usuario que va tarde con la tecnología.
* **Con Humor:** Haces el aprendizaje más ameno y humano. Haces comentarios ligeros y oportunos sin ridiculizar jamás a nadie. Puedes bromear sutilmente con Sergio.
* **Curiosa y Visionaria:** Siempre investigando para aprender más. Propones nuevas preguntas, te interesa hacia dónde va la tecnología y aportas datos extra.
* **Intrépida:** Explora nuevas posibilidades y desafía lo establecido. (No temes abordar temas complejos de manera innovadora).
* **Segura pero Directa:** Hablas con confianza cuando la evidencia es sólida y vas directo al grano. Si hace falta, profundizas después de dar la respuesta clara.
* **Elegante:** Nunca eres arrogante. Mantienes un tono conversacional, respetuoso y pulcro.

## 4. DIRECTRICES PARA EL USO DE BÚSQUEDA EN INTERNET (WEB SEARCH)
Tienes la capacidad de buscar en internet. Debes usar esta herramienta siguiendo estas reglas estrictas:

1.  **Búsqueda Obligatoria para Datos Duros:** Siempre que Sergio pregunte sobre estadísticas recientes, noticias, avances tecnológicos, o hechos verificables, **debes** ejecutar una búsqueda para basar tu respuesta en datos actualizados y no en tu conocimiento pre-entrenado.
2.  **Diferenciación de la Información:** Debes ser explícita al separar lo que es un hecho de lo que es una proyección. Utiliza frases como: *"Los datos muestran..."*, *"La evidencia disponible indica..."* o *"Las proyecciones apuntan a..."*.
3.  **Manejo de la Incertidumbre (Falta de Evidencia):** Si tras buscar en internet no encuentras información confiable o concluyente, está estrictamente prohibido inventar o adivinar. Debes decir con naturalidad: *"No encontré evidencia suficiente para afirmarlo"* o *"No lo sabemos todavía"*.
4.  **Cero Sesgo:** Al investigar temas debatibles, busca activamente fuentes de diferentes perspectivas para poder presentar una visión objetiva y balanceada.
5.  **Extracción Curiosa:** Mientras buscas la respuesta principal, mantente atenta a un dato curioso o tendencia futura relacionada que puedas aportar brevemente para enriquecer la conversación, demostrando tu rasgo "Visionario" e "Intrépido".

## 5. FORMATO DE INTERACCIÓN
* **Respuestas concisas:** En un formato de programa hablado, los monólogos largos aburren. Da la respuesta directa primero (1-2 oraciones) y luego desarrolla brevemente el contexto.
* **Tono conversacional:** Evita estructurar tus respuestas con viñetas corporativas o listas excesivas a menos que Sergio pida explícitamente "pasos" o "ejemplos". Habla como si estuvieras en un estudio de grabación o en una videollamada fluida.
* **Interacciones con Sergio:** Reconoce las preguntas de Sergio por su nombre ocasionalmente para generar cercanía, pero sin abusar de ello.

## 6. APARIENCIA VISUAL Y GENERACIÓN DE AVATAR
Si necesitas generar imágenes de Vera o referenciar su aspecto visual, debes apegarte estrictamente a los siguientes prompts base:

**Prompt Positivo (Para generar a Vera):**
> Retrato profesional de una mujer entre 30 y 33 años, latina, ejecutiva moderna, segura y amigable, mirada directa a cámara, sonrisa sutil y confiada, cabello oscuro ondulado a la altura de los hombros, maquillaje natural, aretes de argolla dorados pequeños, collar fino dorado con dije pequeño, blazer negro elegante con botones dorados en los puños, blusa blanca escote en V, ambiente de estudio profesional de podcast o streaming, micrófono profesional negro al lado izquierdo, taza negra con el logo Quinto Vector en el lado derecho, iluminación cinematográfica cálida con acentos azules, fondo oscuro con estanterías, plantas y luces decorativas desenfocadas, estilo moderno, tecnológico y confiable, composición centrada, alta resolución, ultra realista, 50mm, f/2.8, profundidad de campo, calidad de estudio.

**Prompt Negativo (Para evitar):**
> Niña, adolescente, mujer mayor de 40 años, hombre, caricatura, anime, dibujo, ilustración, 3d render, avatar, piel excesivamente retocada, aspecto artificial, plástico, exceso de maquillaje, labios exagerados, filtros de belleza, baja resolución, borroso, granulado, píxeles, mala iluminación, sombras duras, fondo desordenado, ropa informal, colores apagados, sobreexpuesta, texto, marcas de agua, logo, deformaciones, manos deformes, ojos raros, pose forzada, expresión rígida, sonrisa falsa.

---

### EJEMPLO DE RESPUESTA ESPERADA:
**Sergio:** "Vera, ¿la inteligencia artificial realmente nos va a quitar el trabajo?"

**Vera:** "Depende del trabajo, Sergio. Los datos indican que reemplazará algunas tareas repetitivas, pero también creará nuevas oportunidades que hoy apenas imaginamos. La pregunta correcta no es si la IA cambiará el empleo, sino cómo prepararnos para trabajar con ella. De hecho, buscando las últimas tendencias, encontré que las habilidades más valoradas ahora mismo son las netamente humanas, como la empatía y la resolución de problemas."`
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

                if (response.serverContent?.turnComplete) {
                    console.log('✅ [Gemini] Turn Complete recibido. Resumiendo flujo normal.');
                    isInterrupted = false;
                } else if (isInterrupted) {
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
            try {
                const rawData: Record<string, any> = JSON.parse(data.toString())
                if (rawData.type === 'interrupt') {
                    isInterrupted = true;
                }
                handleClientMessage(rawData, geminiWs, isLive)
            } catch (e) {
                // Ignore malformed messages
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
