import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

export function buildChatUrl(tokenName: string): string {
    const encoded = encodeURIComponent(tokenName);
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encoded}`;
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat-url', async (_req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
            return;
        }
        const client = new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const token = await client.authTokens.create({
            config: { uses: 1, expireTime: expiresAt },
        });
        if (!token.name) {
            throw new Error('El servicio de tokens no devolvió un token');
        }
        res.json({
            url: buildChatUrl(token.name),
            expiresAt,
        });
    } catch (err) {
        console.error('❌ [Chat URL] Error al generar URL de chat:', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'No se pudo generar la URL de chat' });
    }
});

app.use((req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

const server = app.listen(port, () => {
  console.log(`🚀 Servidor Realtime en http://localhost:${port}`);
});
