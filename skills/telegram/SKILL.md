---
name: telegram
description: Telegram Bot API channel via Grammy. Supports direct, group, and channel messaging with media attachments and long-polling gateway.
metadata: { "eclaw": { "emoji": "✈️", "requires": { "config": ["channels.telegram"], "env": ["TELEGRAM_BOT_TOKEN"] } } }
---

# Telegram Channel

## Overview

Telegram integration via [Grammy](https://grammy.dev/) (Telegram Bot API framework). Long-polling gateway with exponential backoff reconnection and outbound text/media support.

## Prerequisites

1. Create a bot via [@BotFather](https://t.me/BotFather) and get the bot token
2. Set `TELEGRAM_BOT_TOKEN` environment variable or `channels.telegram.token` in config

## Configuration

### Environment variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |

### Config file (`eclaw.config.yaml`)

```yaml
channels:
  telegram:
    enabled: true
    token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
    allowFrom:
      - "123456789"       # Telegram user ID
      - "@username"       # or @username
```

## Capabilities

- **Chat types**: direct (private), group (group/supergroup), channel
- **Native commands**: supported (bot commands via BotFather)
- **Block streaming**: true (sends complete messages, not streamed)
- **Media**: photos, videos, audio, documents up to 50 MB
- **Text chunk limit**: 4000 characters

## Architecture

- **Gateway**: Grammy Bot with long-polling via `bot.start()`. Validates token and fetches bot info before starting.
- **Reconnection**: Exponential backoff (2^n seconds, base 2s, max 60s, 10 attempts) on polling errors.
- **Inbound**: Listens on `message` event, extracts `text` or `caption`, maps Telegram chat types (private->direct, group/supergroup->group, channel->channel). Caps messages at 8000 chars.
- **Outbound**: `sendMessage` for text, `sendPhoto`/`sendVideo`/`sendAudio`/`sendDocument` based on MIME type via Grammy InputFile.
- **Filtering**: `allowFrom` supports both numeric user IDs and @usernames (case-insensitive, @ prefix optional).
