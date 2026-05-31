# Quick Start Guide

## Local Development

### 1. Set up environment
```bash
# Copy the example file
cp .env.example .env

# Edit .env with your values (see documentation/ENVIRONMENT.md)
```

### 2. Replace service account JSON
```bash
# Replace the placeholder with your actual Google Cloud service account JSON
# Your real credentials will NOT be committed to git (it's in .gitignore)
cp your-service-account.json service-account.json
```

### 3. Start the app
```bash
# Build and start all services
docker-compose up -d --build

# Access at: http://localhost:3000
```

## Production Deployment

### Option A: Your current method (recommended)
```bash
docker run -d \
  --name jessica-server \
  --network root_default \
  -p 3000:3000 \
  --env-file ~/.secrets/jessica-ai/.env \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/secrets/gcp-service-account.json" \
  -v /etc/secrets/gcp-service-account.json:/app/secrets/gcp-service-account.json:ro \
  gemini-voice-chat:latest
```

### Option B: Using Docker Compose
```bash
docker-compose -f docker-compose.prod-custom.yml up -d --build
```

## Common Commands

| Command | Description |
|---------|-------------|
| `docker-compose up -d` | Start local stack |
| `docker-compose down` | Stop and remove containers |
| `docker-compose logs -f app` | View app logs |
| `docker-compose restart app` | Restart the app |

## Documentation

All guides are in the [`documentation/`](documentation/) folder:
- 📖 [ENVIRONMENT.md](documentation/ENVIRONMENT.md) - Environment setup
- 🐳 [DOCKER.md](documentation/DOCKER.md) - Docker usage
- ❓ [TROUBLESHOOTING.md](documentation/TROUBLESHOOTING.md) - Common issues

## Need Help?

Check the troubleshooting guide: `documentation/TROUBLESHOOTING.md`
