---
name: customize
description: Add new capabilities or modify EClaw behavior. Use when user wants to add channels, change configuration, add integrations, modify the agent, or make any other customizations. This is an interactive skill that asks questions to understand what the user wants.
---

# EClaw Customization

This skill helps users add capabilities or modify behavior. Use AskUserQuestion to understand what they want before making changes.

## Workflow

1. **Understand the request** - Ask clarifying questions
2. **Plan the changes** - Identify files to modify
3. **Implement** - Make changes directly to the code
4. **Test guidance** - Tell user how to verify

## Key Files

| File | Purpose |
|------|---------|
| `eclaw.config.yaml` | Main configuration (port, provider, memory, container, browser) |
| `src/index.ts` | Main bootstrap, server setup, WebSocket handling |
| `src/config/config.ts` | Config loading and validation |
| `src/config/types.ts` | Config TypeScript interfaces |
| `src/agent/agent.ts` | Agent creation and chat handling |
| `src/infra/auth.ts` | Authentication credential resolution |
| `src/memory/manager.ts` | Memory system initialization |
| `src/web/routes.ts` | HTTP route definitions |
| `src/channels/web/monitor.ts` | WebSocket client management |
| `src/skills/loader.ts` | Skill discovery and loading |
| `.env` | Environment variables (credentials) |

## Common Customization Patterns

### Adding a New Channel Integration

EClaw has skill-based channel integrations in the `skills/` directory.

Questions to ask:
- Which channel? (Telegram, Slack, Discord, Signal, iMessage, Google Chat, WhatsApp)
- Do they want it as a primary channel or additional?

Implementation:
1. Check if a skill already exists in `skills/` for that channel
2. If yes, guide them through installing and configuring it
3. If no, create a new skill following the pattern in existing skills

### Changing LLM Provider

Questions to ask:
- Which provider? (Anthropic, OpenAI, or other)
- Do they have API credentials?

Implementation:
1. Update `eclaw.config.yaml` with `agent.provider`
2. Add credentials to `.env`
3. May need code changes in `src/agent/agent.ts`

### Changing the Web UI

Questions to ask:
- What aspect? (port, host, appearance, new features)
- Any specific requirements?

Simple changes -> edit `eclaw.config.yaml`
UI changes -> edit files in `src/web/public/`
Route changes -> edit `src/web/routes.ts`

### Adding New Agent Tools

Questions to ask:
- What should the tool do?
- Does it need external APIs?
- Should it be available always or conditionally?

Implementation:
1. Create tool following `AgentTool` interface in `src/agent/types.ts`
2. Register in `src/index.ts` via `additionalTools` array
3. Or create as a skill in `skills/` directory

### Changing Memory Configuration

Questions to ask:
- Enable/disable memory?
- Change data directory?
- Change embedding provider?

Implementation:
1. Update `eclaw.config.yaml` memory section
2. For provider changes, update code in `src/memory/`

### Enabling/Disabling Container Mode

Implementation:
1. Update `eclaw.config.yaml`:
   ```yaml
   container:
     enabled: true  # or false
   ```
2. If enabling, ensure Docker is installed and image is built:
   ```bash
   docker info
   ./container/build.sh
   ```

### Changing Deployment

Questions to ask:
- Target platform? (macOS, Linux, Docker, cloud)
- Service manager? (launchd, systemd, Docker Compose)

Implementation:
1. Create appropriate service files
2. Update paths in config
3. Provide setup instructions

## After Changes

Always tell the user:

**If running as launchd service (macOS):**
```bash
launchctl unload ~/Library/LaunchAgents/com.eclaw.plist
launchctl load ~/Library/LaunchAgents/com.eclaw.plist
```

**If running as systemd service (Linux):**
```bash
systemctl --user restart eclaw
```

**If running manually:**
```bash
# Stop current process (Ctrl+C), then:
pnpm start
```

## Example Interaction

User: "Add Telegram as an input channel"

1. Check: Does `skills/telegram/` exist? Yes - guide through installation
2. Ask: "Do you have a Telegram Bot Token? You'll need one from @BotFather"
3. Install the skill: `pnpm run skill:install telegram`
4. Configure credentials in `.env`
5. Restart EClaw
6. Tell user how to test by messaging the bot
