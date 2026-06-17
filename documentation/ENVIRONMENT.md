# Environment Setup

This project uses separate environments for local development and production.

## Local Development

### 1. Set up `.env`
Copy from `.env.example`:
```bash
cp .env.example .env
```

Edit `.env` with your local values:
- Use `http://localhost:3000` for `GOOGLE_REDIRECT_URI` and `FRONTEND_URL`
- Set `NODE_ENV=development`
- Use local MongoDB or MongoDB Atlas free tier
- Point `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON file

### 2. Google OAuth Setup
In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
1. Go to **APIs & Services → Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URIs:
   - `http://localhost:3000/auth/google/callback`
   - `https://jessica.beevr.voyage/auth/google/callback` (for production)
4. Add your email as a **Test user** in the OAuth consent screen
5. Copy the Client ID and Secret to `.env`

### 3. MongoDB Setup
Local option:
```bash
# Install MongoDB locally or use Docker
docker run -d -p 27017:27017 --name mongodb mongo
```

Or use [MongoDB Atlas free tier](https://www.mongodb.com/atlas/database)

### 4. Start the app
```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

## Production Deployment

Production values are in `.env.production`. To deploy:

### Docker method (recommended)
```bash
# Build image
docker build -t gemini-voice-chat:latest .

# Run with production env vars
docker run -d \
  --name jessica-server \
  -p 3000:3000 \
  --env-file /path/to/secure/.env.production \
  gemini-voice-chat:latest
```

### Environment variables
All `.env` variables can be passed as Docker environment variables:
- `PORT`
- `NODE_ENV=production`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/google/callback`
- `FRONTEND_URL=https://yourdomain.com`
- `SESSION_SECRET`
- `JWT_SECRET`
- `MONGODB_URI` (production Atlas)
- `PROJECT_ID`, `LOCATION`

## Switching Environments

### Local → Production
```bash
# Stop local server
Ctrl+C

# Start with production env
docker run -d --name jessica-server -p 3000:3000 --env-file .env.production gemini-voice-chat:latest
```

### Production → Local
```bash
# Stop container
docker stop jessica-server && docker rm jessica-server

# Start local dev
npm run dev
```

## Important Notes

1. **Never commit `.env` or `.env.production`** - they are gitignored
2. Use different MongoDB databases for local and production
3. Google OAuth requires both localhost and production URIs in the same client
4. For HTTPS in production, use a reverse proxy (Nginx/Caddy) in front of the container
