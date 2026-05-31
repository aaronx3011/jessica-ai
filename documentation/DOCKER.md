# Docker Setup

This project supports both local development and production deployment using Docker.

## Local Development with Docker Compose

### Quick Start

```bash
# 1. Create .env file if you haven't already
cp .env.example .env

# 2. Edit .env with your local values (see ENVIRONMENT.md)

# 3. Start the stack
docker-compose up -d

# 4. Access the app
http://localhost:3000
```

### Commands

| Command | Description |
|---------|-------------|
| `docker-compose up -d` | Start all services in detached mode |
| `docker-compose down` | Stop and remove containers |
| `docker-compose logs -f app` | View app logs |
| `docker-compose exec app bash` | Enter the app container |
| `docker-compose restart app` | Restart just the app |

### Accessing MongoDB

The local MongoDB instance is available at:
- Connection string: `mongodb://root:example@localhost:27017`
- Admin UI: Use a MongoDB client like Compass or Studio 3T

**Important:** The app automatically connects to the Docker service. You don't need to change your `.env` file's `MONGODB_URI`. The compose file overrides it to use the correct Docker network.

To connect from your host machine:
```bash
mongosh "mongodb://root:example@localhost:27017"
```

### MongoDB Connection Troubleshooting

If you see `ECONNREFUSED 127.0.0.1:27017` errors, it means the app is trying to connect to localhost instead of the Docker service. This is normal - **the compose file handles this automatically** by overriding the connection string.

The error will resolve itself once MongoDB starts up. If you still have issues:
```bash
# Check if MongoDB container is running
docker ps | grep mongodb

# View MongoDB logs
docker-compose logs mongodb

# Restart both services
docker-compose restart mongodb app
```

## Production Deployment

### Option A: Using docker-compose.prod.yml with external database (Recommended)

For production, it's recommended to use managed services like MongoDB Atlas.

```bash
# 1. Set up your .env.production file
cp .env.example .env.production
# Edit with production values

# 2. Start the app (without embedded MongoDB)
docker-compose -f docker-compose.prod.yml up -d

# 3. Access the app
http://your-server-ip:3000
```

### Option B: Using docker-compose.prod.yml with embedded MongoDB

For testing or small-scale production:

```bash
# 1. Uncomment the mongodb service in docker-compose.prod.yml

# 2. Set MONGODB_URI to use the embedded instance
#    MONGODB_URI=mongodb://root:example@mongodb:27017/jessica-ai?authSource=admin

# 3. Start the stack
docker-compose -f docker-compose.prod.yml up -d
```

### Production Best Practices

1. **Use a reverse proxy** (Nginx, Caddy) for HTTPS and load balancing:
   ```bash
   # Example with Caddy
   caddy reverse-proxy --from yourdomain.com --to app:3000
   ```

2. **Environment variables**: Use Docker secrets or your hosting platform's secret management instead of env_file in production.

3. **Database**: Use MongoDB Atlas for production deployments.

4. **Monitoring**: Add health checks and monitoring:
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   docker-compose -f docker-compose.prod.yml logs -f app
   ```

5. **Backups**: Set up regular backups for your database.

## Updating the Application

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build --no-cache app
docker-compose up -d --force-recreate
```

## Troubleshooting

### Common Issues

**Issue: MongoDB connection refused**
- Solution: Wait a few seconds for MongoDB to start, then restart the app:
  ```bash
  docker-compose restart app
  ```

**Issue: Port already in use**
- Solution: Stop any existing services or change the port mapping.

**Issue: Google Auth not working locally**
- Make sure you've added `http://localhost:3000/auth/google/callback` to your Google OAuth client's authorized redirect URIs.

**Issue: App crashes on start**
- Check logs:
  ```bash
  docker-compose logs app
  ```

### Viewing Logs

```bash
# Follow all service logs
docker-compose logs -f

# Follow just the app logs
docker-compose logs -f app

# View MongoDB logs
docker-compose logs -f mongodb
```

## Cleanup

To completely remove containers, networks, and volumes:

```bash
# For local development
docker-compose down -v

# For production
docker-compose -f docker-compose.prod.yml down -v
```

The `-v` flag removes named volumes (including MongoDB data). Use with caution!
