# Production Deployment Options

You have **two** ways to deploy to production:

## Option 1: Your Current `docker run` Command (Recommended for now)

Your existing command continues to work perfectly:

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

**Pros:**
- ✅ Already working in production
- ✅ Secure volume mount for GCP credentials
- ✅ Uses your existing secret management setup
- ✅ No changes needed

**Cons:**
- Manual scaling
- No built-in health checks (in this command)

---

## Option 2: Docker Compose (New - Recommended for future)

### Standard Production (docker-compose.prod.yml)

For managed database services:

```bash
# Build the image first
docker build -t gemini-voice-chat:latest .

# Start with compose
docker-compose -f docker-compose.prod.yml up -d
```

**Pros:**
- ✅ Health checks built-in
- ✅ Easy to add monitoring
- ✅ Simple scaling with `docker-compose up -d --scale app=3`
- ✅ Clean service management

**Cons:**
- Requires slight adjustment to your secret management

### Custom Production (docker-compose.prod-custom.yml)

This file **matches your exact current setup**:

```bash
docker-compose -f docker-compose.prod-custom.yml up -d
```

**Features:**
- Uses `root_default` network (like your command)
- Loads env from `~/.secrets/jessica-ai/.env` (same path)
- Mounts GCP credentials at `/etc/secrets/gcp-service-account.json` → `/app/secrets/`
- Includes health checks
- Same security model as your current setup

---

## Migration Guide: From `docker run` to Compose

If you want to switch to compose:

### Step 1: Choose the right file
- **Keep using `docker run`** if it's working fine ✅
- Use **`docker-compose.prod-custom.yml`** for a drop-in replacement
- Use **`docker-compose.prod.yml`** if you want to switch to managed DB services

### Step 2: Stop your current container
```bash
docker stop jessica-server
docker rm jessica-server
```

### Step 3: Start with compose
```bash
docker-compose -f docker-compose.prod-custom.yml up -d
```

### Step 4: Verify it's running
```bash
docker-compose -f docker-compose.prod-custom.yml ps
curl http://localhost:3000
```

---

## Reverse Proxy Setup (Required for Production)

For HTTPS and better security, add a reverse proxy:

### Example with Caddy (recommended):

Create `Caddyfile`:
```
jessica.beevr.voyage {
    reverse_proxy jessica-server:3000
}
```

Run Caddy:
```bash
docker run -d \
  --name caddy \
  --network root_default \
  -p 80:80 -p 443:443 \
  -v $(pwd)/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  -v caddy_config:/config \
  caddy:2.6
```

### Example with Nginx:

Create `nginx.conf`:
```nginx
server {
    listen 80;
    server_name jessica.beevr.voyage;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name jessica.beevr.voyage;

    ssl_certificate /etc/letsencrypt/live/jessica.beevr.voyage/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jessica.beevr.voyage/privkey.pem;

    location / {
        proxy_pass http://jessica-server:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Updating the Application

### With `docker run`:
```bash
docker build -t gemini-voice-chat:latest .
docker stop jessica-server && docker rm jessica-server
docker run -d --name jessica-server ... (same command as before)
```

### With Compose:
```bash
docker-compose -f docker-compose.prod-custom.yml build
docker-compose -f docker-compose.prod-custom.yml up -d --force-recreate
```

---

## Troubleshooting

### Common Issues

**Issue: Container won't start**
- Check logs: `docker logs jessica-server`
- Verify all env vars are present in your `.env` file

**Issue: Google Auth not working**
- Ensure `GOOGLE_REDIRECT_URI=https://jessica.beevr.voyage/auth/google/callback` is set
- Verify the domain is added to your Google OAuth client

**Issue: MongoDB connection failed**
- Check your `MONGODB_URI` in the env file
- Ensure the database server is accessible from the container

### Useful Commands

```bash
# View logs
docker logs jessica-server -f

# Enter container
docker exec -it jessica-server bash

# Check running containers
docker ps

# List all images
docker images

# Clean up old containers/images
docker system prune -a --force
```

---

## Recommendation

**Stick with your current `docker run` command** if:
- It's working reliably ✅
- You're comfortable with the manual management
- No need for scaling/monitoring yet

**Switch to Docker Compose** if:
- You want built-in health checks ✅
- Plan to scale horizontally
- Want easier service management
- Need to add monitoring/logging services later

Both approaches work perfectly! The choice depends on your preference.
