---
name: setup
description: Run initial MicroClaw setup. Use when user wants to install dependencies, authenticate Claude, configure the assistant, build containers, or start the service. Triggers on "setup", "install", "configure microclaw", or first-time setup requests.
---

# MicroClaw Setup

Run all commands automatically. Only pause when user action is required (providing credentials, scanning QR codes).

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text. This integrates with Claude's built-in question/answer system for a better experience.

## 1. Install Dependencies

```bash
pnpm install
```

## 2. Install Container Runtime (Optional)

First, detect the platform and check what's available:

```bash
echo "Platform: $(uname -s)"
which docker && docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: not installed or not running"
```

MicroClaw's container mode is **opt-in** (disabled by default). Ask the user:

> Do you want to enable **container isolation** for agent execution?
>
> 1. **No** (default) - Agents run directly in the MicroClaw process. Simpler, faster startup.
> 2. **Yes** - Agents run in isolated Docker containers. More secure, requires Docker.

### If they choose No

Skip to Section 3. Container mode stays disabled (the default).

### If they choose Yes

**If Docker is already installed and running:** Continue to Section 3, noting they'll need to build the container image later.

**If Docker is NOT installed:**

Tell the user:
> Docker is required for container isolation. Please install it:
>
> **macOS:**
> 1. Download Docker Desktop from https://docker.com/products/docker-desktop
> 2. Install and start Docker Desktop
> 3. Wait for the whale icon in the menu bar to stop animating
>
> **Linux:**
> ```bash
> curl -fsSL https://get.docker.com | sh
> sudo systemctl start docker
> sudo usermod -aG docker $USER  # Then log out and back in
> ```
>
> Let me know when you've completed these steps.

Wait for user confirmation, then verify:

```bash
docker run --rm hello-world
```

## 3. Configure Claude Authentication

Ask the user:
> Do you want to use your **Claude subscription** (Pro/Max) or an **Anthropic API key**?

### Option 1: Claude Subscription (Recommended)

Tell the user:
> Open another terminal window and run:
> ```
> claude setup-token
> ```
> A browser window will open for you to log in. Once authenticated, the token will be displayed in your terminal. Either:
> 1. Paste it here and I'll add it to `.env` for you, or
> 2. Add it to `.env` yourself as `ANTHROPIC_AUTH_TOKEN=<your-token>`

If they give you the token, add it to `.env`:

```bash
echo "ANTHROPIC_AUTH_TOKEN=<token>" > .env
```

### Option 2: API Key

Ask if they have an existing key to copy or need to create one.

**Copy existing:**
```bash
grep "^ANTHROPIC_API_KEY=" /path/to/source/.env > .env
```

**Create new:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

Tell the user to add their key from https://console.anthropic.com/

**Verify:**
```bash
KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing"
```

## 4. Build Container Image (if container mode enabled)

If the user chose container isolation in Step 2:

Build the MicroClaw agent container:

```bash
./container/build.sh
```

This creates the `microclaw-agent:latest` image with Node.js, Claude Code CLI, and the agent runner.

Verify the build succeeded:

```bash
docker images | grep microclaw-agent
echo '{}' | docker run -i --entrypoint /bin/echo microclaw-agent:latest "Container OK" || echo "Container build failed"
```

## 5. Create Configuration File

Ask the user:
> Do you want to customize the configuration, or use defaults?
>
> Defaults:
> - Web UI on `http://localhost:3000`
> - Anthropic as LLM provider
> - Memory system enabled
> - Container mode disabled (unless you chose it above)
> - Browser automation enabled

### If they want defaults

If container mode was NOT chosen, skip config file creation (defaults are fine).

If container mode WAS chosen, create a minimal config:

```bash
cat > microclaw.config.yaml << 'EOF'
container:
  enabled: true
EOF
```

### If they want customization

Ask follow-up questions and create the config:

```bash
cat > microclaw.config.yaml << 'EOF'
web:
  port: 3000
  host: localhost

agent:
  provider: anthropic

memory:
  enabled: true

container:
  enabled: false

browser:
  enabled: true
EOF
```

Adjust values based on their answers.

## 6. Configure External Directory Access (if container mode enabled)

Only relevant if container mode is enabled.

Ask the user:
> Do you want the agent to be able to access any directories **outside** the MicroClaw project when running in containers?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own workspace.

If **no**, skip to the next step.

If **yes**, ask follow-up questions:

### 6a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 6b. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/microclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only):

```bash
cat > ~/.config/microclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": []
}
EOF
```

Verify the file:

```bash
cat ~/.config/microclaw/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible to containerized agents:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting MicroClaw

## 7. Configure launchd Service (macOS)

Ask the user:
> Do you want MicroClaw to start automatically on login?
>
> 1. **Yes** (recommended) - Runs as a launchd service, starts on boot, restarts on crash
> 2. **No** - You'll start it manually with `pnpm start`

### If No

Tell the user:
> You can start MicroClaw manually anytime with:
> ```
> pnpm start
> ```
> Or in development mode with:
> ```
> pnpm dev
> ```

Skip to Section 8.

### If Yes

Generate the plist file with correct paths automatically:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.microclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.microclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>--import</string>
        <string>tsx</string>
        <string>${PROJECT_PATH}/src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/microclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/microclaw.error.log</string>
</dict>
</plist>
EOF

echo "Created launchd plist with:"
echo "  Node: ${NODE_PATH}"
echo "  Project: ${PROJECT_PATH}"
```

Start the service:

```bash
mkdir -p logs
launchctl load ~/Library/LaunchAgents/com.microclaw.plist
```

Verify it's running:
```bash
launchctl list | grep microclaw
```

### Linux Alternative (systemd)

If the user is on Linux:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)

cat > ~/.config/systemd/user/microclaw.service << EOF
[Unit]
Description=MicroClaw AI Assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_PATH}
ExecStart=${NODE_PATH} --import tsx ${PROJECT_PATH}/src/index.ts
Restart=always
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

mkdir -p logs
systemctl --user daemon-reload
systemctl --user enable microclaw
systemctl --user start microclaw
```

Verify:
```bash
systemctl --user status microclaw
```

## 8. Test

Tell the user:
> MicroClaw should now be running. Open your browser to:
> ```
> http://localhost:3000
> ```
> You should see the web UI. Try sending a message to verify everything works.

Check the logs:
```bash
tail -f logs/microclaw.log
```

If not using launchd/systemd, start manually:
```bash
pnpm start
```

Then verify in the browser.

## Troubleshooting

**Service not starting**: Check `logs/microclaw.error.log`

**Container agent fails**:
- Ensure Docker is running: `docker info`
- Check container image exists: `docker images | grep microclaw-agent`
- Rebuild if needed: `./container/build.sh`

**No response in web UI**:
- Check that the server is running on the correct port
- Check `logs/microclaw.log` for errors
- Verify authentication is configured: `grep -E "ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN" .env`

**Authentication errors**:
- Verify `.env` has valid credentials
- For OAuth: re-run `claude setup-token` to refresh
- For API key: check at https://console.anthropic.com/

**Memory system issues**:
- Check that the data directory exists: `ls -la .microclaw/`
- Reset memory: `rm -rf .microclaw/` (will be recreated on next start)

**Unload macOS service**:
```bash
launchctl unload ~/Library/LaunchAgents/com.microclaw.plist
```

**Stop Linux service**:
```bash
systemctl --user stop microclaw
```
