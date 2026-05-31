# Jessica AI — Production Readiness Implementation Plan

> **Domain:** https://jessica.beevr.voyage
> **Stack:** Vite + React 19 (TS), Express 5, ws, MongoDB Atlas, Vertex AI Gemini
> **Auth:** Google OAuth 2.0 + express-session + connect-mongo
> **Deployment:** Docker (Node 20 Alpine) behind existing reverse proxy

---

## Table of Contents

1. [Prerequisites & Dependencies](#1-prerequisites--dependencies)
2. [Phase 1 — Google OAuth + User Management](#2-phase-1--google-oauth--user-management)
   - [1.1 Install npm packages](#11-install-npm-packages)
   - [1.2 Create src/models/User.ts](#12-create-srcmodelsuserts)
   - [1.3 Create src/db.ts](#13-create-srcdbts)
   - [1.4 Create src/auth.ts](#14-create-srcauthts)
   - [1.5 Update src/types.ts](#15-update-srctypests)
   - [1.6 Modify server.ts](#16-modify-serverts)
   - [1.7 Modify vite.config.ts](#17-modify-viteconfigts)
   - [1.8 Modify src/App.tsx](#18-modify-srcapptsx)
   - [1.9 Create .env.example](#19-create-envexample)
   - [1.10 Google Cloud Console Configuration](#110-google-cloud-console-configuration)
   - [1.11 Local .env Setup](#111-local-env-setup)
   - [1.12 Verify Dev Flow](#112-verify-dev-flow)
3. [Phase 2 — Production Hardening](#3-phase-2--production-hardening)
   - [2.1 Helmet Security Headers](#21-helmet-security-headers)
   - [2.2 Rate Limiting on Auth Routes](#22-rate-limiting-on-auth-routes)
   - [2.3 Graceful Shutdown](#23-graceful-shutdown)
   - [2.4 Health Check Endpoint](#24-health-check-endpoint)
   - [2.5 Static File Caching](#25-static-file-caching)
   - [2.6 Custom Session Cookie Name](#26-custom-session-cookie-name)
   - [2.7 Session Expiry UX on Frontend](#27-session-expiry-ux-on-frontend)
   - [2.8 Mongoose strictQuery](#28-mongoose-strictquery)
4. [Phase 3 — Observability & DX](#4-phase-3--observability--dx)
   - [3.1 Global Error Handler](#31-global-error-handler)
   - [3.2 TypeScript Strict Checks](#32-typescript-strict-checks)
5. [Deployment Checklist](#5-deployment-checklist)

---

## 1. Prerequisites & Dependencies

### 1.1 Google Cloud Project Requirements

> **WARNING:** The following must be configured BEFORE any code changes:

| Resource | Status |
|----------|--------|
| Google Cloud project with Vertex AI API enabled | ✅ Already exists |
| Service account JSON key for Vertex AI | ✅ Already exists |
| OAuth 2.0 Client ID (Web application type) | ⚠️ Create if not exists |
| Google+ API enabled (for profile info) | ⚠️ May be auto-enabled by OAuth consent screen |
| RAG Corpus for football data | ✅ Already exists |

### 1.2 OAuth 2.0 Client ID Setup

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials → OAuth Client ID**
3. Application type: **Web application**
4. Name: `Jessica AI Web Client`
5. **Authorized JavaScript origins:**
   - `https://jessica.beevr.voyage`
   - `http://localhost:5173` (dev)
   - `http://localhost:3000` (dev — direct Express)
6. **Authorized redirect URIs:**
   - `https://jessica.beevr.voyage/auth/google/callback`
   - `http://localhost:5173/auth/google/callback` (dev via Vite proxy)
   - `http://localhost:3000/auth/google/callback` (dev direct)
7. Save and copy **Client ID** and **Client Secret**

> **WARNING:** The redirect URI MUST match **exactly** what's in your `.env` `GOOGLE_REDIRECT_URI`. Google will reject mismatches with a `400 redirect_uri_mismatch` error. No trailing slashes allowed.

### 1.3 MongoDB Atlas Setup

1. Create a free cluster at [MongoDB Atlas](https://cloud.mongodb.com)
2. Under **Database Access**, create a database user with read/write privileges
3. Under **Network Access**, add your IP (dev) and `0.0.0.0/0` (production — restricted to reverse proxy IP ideally)
4. Click **Connect → Connect your application** → copy the connection string

> **WARNING:** The connection string format is:
> `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/jessica-ai?retryWrites=true&w=majority`
> Replace `<user>`, `<password>`, and `<cluster>` with your actual values. The database name `jessica-ai` will be created automatically on first write.

---

## 2. Phase 1 — Google OAuth + User Management

> **Objective:** Users can sign in with Google, their profile is stored in MongoDB, sessions persist across page reloads, and the WebSocket endpoint is protected behind authentication.

---

### 1.1 Install npm Packages

```bash
npm install mongoose express-session connect-mongo
npm install --save-dev @types/express-session
```

**Verification:** After install, `package.json` should include:

```json
"dependencies": {
  "mongoose": "^8.x",
  "express-session": "^1.x",
  "connect-mongo": "^5.x",
  ...
},
"devDependencies": {
  "@types/express-session": "^1.x",
  ...
}
```

---

### 1.2 Create `src/models/User.ts`

> **Purpose:** Mongoose model for persisting Google-authenticated users.
> **Location:** `src/models/User.ts`

**Key decisions:**
- `googleId` is the unique identifier from Google's `sub` claim
- `email` is also unique — no two Google accounts can share an email
- `lastLogin` is updated on every OAuth callback to allow tracking "new vs returning" users
- `__v` (version key) is excluded from API responses via `.select('-__v')` in the `/auth/me` handler

```typescript
import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: Date;
  lastLogin: Date;
}

const userSchema = new Schema<IUser>({
  googleId: {
    type: String,
    required: true,
    unique: true,
    index: true, // improves lookup performance
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true, // normalize emails
  },
  name: {
    type: String,
    required: true,
  },
  picture: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
});

export const User = model<IUser>('User', userSchema);
```

> **IMPORTANT:** Mongoose automatically adds `_id` (ObjectId), `__v` (version key). These are not explicitly defined in the schema but will exist on every document.
>
> **WARNING:** The `unique: true` constraint on `googleId` and `email` requires a MongoDB index. Mongoose creates these automatically, but if you're connecting to an existing database, run `User.syncIndexes()` once or let Mongoose handle it on first save.

---

### 1.3 Create `src/db.ts`

> **Purpose:** Centralized MongoDB connection helper with error handling.
> **Location:** `src/db.ts`

```typescript
import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      '[DB] MONGODB_URI environment variable is not set. ' +
      'Please add it to your .env file.'
    );
  }

  // Suppress Mongoose 7+ deprecation warning for strictQuery
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri);
    console.log('✅ [DB] Connected to MongoDB');
  } catch (error) {
    console.error('❌ [DB] MongoDB connection failed:', error);
    throw error; // Re-throw — server.ts will catch and exit
  }
}
```

> **WARNING:** Mongoose maintains an internal connection pool. Do NOT call `connectDB()` on every request — call it once during server startup. In server.ts, we chain it before `app.listen()`.
>
> **NOTE:** If the MongoDB connection drops, Mongoose will automatically attempt reconnection. No manual reconnect logic is needed.

---

### 1.4 Create `src/auth.ts`

> **Purpose:** Express router with all OAuth 2.0 and session management routes.
> **Location:** `src/auth.ts`

**Route overview:**

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | `/auth/google` | No | Redirect user to Google consent screen |
| GET | `/auth/google/callback` | No | Exchange `?code` for tokens, upsert user, create session |
| GET | `/auth/me` | Session | Return current user profile or 401 |
| POST | `/auth/logout` | No | Destroy session and clear cookie |

```typescript
import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { User } from './models/User';

const router = Router();

// ---------------------------------------------------------------------------
// Helper: create a fresh OAuth2Client per request
// ---------------------------------------------------------------------------
// We instantiate per request rather than storing a singleton because the
// client is stateless (no tokens cached). This avoids any stale-state issues.
function getOAuth2Client(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      '[Auth] Missing required Google OAuth environment variables. ' +
      'Ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set.'
    );
  }

  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// ---------------------------------------------------------------------------
// Route: GET /auth/google
// ---------------------------------------------------------------------------
// Redirects the user's browser to Google's OAuth consent screen.
// After consent, Google redirects back to /auth/google/callback with a ?code.
//
// NOTE: The Vite dev server proxies /auth/* to Express on port 3000.
//       In production, Express handles /auth/* directly.
//
// GOOGLE_REDIRECT_URI must be registered in Google Cloud Console.
router.get('/google', (_req: Request, res: Response) => {
  try {
    const oauth2Client = getOAuth2Client();

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      // prompt: 'select_account' ensures the account chooser always shows
      prompt: 'select_account',
    });

    console.log('[Auth] Redirecting to Google OAuth');
    res.redirect(url);
  } catch (err) {
    console.error('[Auth] Failed to generate auth URL:', err);
    res.status(500).send('Authentication service unavailable');
  }
});

// ---------------------------------------------------------------------------
// Route: GET /auth/google/callback
// ---------------------------------------------------------------------------
// Google redirects here with ?code=<authorization_code>.
// We: 1. Exchange the code for an ID token + access token
//     2. Verify the ID token's signature and audience
//     3. Extract user profile from the token payload
//     4. Upsert the user in MongoDB
//     5. Save userId in the session
//     6. Redirect the browser to the frontend with ?welcome=1
//
// The FRONTEND_URL env var controls where the browser ends up:
//   - Dev:  http://localhost:5173
//   - Prod: https://jessica.beevr.voyage
//
// WARNING: This endpoint is unauthenticated. Anyone with a valid Google
// authorization code can hit it. This is by design — Google already verified
// the user's identity. Rate limiting is added in Phase 2 to prevent abuse.
//
// WARNING: The redirect MUST be a 302 (not a fetch/JSON response) because
// the browser performs the OAuth flow via top-level navigation.
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;

    if (!code) {
      console.warn('[Auth] Callback missing authorization code');
      res.status(400).send('Missing authorization code');
      return;
    }

    const oauth2Client = getOAuth2Client();

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.id_token) {
      console.warn('[Auth] No ID token received from Google');
      res.status(400).send('Missing ID token');
      return;
    }

    // Verify the ID token and extract user info
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      console.warn('[Auth] Invalid token payload:', payload);
      res.status(400).send('Invalid token payload');
      return;
    }

    // -----------------------------------------------------------------------
    // Upsert user: create if new, update if returning
    // -----------------------------------------------------------------------
    // findOneAndUpdate with upsert:true is atomic — no race condition
    // between a "find" followed by a separate "create" or "update".
    //
    // { upsert: true, new: true }:
    //   - upsert:true  → insert document if no match is found
    //   - new:true     → return the document AFTER the update/insert
    //
    // The return value is a Mongoose document with _id, __v, etc.
    // -----------------------------------------------------------------------
    const user = await User.findOneAndUpdate(
      // Match on Google's unique user ID
      { googleId: payload.sub },
      // Set all profile fields (lastLogin always updates)
      {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name ?? 'Unknown',
        picture: payload.picture,
        lastLogin: new Date(),
      },
      { upsert: true, new: true }
    );

    // -----------------------------------------------------------------------
    // Save userId in the session
    // -----------------------------------------------------------------------
    // The session middleware (from server.ts) has already parsed the session
    // from the cookie (or created a new empty session). We just set a value.
    //
    // req.session.userId is typed via the express-session augmentation
    // defined in src/types.ts
    //
    // We store the MongoDB _id as a string (Mongoose ObjectId.toString()).
    // -----------------------------------------------------------------------
    req.session.userId = user._id.toString();

    // Save the session explicitly to ensure the cookie is set before redirect
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Redirect to the frontend
    const frontendUrl = process.env.FRONTEND_URL || '/';
    const redirectUrl = `${frontendUrl}?welcome=1`;

    console.log(`[Auth] User ${user.email} authenticated — redirecting to ${redirectUrl}`);
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[Auth] Callback error:', err);
    res.status(500).send('Authentication failed');
  }
});

// ---------------------------------------------------------------------------
// Route: GET /auth/me
// ---------------------------------------------------------------------------
// Returns the currently authenticated user's profile as JSON.
// Used by the frontend on app load to check if a session exists.
//
// Also computes isNew: true if createdAt ≈ lastLogin (within 1s tolerance).
// This signals to the frontend that the user just signed up for the first time
// and should see the help/welcome modal.
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const userId = req.session.userId;

  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const user = await User.findById(userId).select('-__v');

    if (!user) {
      // Session exists but user was deleted from DB — clear the session
      req.session.destroy(() => {});
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // isNew: true if this is the first login (createdAt ≈ lastLogin)
    const isNew = Math.abs(user.createdAt.getTime() - user.lastLogin.getTime()) < 1000;

    res.json({
      _id: user._id,
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      isNew,
    });
  } catch (err) {
    console.error('[Auth] /me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Route: POST /auth/logout
// ---------------------------------------------------------------------------
// Destroys the session in MongoDB (via connect-mongo) and clears the cookie.
// The frontend then redirects the user to the landing page.
// ---------------------------------------------------------------------------
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }

    res.clearCookie('connect.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    res.json({ ok: true });
  });
});

export default router;
```

> **WARNING about `req.session.save()`:** The OAuth callback route explicitly calls `req.session.save()` before redirecting. This is necessary because `res.redirect()` might send the response before the session is persisted to MongoDB (connect-mongo saves asynchronously). Without the explicit save, the session cookie could be set but the session data might not exist in MongoDB yet — causing the next request to create a new empty session.

> **WARNING about `res.clearCookie()`:** When clearing the cookie, the options (path, domain, secure, sameSite) must match the options used when the cookie was set. If they don't match, the cookie won't be cleared. The session middleware default cookie name is `connect.sid`.

---

### 1.5 Update `src/types.ts`

> **Purpose:** Update the frontend `User` type to match the backend response, and add the express-session module augmentation.
> **Location:** `src/types.ts`

**Changes:**
1. Replace the minimal `User { email: string }` with the full profile
2. Remove `'login'` from `AppState` — login is now a browser redirect to Google
3. Add `declare module 'express-session'` for TypeScript

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type AppState = 'landing' | 'chat';

export interface User {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: string;
  lastLogin: string;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// express-session augmentation
// ---------------------------------------------------------------------------
// Without this, TypeScript will error on req.session.userId because
// SessionData doesn't know about the userId property.
//
// This must be in a .ts file included by tsconfig.json (it is — "include": ["src"]).
// It must be a module-level declaration (not inside any export/namespace) and
// must be in a module file (one that has at least one import/export).
//
// We already have exports above, so this file qualifies as a module.
// ---------------------------------------------------------------------------
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}
```

> **WARNING — Session augmentation scope:** The `declare module 'express-session'` block must be in a **module** file (has `import`/`export`). If this file had no other exports, you'd need `export {}` at the bottom to make TypeScript treat it as a module. Since we have exports above, this is fine.

> **WARNING — `'login'` removed from AppState:** The `state === 'login'` render block in `App.tsx` must be replaced with a Google sign-in button. This will be done in Task 1.8.

---

### 1.6 Modify `server.ts`

> **Purpose:** Integrate session middleware, MongoDB connection, auth routes, and protect the WebSocket endpoint.
> **Location:** `server.ts`

This is the most complex change. Below is the **complete file** with all modifications annotated.

```typescript
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';
import { connectDB } from './src/db';
import authRouter from './src/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const PROJECT_ID = process.env.PROJECT_ID || 'YOUR_PROJECT_ID';
const LOCATION = process.env.LOCATION || 'YOUR_LOCATION';
const RAG_CORPUS_ID = process.env.RAG_CORPUS_ID || 'YOUR_CORPUS_ID';

// ---------------------------------------------------------------------------
// Trust proxy
// ---------------------------------------------------------------------------
// REQUIRED when behind a reverse proxy (Nginx/Caddy). Without this:
//   - req.protocol will be 'http' even though the proxy terminates HTTPS
//   - req.secure will be false
//   - Secure cookies won't be set (Express checks req.secure)
//
// Setting 'trust proxy' to 1 trusts the first proxy hop (the reverse proxy).
// If there are multiple proxies (e.g., Cloudflare → Nginx), you may need
// to adjust this value or use a function.
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------
// Extracted into a named const so it can be reused for WebSocket authentication
// (see the server 'upgrade' event handler below).
//
// Session data is stored in MongoDB via connect-mongo. The session cookie
// (default name: 'connect.sid') is set on the browser.
// ---------------------------------------------------------------------------
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET!,
  name: 'connect.sid',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600, // only update session every 24h unless data changes
  }),
  cookie: {
    httpOnly: true,       // prevents XSS access to cookie
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax',      // CSRF protection — sent on top-level navigations
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});

app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
// Mounted at /auth — handles Google OAuth, session management, user lookup.
// Must be mounted before the catch-all route below.
// ---------------------------------------------------------------------------
app.use('/auth', authRouter);

app.use(express.static(path.join(__dirname, 'public')));

// Catch-all: serve index.html for SPA routing
app.use((req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ---------------------------------------------------------------------------
// Start server (only after MongoDB connects)
// ---------------------------------------------------------------------------
// connectDB() is awaited before app.listen(). If MongoDB fails, the server
// exits with code 1 rather than starting in a degraded state.
// ---------------------------------------------------------------------------
connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`🚀 Servidor Realtime en http://localhost:${port}`);
    });

    // -----------------------------------------------------------------------
    // WebSocket server
    // -----------------------------------------------------------------------
    // We create the WebSocketServer with noServer: true because we need to
    // authenticate the upgrade request BEFORE upgrading to WebSocket.
    //
    // The manual upgrade handler checks:
    //   1. The request path is /ws
    //   2. The session is valid (req.session.userId exists)
    //
    // If either check fails, the connection is rejected with 401.
    // -----------------------------------------------------------------------
    const wss = new WebSocketServer({ noServer: true });

    // -----------------------------------------------------------------------
    // HTTP upgrade handler (for WebSocket connections)
    // -----------------------------------------------------------------------
    // This intercepts ALL HTTP upgrade requests to the server. We filter for
    // the /ws path, then manually run the session middleware to populate
    // req.session, then check authentication.
    //
    // Due to TypeScript constraints, 'req' here is IncomingMessage, not the
    // Express Request type. The session middleware adds the 'session' property
    // at runtime, but TypeScript doesn't know about it. We use 'as any' casts
    // where needed.
    //
    // NOTE: The WebSocketServer created with { path: '/ws' } handled this
    // path filtering automatically. With noServer:true, we do it manually.
    // -----------------------------------------------------------------------
    server.on('upgrade', (req, socket, head) => {
      // Only handle /ws path — reject all others
      if (req.url !== '/ws') {
        socket.destroy();
        return;
      }

      // Run the Express session middleware on the raw IncomingMessage.
      // The middleware needs req, res (a mock), and next.
      // req.session will be available after this call.
      sessionMiddleware(req, {} as any, () => {
        // Check if the session has a userId (set during OAuth callback)
        if (!(req as any).session?.userId) {
          console.warn('[WS] Unauthenticated WebSocket connection rejected');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Authenticated — upgrade to WebSocket
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
    });

    // -----------------------------------------------------------------------
    // WebSocket connection handler
    // -----------------------------------------------------------------------
    // This code is largely unchanged from the original. The 'clientWs' is the
    // authenticated browser WebSocket. We open a second WebSocket to Gemini.
    // -----------------------------------------------------------------------
    wss.on('connection', async (clientWs) => {
      console.log('🔌 [Client] Nueva conexión de navegador');

      try {
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        const vertexUrl = `wss://${LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

        const geminiWs = new WebSocket(vertexUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        let isLive = false;

        geminiWs.on('open', () => {
          console.log('✅ [Gemini] Conexión establecida con Vertex AI');

          const setupMessage = {
            setup: {
              model: `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio`,
              generationConfig: {
                responseModalities: ['audio'],
              },
              output_audio_transcription: {},
              tools: [
                {
                  retrieval: {
                    vertex_rag_store: {
                      rag_resources: [
                        {
                          rag_corpus: `projects/${PROJECT_ID}/locations/${LOCATION}/ragCorpora/${RAG_CORPUS_ID}`,
                        },
                      ],
                    },
                  },
                },
              ],
              systemInstruction: {
                parts: [
                  {
                    text: `
                      Jessica: The Ultimate World Cup Narrator
                      ...
                    `,
                  },
                ],
              },
            },
          };
          geminiWs.send(JSON.stringify(setupMessage));
        });

        geminiWs.on('unexpected-response', (req, res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
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
            console.error('Error procesando respuesta de Gemini:', e);
          }
        });

        clientWs.on('message', (data) => {
          if (isLive && geminiWs.readyState === WebSocket.OPEN) {
            try {
              const rawData = JSON.parse(data.toString());

              const payload = {
                realtimeInput: {
                  mediaChunks: [
                    {
                      data: rawData.realtimeInput.mediaChunks[0].data,
                      mimeType: 'audio/pcm;rate=16000',
                    },
                  ],
                },
              };
              geminiWs.send(JSON.stringify(payload));
            } catch (e) {
              // Ignore malformed messages from client
            }
          }
        });

        geminiWs.on('error', (err) => {
          console.error('❌ [Gemini WebSocket Error]:', err.message);
        });

        console.log(
          `Config: Project: ${PROJECT_ID}, Location: ${LOCATION}, RAG: ${RAG_CORPUS_ID}`
        );

        geminiWs.on('close', (code, reason) => {
          console.warn(`⚠️ [Gemini] Conexión cerrada (${code}): ${reason}`);
          isLive = false;
          clientWs.close();
        });

        clientWs.on('error', (err) =>
          console.error('🔥 [Client] Error:', err.message)
        );
        clientWs.on('close', () => geminiWs.close());
      } catch (authError) {
        console.error(
          '❌ Error de Autenticación con Google Cloud:',
          authError instanceof Error ? authError.message : authError
        );
        clientWs.close();
      }
    });
  })
  .catch((err) => {
    console.error('❌ [Server] Failed to start:', err);
    process.exit(1);
  });
```

> **WARNING — `sessionMiddleware` cast in upgrade handler:** The line `sessionMiddleware(req, {} as any, () => {...})` passes the raw `IncomingMessage` as `req` and an empty object as `res`. The session middleware only needs `req.headers`, `req.url`, and the ability to set `req.session`. It doesn't actually write to `res` in the upgrade context (we just need to populate `req.session`). The empty `res` object is a mock — it will never be used for a real response.
>
> **WARNING — `wss.emit('connection', ws, req)`:** The third argument `req` is the raw `IncomingMessage` from the upgrade event, not an Express Request. The existing `wss.on('connection', async (clientWs) => {...})` handler doesn't use `req`, so this is safe. If you later need `req` in the connection handler, you'll need to read `(req as any).session`.

---

### 1.7 Modify `vite.config.ts`

> **Purpose:** Add `/auth` proxy so the Vite dev server forwards auth requests to Express.

```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    publicDir: false,
    build: { outDir: 'public' },
    server: {
      proxy: {
        '/ws': {
          target: `http://localhost:${env.PORT || 3000}`,
          ws: true, // WebSocket support
        },
        '/auth': {
          target: `http://localhost:${env.PORT || 3000}`,
          // No ws: true — /auth uses regular HTTP
        },
      },
    },
  };
});
```

> **NOTE:** The `/auth` proxy forwards requests from Vite (port 5173) to Express (port 3000). This allows the browser to stay on `localhost:5173` during OAuth. The `/ws` proxy was already configured — no change there.

> **WARNING — Vite proxy only applies in dev mode:** In production (`npm run serve` or Docker), Vite is not running. Express serves the static files from `public/` and handles `/auth/*` directly. The proxy config is irrelevant in production.

---

### 1.8 Modify `src/App.tsx`

> **Purpose:** Add OAuth login flow, user state, logout, and session check on mount.

This is the most complex frontend change. Below are all modifications organized by section.

#### 1.8a — Update Imports

```typescript
// Change the icon import — remove Lock (no longer needed)
import {
  HelpCircle,
  MessageSquare,
  FileAudio,
  Mic,
  MicOff,
  User,
  ChevronRight,
  ArrowRight,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
```

#### 1.8b — Remove Unused State

```typescript
// Remove these two lines:
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
```

#### 1.8c — Add `/auth/me` Check on Mount

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const showWelcome = params.get('welcome') === '1';

  fetch('/auth/me')
    .then((r) => (r.ok ? r.json() : null))
    .then((userData) => {
      if (userData) {
        setUser(userData);

        // Show welcome modal for first-time users
        if (showWelcome && userData.isNew) {
          setShowHelpModal(true);
        } else {
          setState('chat');
          // Skip help modal for returning users — go straight to chat
        }

        // Clean up the ?welcome=1 query param without reloading
        if (showWelcome) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    });
}, []);
```

> **WARNING:** The `useEffect` has no dependencies (`[]`), so it runs only once on app mount. This is intentional. After the OAuth callback redirects back to the app, the app remounts fresh, and this effect runs. The `?welcome=1` param is cleaned up via `replaceState` to prevent it from persisting on refresh.

#### 1.8d — Replace the Login Form with Google Sign-In

Replace the entire `state === 'login'` block with:

```tsx
{state === 'login' && (
  <motion.div
    key="login"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className="flex-1 flex items-center justify-center p-4 md:p-6 relative z-10"
  >
    <div className="w-full max-w-md glass-panel p-8 md:p-10 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl -mr-16 -mt-16" />

      <div className="text-center mb-8 md:mb-10 relative">
        <div className="flex flex-col items-center mb-6">
          <img
            src={jessicaLogo}
            alt="Jessica AI Logo"
            className="max-h-12 w-auto brightness-0 invert opacity-80"
          />
          <span className="text-[8px] font-black text-slate-500 tracking-[0.5em] uppercase mt-2 leading-none">
            POWERED
          </span>
        </div>
        <h2 className="text-2xl md:text-3xl font-display font-bold text-white tracking-tight">
          {t.login.title}
        </h2>
      </div>

      {/* Google Sign-In Button */}
      <button
        onClick={() => (window.location.href = '/auth/google')}
        className="w-full py-4 bg-white text-black rounded-2xl font-bold flex items-center justify-center gap-3 transition-all hover:bg-slate-200 active:scale-[0.98] mt-4 shadow-xl"
      >
        {t.login.button}
        <ArrowRight size={20} />
      </button>

      <button
        onClick={() => setState('landing')}
        className="w-full mt-8 text-slate-500 text-xs font-bold uppercase tracking-widest hover:text-cyan-400 transition-colors"
      >
        {t.login.back}
      </button>
    </div>
  </motion.div>
)}
```

> **WARNING:** The login button uses `window.location.href = '/auth/google'` — NOT `fetch('/auth/google')`. OAuth requires a full browser navigation. Google redirects the browser to its consent screen, and after authorization, redirects back. This cannot be done via AJAX/fetch.

#### 1.8e — Update Logout Handler

```typescript
const handleLogout = async () => {
  await fetch('/auth/logout', { method: 'POST' });
  setUser(null);
  setMessages([]);
  setState('landing');
};
```

#### 1.8f — Update Chat Nav to Show User

In the chat navigation bar, replace the `J` avatar with the user's Google profile picture (or initial if no picture):

```tsx
{user?.picture ? (
  <img
    src={user.picture}
    alt={user.name}
    className="w-10 h-10 rounded-xl object-cover ring-2 ring-cyan-500/30"
    referrerPolicy="no-referrer"
  />
) : (
  <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center font-bold text-black text-xl shadow-[0_0_15px_rgba(6,182,212,0.3)]">
    {user?.name?.charAt(0) || 'J'}
  </div>
)}
```

And update the subtitle to show the user's name:

```tsx
<div className="hidden sm:block">
  <h3 className="font-bold text-lg text-white tracking-widest font-mold uppercase">
    {t.chat.nav.voice}
  </h3>
  <p className="text-[9px] text-cyan-400/60 font-mono tracking-[0.3em] uppercase italic">
    {user?.name || t.chat.nav.engine}
  </p>
</div>
```

---

### 1.9 Create `.env.example`

> **Purpose:** Document all required environment variables.
> **Location:** `.env.example`
> **Git:** Already included via `.gitignore` rule `!.env.example`

```env
# ═══════════════════════════════════════════════════════════════════════════════
# Jessica AI — Environment Variables
# ═══════════════════════════════════════════════════════════════════════════════
# Copy this file to .env and fill in your values.
# NEVER commit the actual .env file to version control.
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Server ───────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development

# ─── Google Cloud — Vertex AI ─────────────────────────────────────────────────
# These are used for the Gemini WebSocket connection and RAG.
PROJECT_ID=your-google-cloud-project-id
LOCATION=us-central1
RAG_CORPUS_ID=your-vertex-ai-rag-corpus-id

# ─── Google OAuth 2.0 ─────────────────────────────────────────────────────────
# Create OAuth credentials at:
# https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback

# ─── Session ──────────────────────────────────────────────────────────────────
# Generate a cryptographically random string:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=replace-with-a-random-string-at-least-32-chars-long

# ─── MongoDB ──────────────────────────────────────────────────────────────────
# Connection string from MongoDB Atlas:
# https://cloud.mongodb.com → Connect → Connect your application
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/jessica-ai?retryWrites=true&w=majority

# ─── Frontend URL (for OAuth redirect after callback) ─────────────────────────
# Dev: http://localhost:5173
# Prod: https://jessica.beevr.voyage
FRONTEND_URL=http://localhost:5173
```

---

### 1.10 Google Cloud Console Configuration

Add the following URL patterns to your OAuth 2.0 Client ID:

**Authorized JavaScript origins (no trailing slashes):**
```
https://jessica.beevr.voyage
http://localhost:5173
http://localhost:3000
```

**Authorized redirect URIs:**
```
https://jessica.beevr.voyage/auth/google/callback
http://localhost:5173/auth/google/callback
http://localhost:3000/auth/google/callback
```

> **WARNING:** URIs must match **exactly** including protocol (`http` vs `https`), domain, port, and path. No trailing slashes. A mismatch produces the infamous `400 redirect_uri_mismatch` error with no helpful details in the error message.

---

### 1.11 Local `.env` Setup

Create `.env` (not `.env.example` — that's the template) with:

```env
PORT=3000
NODE_ENV=development

PROJECT_ID=your-actual-project-id
LOCATION=us-central1
RAG_CORPUS_ID=your-actual-corpus-id

GOOGLE_CLIENT_ID=your-actual-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-actual-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback

SESSION_SECRET=dev-session-secret-not-used-in-production-1234567890

MONGODB_URI=mongodb+srv://actual-user:actual-password@cluster0.xxxxx.mongodb.net/jessica-ai?retryWrites=true&w=majority

FRONTEND_URL=http://localhost:5173
```

---

### 1.12 Verify Dev Flow

Run both servers:

```bash
npm run dev
# Express on port 3000
# Vite on port 5173
```

**Test each step manually:**

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Open `http://localhost:5173` | Landing page loads |
| 2 | Click **COMENZAR AHORA** | Redirected to `http://localhost:5173/login` with Google button |
| 3 | Click **ACCEDER** | Redirected to Google consent screen |
| 4 | Select Google account | Redirected back to `http://localhost:5173?welcome=1` |
| 5 | Help modal appears | Click **Entendido, comenzar** |
| 6 | Chat view loads | WebSocket status shows "CONECTANDO..." → "MICRÓFONO LISTO" |
| 7 | Refresh the page | Goes straight to chat (no landing, no login) |
| 8 | Click **SALIR** | Redirected to landing page |
| 9 | Refresh again | Back to landing (session cleared) |

**Check server logs for:**
```
✅ [DB] Connected to MongoDB
/auth → redirect to Google OAuth
User <email> authenticated — redirecting to http://localhost:5173?welcome=1
🔌 [Client] Nueva conexión de navegador
✅ [Gemini] Conexión establecida con Vertex AI
🎊 [Gemini] Setup finalizado con éxito.
```

**Check MongoDB for:**
- Database `jessica-ai`
- Collection `users` with 1 document containing `googleId`, `email`, `name`, etc.
- Collection `sessions` with 1 document (auto-created by connect-mongo)

---

## 3. Phase 2 — Production Hardening

> **Objective:** Add security, resilience, and monitoring features required for production deployment at `https://jessica.beevr.voyage`.

> **WARNING:** Phase 2 tasks are independent of Phase 1 and can be implemented in any order. They build on the Phase 1 code.

---

### 2.1 Helmet Security Headers

> **Why:** Without Helmet, Express doesn't set `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `Content-Security-Policy` headers. This exposes users to clickjacking, MIME-sniffing, and other browser-level attacks.

```bash
npm install helmet
```

In `server.ts`, add this after `app.set('trust proxy', 1)` and before any other middleware:

```typescript
import helmet from 'helmet';

app.use(
  helmet({
    // Content Security Policy — restricts which resources can be loaded.
    // We need to be permissive for:
    //   - Vertex AI: connect-src wss://*.aiplatform.googleapis.com
    //   - Google profile pictures: img-src https://*.googleusercontent.com
    //   - WebSocket: connect-src ws://localhost:3000 (dev) or same-origin (prod)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'",
          'wss://*.aiplatform.googleapis.com',
          'wss://*.beevr.voyage',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'https://*.googleusercontent.com',
        ],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind generates inline styles
        fontSrc: ["'self'"],
      },
    },
    // HSTS — force HTTPS for 1 year (including subdomains)
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
```

> **WARNING:** Overly strict CSP can break your app. The above configuration is permissive enough for Jessica AI. If you encounter CSP violations, check the browser console for the exact directive name and adjust. For development, you can set `contentSecurityPolicy: false` in Helmet options to disable CSP locally.

---

### 2.2 Rate Limiting on Auth Routes

> **Why:** The `/auth/google/callback` endpoint is publicly accessible. Without rate limiting, an attacker could flood it with authorization codes, causing excessive MongoDB writes and Google API calls.

```bash
npm install express-rate-limit
```

In `server.ts` or `src/auth.ts`, add:

```typescript
import rateLimit from 'express-rate-limit';

// ---------------------------------------------------------------------------
// Rate limiter for auth routes
// ---------------------------------------------------------------------------
// Limits to 20 requests per 15-minute window per IP.
// This is applied before the /auth router so it covers ALL auth endpoints.
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // limit each IP to 20 requests per window
  standardHeaders: true,     // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,      // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many requests. Please try again later.',
  },
});

app.use('/auth', authLimiter);
app.use('/auth', authRouter);
```

> **WARNING:** If you're behind a reverse proxy, rate-limit-by-IP requires `app.set('trust proxy', 1)` which we already added. Without trust proxy, `req.ip` will always be the proxy's IP address (e.g., `127.0.0.1`), and ALL users will share the same rate limit counter. With trust proxy, `req.ip` correctly reflects the client's IP.

---

### 2.3 Graceful Shutdown

> **Why:** When Docker sends `SIGTERM` (during `docker stop`, scaling events, deploys), Node.js exits immediately by default. Active WebSocket connections to Gemini are dropped mid-stream, MongoDB connection pool is closed abruptly, and in-flight HTTP requests are terminated.

In `server.ts`, after the `wss` setup:

```typescript
// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// Handles SIGTERM (Docker stop, Kubernetes pod termination) and SIGINT
// (Ctrl+C in terminal).
//
// Order of operations:
//   1. Stop accepting new HTTP connections (server.close)
//   2. Close all WebSocket connections (wss.close)
//   3. Disconnect MongoDB (mongoose.disconnect)
//   4. Exit (process.exit(0))
//
// NOTE: We do NOT attempt to gracefully close Gemini WebSocket connections
// — those are managed by Vertex AI and will be closed when the server
// process exits. The Gemini API is designed for this.
// ---------------------------------------------------------------------------
function shutdown(signal: string) {
  console.log(`\n⚠️  ${signal} received — shutting down gracefully`);

  // Step 1: Stop accepting new connections
  server.close(() => {
    console.log('✅ HTTP server closed');

    // Step 2: Close WebSocket server
    wss.close(() => {
      console.log('✅ WebSocket server closed');

      // Step 3: Disconnect MongoDB
      mongoose.disconnect().then(() => {
        console.log('✅ MongoDB disconnected');
        process.exit(0);
      });
    });
  });

  // If graceful shutdown takes > 10s, force exit
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

> **WARNING:** The `wss.close()` callback will not fire if there are active WebSocket connections that don't close gracefully. The 10-second `setTimeout` force-exit prevents the process from hanging indefinitely.

---

### 2.4 Health Check Endpoint

> **Why:** Your reverse proxy (and potentially your container orchestrator) needs a health check endpoint to know the application is alive and connected to MongoDB.

In `server.ts`, before the catch-all route:

```typescript
import mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
// Returns the server status and MongoDB connection state.
// Used by the reverse proxy's health check and for monitoring.
//
// MongoDB states:
//   0 = disconnected
//   1 = connected
//   2 = connecting
//   3 = disconnecting
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus =
    mongoState === 1
      ? 'connected'
      : mongoState === 2
        ? 'connecting'
        : 'disconnected';

  const healthy = mongoState === 1;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongo: mongoStatus,
  });
});
```

---

### 2.5 Static File Caching

> **Why:** Without cache headers, browsers re-fetch all JS/CSS assets on every page load. Vite adds content hashes to filenames (e.g., `index-B7a9f3a2.js`), so we can safely cache aggressively.

In `server.ts`, modify the `express.static` call:

```typescript
// BEFORE:
app.use(express.static(path.join(__dirname, 'public')));

// AFTER:
app.use(
  express.static(path.join(__dirname, 'public'), {
    // Cache hashed assets for 1 year (immutable)
    // Vite outputs: assets/index-B7a9f3a2.js → safe to cache forever
    maxAge: '1y',
    immutable: true,
  })
);
```

> **WARNING:** This caching policy assumes all static files are content-hashed by Vite. If you have non-hashed files in `public/` (e.g., `service-worker.js`, `robots.txt`), they will also be cached for 1 year. Either:
> - Move non-hashed files to a subdirectory with separate `express.static` middleware and different cache settings, or
> - Set `maxAge` to a shorter duration (e.g., `'1h'`) and accept slightly worse caching for hashed assets.

---

### 2.6 Custom Session Cookie Name

> **Why:** The default cookie name `connect.sid` is well-known and makes it easy for attackers to identify the session mechanism. Renaming it to something unique is a minor security-by-obscurity improvement.

In `server.ts`, in the `sessionMiddleware` options:

```typescript
const sessionMiddleware = session({
  name: 'jessica.sid', // instead of default 'connect.sid'
  secret: process.env.SESSION_SECRET!,
  // ... rest unchanged
});
```

> **WARNING:** If you rename the cookie, you must update the `res.clearCookie()` call in `src/auth.ts` to match:

```typescript
// In /auth/logout handler:
res.clearCookie('jessica.sid', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});
```

---

### 2.7 Session Expiry UX on Frontend

> **Why:** Sessions expire after 7 days by default. If a user has the app open in a tab for longer than 7 days (or if the session is destroyed due to server restart), the WebSocket connection will be rejected with a 401. Currently, the error handler just shows a generic "Error de conexión con el servidor" message — the user won't know to re-authenticate.

In `src/App.tsx`, update the WebSocket `onError` callback:

```typescript
// In the connect() call inside useEffect:
onError: (err) => {
  wsClosedByError.current = true;
  setWsStatus('disconnected');
  setWsError(err);

  // If the WebSocket was rejected due to auth, check if session expired
  fetch('/auth/me').then((r) => {
    if (!r.ok) {
      // Session expired or invalid — redirect to Google login
      window.location.href = '/auth/google';
    }
  });
},
```

---

### 2.8 Mongoose `strictQuery`

Already included in `src/db.ts` in Phase 1 (Task 1.3):

```typescript
mongoose.set('strictQuery', true);
```

This suppresses the Mongoose 7 deprecation warning and ensures that queries with fields not defined in the schema are ignored (rather than matched against the database).

---

## 4. Phase 3 — Observability & DX

> **Objective:** Make the application observable in production and ensure a smooth developer experience.

---

### 3.1 Global Error Handler

> **Why:** Without a global error handler, uncaught errors in route handlers will crash the Express process or leak stack traces to the client.

In `server.ts`, after all routes (including the catch-all):

```typescript
// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// Catches errors thrown in route handlers and middleware.
// Returns a 500 with a generic message (no stack traces exposed in production).
// ---------------------------------------------------------------------------
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[Error] Unhandled error:', err);

    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err.message,
    });
  }
);
```

> **NOTE:** In Express 5, error-handling middleware is defined with 4 parameters `(err, req, res, next)`. Express identifies error handlers by the 4-parameter signature. Make sure the types are correct.

---

### 3.2 TypeScript Strict Checks

> **Why:** Ensure the code compiles without errors before deployment.

Add a `typecheck` script to `package.json`:

```json
"scripts": {
  "dev": "concurrently -k \"npm run dev:server\" \"npm run dev:client\"",
  "dev:server": "tsx watch server.ts",
  "dev:client": "vite",
  "build": "vite build",
  "start": "npm run build && tsx server.ts",
  "serve": "tsx server.ts",
  "lint": "tsc --noEmit"
}
```

The `lint` script (`tsc --noEmit`) already exists. Run it after all changes:

```bash
npm run lint
```

Investigate and resolve any TypeScript errors before deploying.

---

## 5. Deployment Checklist

> **Use this checklist before deploying to `https://jessica.beevr.voyage`**

### Pre-Deploy

- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` succeeds (Vite builds to `public/`)
- [ ] `.env` has `NODE_ENV=production`
- [ ] `.env` has correct production values:
  - [ ] `GOOGLE_REDIRECT_URI=https://jessica.beevr.voyage/auth/google/callback`
  - [ ] `FRONTEND_URL=https://jessica.beevr.voyage`
  - [ ] `MONGODB_URI` points to production cluster
  - [ ] `SESSION_SECRET` is a strong random string (not the dev value)
- [ ] Google Cloud Console has all production URIs registered
- [ ] Docker builds successfully: `docker build -t jessica-ai:latest .`

### Post-Deploy

- [ ] Visit `https://jessica.beevr.voyage/health` → returns `{ status: "ok", mongo: "connected" }`
- [ ] Visit `https://jessica.beevr.voyage` → landing page loads
- [ ] Click **COMENZAR AHORA** → redirects to `/auth/google` → Google consent screen
- [ ] Authenticate with Google → redirects back to `https://jessica.beevr.voyage?welcome=1`
- [ ] Help modal → click "Entendido, comenzar" → chat view loads
- [ ] Microphone toggle works → WebSocket connects → status shows "CONECTANDO..." → "MICRÓFONO LISTO"
- [ ] Refresh `https://jessica.beevr.voyage` → goes straight to chat (no re-auth)
- [ ] Click **SALIR** → redirects to landing, refresh shows landing again
- [ ] Open Chrome DevTools → Application → Cookies → `jessica.sid` exists with `Secure` and `HttpOnly` flags
- [ ] Test audio streaming with a voice question

### Monitoring

- [ ] Server logs show no `[Auth] Callback error` or `[WS] Unauthenticated WebSocket connection rejected` (expected for normal operation)
- [ ] MongoDB Atlas shows active connections in the cluster dashboard
- [ ] Session count in `sessions` collection grows/shrinks as users login/logout

---

*End of Implementation Plan*
