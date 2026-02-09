---
name: signal
description: Signal messaging channel via signal-cli REST API. Supports direct and group messaging, reactions, and media attachments.
metadata: { "eclaw": { "emoji": "📡", "requires": { "config": ["channels.signal"], "env": ["SIGNAL_PHONE_NUMBER"] } } }
---

# Signal Channel

## Overview

Signal integration via [signal-cli REST API](https://github.com/bbernhard/signal-cli-rest-api). Provides bidirectional messaging with WebSocket-first receiving (HTTP polling fallback) and outbound text/media via `/v2/send`.

## Prerequisites

1. **signal-cli REST API** running (default: `http://localhost:8080`)
2. A linked Signal device/phone number
3. Set `SIGNAL_PHONE_NUMBER` environment variable or configure `channels.signal.accountId`

## Configuration

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNAL_PHONE_NUMBER` | Your Signal phone number (E.164 format, e.g. `+15551234567`) | — |
| `SIGNAL_CLI_URL` | Base URL of signal-cli REST API | `http://localhost:8080` |

### Config file (`eclaw.config.yaml`)

```yaml
channels:
  signal:
    enabled: true
    accountId: "+15551234567"
    allowFrom:
      - "+15559876543"
```

## Capabilities

- **Chat types**: direct, group
- **Reactions**: supported
- **Media**: up to 100 MB attachments
- **Text chunk limit**: 4000 characters

## Architecture

- **Gateway**: WebSocket connection to `/v1/receive/{phone}` with exponential backoff reconnection (max 10 attempts, 2s-60s delay). Falls back to HTTP polling at 1s intervals.
- **Outbound**: POST to `/v2/send` with JSON body for text and base64 attachments.
- **Security**: Phone number validation via regex, configurable allowlist filtering, message length cap (8000 chars).
