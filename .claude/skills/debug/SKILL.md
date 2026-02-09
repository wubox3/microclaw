---
name: debug
description: Debug EClaw issues. Use when things aren't working, container fails, authentication problems, or to understand how the system works. Covers logs, environment variables, mounts, and common issues.
---

# EClaw Debugging

This guide covers debugging the EClaw system including the web server, agent, memory system, and optional container execution.

## Architecture Overview

```
Host (macOS/Linux)                    Container (Docker, optional)
─────────────────────────────────────────────────────────────────
src/index.ts                          container/agent-runner/
    │                                      │
    │ Web UI + WebSocket                   │ runs Claude Agent SDK
    │ Agent (direct or container)          │ with MCP servers
    │                                      │
    ├── .env ─────────────────────> /workspace/env-dir/env
    ├── .eclaw/ (data dir) ────> /workspace/group
    └── (mounts) ──────────────────> /workspace/extra
```

## Log Locations

| Log | Location | Content |
|-----|----------|---------|
| **Main app logs** | `logs/eclaw.log` | Server, routing, agent invocation |
| **Main app errors** | `logs/eclaw.error.log` | Host-side errors |
| **Container run logs** | `.eclaw/container-*.log` | Per-run: input, mounts, stderr, stdout |

## Common Issues

### 1. Authentication Failures

```
No Anthropic credentials found
```

**Fix:** Ensure `.env` file exists with credentials:
```bash
cat .env  # Should show one of:
# ANTHROPIC_API_KEY=sk-ant-api03-...        (pay-per-use)
# ANTHROPIC_AUTH_TOKEN=sk-ant-oat01-...     (subscription)
```

EClaw also checks macOS Keychain for Claude Code OAuth tokens. If you've logged in with `claude` CLI, credentials may be found automatically.

### 2. Container Mode Not Working

**Container mode is opt-in.** Check your config:
```bash
cat eclaw.config.yaml | grep -A2 container
```

Should show:
```yaml
container:
  enabled: true
```

**Docker not running:**
```bash
docker info >/dev/null 2>&1 && echo "Docker OK" || echo "Docker not running"
```

**Image not built:**
```bash
docker images | grep eclaw-agent || echo "Image not found - run ./container/build.sh"
```

### 3. Memory System Issues

Check if the data directory exists:
```bash
ls -la .eclaw/
```

Reset memory (will be recreated):
```bash
rm -rf .eclaw/
```

### 4. Web UI Not Loading

Check if the server is running:
```bash
curl -s http://localhost:3000/ | head -20
```

Check the port isn't in use:
```bash
lsof -i :3000
```

### 5. Browser Automation Issues

Check if browser control is enabled:
```bash
cat eclaw.config.yaml | grep -A2 browser
```

## Manual Testing

### Test the web server:
```bash
pnpm start &
sleep 3
curl -s http://localhost:3000/
```

### Test the agent directly:
```bash
pnpm dev
# Then open http://localhost:3000 in browser and send a message
```

### Test container execution (if enabled):
```bash
echo '{}' | docker run -i --entrypoint /bin/echo eclaw-agent:latest "Container OK"
```

### Interactive shell in container:
```bash
docker run --rm -it --entrypoint /bin/bash eclaw-agent:latest
```

## Quick Diagnostic Script

Run this to check common issues:

```bash
echo "=== Checking EClaw Setup ==="

echo -e "\n1. Authentication configured?"
[ -f .env ] && (grep -q "ANTHROPIC_AUTH_TOKEN=" .env || grep -q "ANTHROPIC_API_KEY=sk-" .env) && echo "OK" || echo "MISSING - add ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN to .env"

echo -e "\n2. Dependencies installed?"
[ -d node_modules ] && echo "OK" || echo "MISSING - run pnpm install"

echo -e "\n3. Config file present?"
([ -f eclaw.config.yaml ] || [ -f eclaw.config.yml ] || [ -f eclaw.config.json ]) && echo "OK (found config)" || echo "Using defaults (no config file)"

echo -e "\n4. Docker available?"
docker info >/dev/null 2>&1 && echo "OK" || echo "NOT RUNNING - only needed if container mode enabled"

echo -e "\n5. Container image?"
docker images | grep -q eclaw-agent && echo "OK" || echo "NOT BUILT - run ./container/build.sh if container mode enabled"

echo -e "\n6. Data directory?"
ls -la .eclaw/ 2>/dev/null || echo "Not yet created (will be created on first run)"

echo -e "\n7. Port available?"
lsof -i :3000 >/dev/null 2>&1 && echo "PORT 3000 IN USE" || echo "OK (port 3000 free)"

echo -e "\n8. Service running?"
(launchctl list 2>/dev/null | grep -q eclaw && echo "launchd: running") || (systemctl --user is-active eclaw 2>/dev/null && echo "systemd: running") || echo "Not running as service"
```

## Rebuilding After Changes

```bash
# Rebuild container (if using container mode)
./container/build.sh

# Or force full rebuild
docker builder prune -af
./container/build.sh
```

## Checking Container Image

```bash
# List images
docker images | grep eclaw

# Check what's in the image
docker run --rm --entrypoint /bin/bash eclaw-agent:latest -c '
  echo "=== Node version ==="
  node --version

  echo "=== Claude Code version ==="
  claude --version 2>/dev/null || echo "Not installed"

  echo "=== Installed packages ==="
  ls /app/node_modules/ 2>/dev/null || echo "No packages"
'
```
