import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User } from './models/User';

const router = Router();

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

router.get('/google', (_req: Request, res: Response) => {
  try {
    const oauth2Client = getOAuth2Client();

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
    });

    console.log('[Auth] Redirecting to Google OAuth');
    res.redirect(url);
  } catch (err) {
    console.error('[Auth] Failed to generate auth URL:', err);
    res.status(500).send('Authentication service unavailable');
  }
});

router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;

    if (!code) {
      console.warn('[Auth] Callback missing authorization code');
      res.status(400).send('Missing authorization code');
      return;
    }

    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.id_token) {
      console.warn('[Auth] No ID token received from Google');
      res.status(400).send('Missing ID token');
      return;
    }

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

    const user = await User.findOneAndUpdate(
      { googleId: payload.sub },
      {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name ?? 'Unknown',
        picture: payload.picture,
        lastLogin: new Date(),
      },
      { upsert: true, new: true }
    );

    req.session.userId = user._id.toString();

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[Auth] JWT_SECRET not configured');
      res.status(500).send('Server configuration error');
      return;
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        picture: user.picture,
        isNew: Math.abs(user.createdAt.getTime() - user.lastLogin.getTime()) < 1000,
      },
      secret,
      { expiresIn: '7d' }
    );

    const frontendUrl = process.env.FRONTEND_URL || '/';
    const redirectUrl = `${frontendUrl}?token=${token}`;

    console.log(`[Auth] User ${user.email} authenticated — redirecting to ${redirectUrl}`);
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[Auth] Callback error:', err);
    res.status(500).send('Authentication failed');
  }
});

function extractUserId(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
      return decoded.userId;
    } catch {
      return undefined;
    }
  }
  return req.session.userId;
}

router.get('/me', async (req: Request, res: Response) => {
  const userId = extractUserId(req);

  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const user = await User.findById(userId).select('-__v');

    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'User not found' });
      return;
    }

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