# Production Workflow with Docker Compose

This document explains how to use Docker Compose **exactly** like your current production setup.

## Your Current Workflow (Summary)

```bash
# 1. Build the image
docker build -t gemini-voice-chat:latest .

# 2. Run the container
docker run -d \
  --name jessica-server \
  --network root_default \
  -p 3000:3000 \
  --env-file ~/.secrets/jessica-ai/.env \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/secrets/gcp-service-account.json" \
  -v /etc/secrets/gcp-service-account.json:/app/secrets/gcp-service-account.json:ro \
  gemini-voice-chat:latest
```

## Equivalent Docker Compose Workflow (Build + Run in One Step)

### Single Command (Recommended):
```bash
docker-compose -f docker-compose.prod-custom.yml up -d --build
```

This does **both** building and running in one command!

### Or Separate Steps:
```bash
# Build first
docker-compose -f docker-compose.prod-custom.yml build

# Then run
docker-compose -f docker-compose.prod-custom.yml up -d
```

## Should You Use the Build Flag?

**Yes! Use `--build` in production.** Here's why:

### When to use `docker-compose build`:
- ✅ **Production deployments** (builds fresh image each time)
- ✅ Local development (hot-reload)
- ✅ Testing new code changes
- ✅ When you want compose to handle building

### Why it's good for production:
- ✅ Ensures you're running the latest code
- ✅ Consistent build process every time
- ✅ Easy to update: just run `up -d --build`
- ✅ No separate build step needed

## Complete Production Deployment Steps

### Option 1: Your Current Method (Still Works!)
```bash
docker build -t gemini-voice-chat:latest .
docker run -d \
  --name jessica-server \
  --network root_default \
  -p 3000:3000 \
  --env-file ~/.secrets/jessica-ai/.env \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/secrets/gcp-service-account.json" \
  -v /etc/secrets/gcp-service-account.json:/app/secrets/gcp-service-account.json:ro \
  gemini-voice-chat:latest
```

### Option 2: Using Docker Compose (Recommended - Build + Run in One Step)
```bash
# Single command builds AND starts the container
docker-compose -f docker-compose.prod-custom.yml up -d --build
```

## Updating the Application

### With your current method:
```bash
docker build -t gemini-voice-chat:latest .
docker stop jessica-server && docker rm jessica-server
docker run -d ... (same command)
```

### With Docker Compose:
```bash
docker build -t gemini-voice-chat:latest .
docker-compose -f docker-compose.prod-custom.yml up -d --force-recreate
```

## Key Differences Between the Two Approaches

| Action | Your Current Method | Docker Compose |
|--------|-------------------|----------------|
| Build | `docker build` | Same (`docker build`) |
| Run | `docker run ...` | `docker-compose up -d` |
| Stop | `docker stop/rm` | `docker-compose down` |
| Update | Rebuild + rerun | Rebuild + `up -d --force-recreate` |
| Logs | `docker logs` | `docker-compose logs` |
| Status | `docker ps` | `docker-compose ps` |

## Why Use Docker Compose?

Even though your current method works, compose adds:

1. **Health checks** (automatic monitoring)
2. **Easier service management** (`up`, `down`, `ps`, `logs` commands)
3. **Service discovery** (containers can find each other by name)
4. **Configuration as code** (easy to version control and share)
5. **Scaling** (can easily add more instances later)

## Troubleshooting

### Common Issues

**Issue: Network not found**
```bash
docker network inspect root_default || docker network create root_default
```

**Issue: Container won't start**
```bash
docker-compose -f docker-compose.prod-custom.yml logs app
```

**Issue: Want to rebuild and restart**
```bash
docker build -t gemini-voice-chat:latest .
docker-compose -f docker-compose.prod-custom.yml up -d --force-recreate --build
```

### Verify Everything is Working

```bash
# Check container status
docker-compose -f docker-compose.prod-custom.yml ps

# View logs
docker-compose -f docker-compose.prod-custom.yml logs -f app

# Test the API
curl http://localhost:3000

# Enter the container
docker exec -it jessica-server bash
```

## Migration from `docker run` to Compose

### Step 1: Stop your current container
```bash
docker stop jessica-server && docker rm jessica-server
```

### Step 2: Start with compose
```bash
docker-compose -f docker-compose.prod-custom.yml up -d
```

### Step 3: Verify
```bash
docker-compose -f docker-compose.prod-custom.yml ps
curl http://localhost:3000
```

## Rollback Plan

If you need to go back:
```bash
docker-compose -f docker-compose.prod-custom.yml down
docker run -d ... (your original command)
```

## Best Practices for Production

1. **Always build locally first**, then push to registry if needed
2. **Test the image** before deploying to production
3. **Use version tags** (`gemini-voice-chat:v1.0.0`) instead of `latest` in production
4. **Keep backups** of your database
5. **Monitor logs** regularly
6. **Set up alerts** for health check failures

## Summary

You don't need to change anything about how you build! Just replace the `docker run` command with:

```bash
docker-compose -f docker-compose.prod-custom.yml up -d
```

Everything else (building, updating, secrets management) stays exactly the same!
