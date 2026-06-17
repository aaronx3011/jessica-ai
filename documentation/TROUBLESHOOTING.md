# Troubleshooting Guide

## MongoDB Connection Issues in Local Development

### Error: `MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`

**Cause:** The app is trying to connect to MongoDB at `127.0.0.1`, which inside a Docker container means "localhost of the container", not your host machine or the MongoDB service.

**Solution:** ✅ **Already fixed in docker-compose.yml**

The compose file now overrides the `MONGODB_URI` to connect to the MongoDB service:
```yaml
MONGODB_URI: mongodb://root:example@mongodb:27017/jessica-ai-local?authSource=admin
```

In Docker Compose, containers communicate using **service names** as hostnames. So `mongodb` resolves to the MongoDB container.

### How to Test It's Working

```bash
# 1. Start the stack
docker-compose up -d

# 2. Check logs (should see MongoDB connecting)
docker-compose logs -f app

# Look for: ✅ [DB] Connected to MongoDB

# 3. Enter the app container and test MongoDB manually
docker exec -it jessica-ai-app-1 bash

# Inside container, try:
mongosh "mongodb://root:example@mongodb:27017/jessica-ai-local?authSource=admin"
```

### Common Fixes

**If MongoDB still doesn't connect:**

1. **Wait for MongoDB to start first:**
   ```bash
   docker-compose up -d mongodb  # Start DB first
   sleep 10
   docker-compose up -d app      # Then start app
   ```

2. **Check if MongoDB container is running:**
   ```bash
   docker ps
   # Should see a container named jessica-ai-mongodb-1
   ```

3. **Test MongoDB directly from host:**
   ```bash
   mongosh "mongodb://root:example@localhost:27017?authSource=admin"
   # If this works, the DB is running but Docker networking needs adjustment
   ```

4. **Restart both services:**
   ```bash
   docker-compose restart mongodb app
   ```

## Other Common Issues

### Issue: Google Auth not working locally

**Error:** Redirect URI mismatch or authentication failures

**Solution:**
1. Ensure you've added `http://localhost:3000/auth/google/callback` to your Google OAuth client
2. Add your email as a **Test user** in the OAuth consent screen
3. Verify `.env` has correct values:
   ```
   GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   FRONTEND_URL=http://localhost:3000
   ```

### Issue: App crashes on start

**Check logs:**
```bash
docker-compose logs app
```

Common causes:
- Missing environment variables (check `.env`)
- MongoDB not running
- Invalid Google OAuth credentials
- Port already in use

### Issue: Port already in use

**Error:** `Bind for 0.0.0.0:3000 failed: port is already allocated`

**Solution:**
```bash
# Find what's using the port
lsof -i :3000

# Kill the process (replace PID)
kill -9 PID

# Or change the port in docker-compose.yml
ports:
  - "3001:3000"  # Map host 3001 to container 3000
```

### Issue: Hot-reload not working

**Problem:** Changes to code aren't reflected

**Solution:**
The volume mount should handle this:
```yaml
volumes:
  - .:/app
  - /app/node_modules
```

If it's not working:
1. Restart the container: `docker-compose restart app`
2. Check file permissions
3. Try removing node_modules in the container: `docker-compose exec app rm -rf node_modules && docker-compose exec app npm install`

## Debugging Commands

### View all logs
```bash
docker-compose logs
# Or follow in real-time
docker-compose logs -f
```

### View specific service logs
```bash
docker-compose logs mongodb
docker-compose logs app
```

### Enter a container
```bash
docker exec -it jessica-ai-app-1 bash
# Now you're inside the container!
pwd  # Should be /app
ls   # See your code
node --version  # Check Node version
```

### Check network connections
```bash
docker exec -it jessica-ai-app-1 bash
ping mongodb  # Should work (Docker service name)
curl http://localhost:3000  # Test if app is running
```

### Clean up everything
```bash
# Stop and remove containers, networks
docker-compose down

# Remove volumes (deletes MongoDB data!)
docker-compose down -v

# Prune all unused Docker objects
docker system prune -a --force
```

## Environment Variables Checklist

Make sure your `.env` file has:
- ✅ `MONGODB_URI` (for local development, will be overridden by compose)
- ✅ `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- ✅ `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback`
- ✅ `FRONTEND_URL=http://localhost:3000`
- ✅ `SESSION_SECRET` (any random string)
- ✅ `JWT_SECRET` (any random string)
- ✅ `PROJECT_ID`, `LOCATION` (from Google Cloud)

## Still Stuck?

1. **Check the Docker Compose documentation**: https://docs.docker.com/compose/
2. **Search for your error**: The error message usually contains enough info to find a solution
3. **Try without Docker first**: Test locally with `npm run dev` to isolate if it's a Docker issue or app issue
4. **Ask for help**: Provide the full error logs and your docker-compose.yml file