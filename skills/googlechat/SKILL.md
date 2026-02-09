---
name: googlechat
description: Google Chat channel via Chat API HTTP webhook. Supports direct, group, and threaded messaging with media attachments and service account authentication.
metadata: { "eclaw": { "emoji": "💬", "requires": { "config": ["channels.googlechat"] } } }
---

# Google Chat Channel

## Overview

Google Workspace Chat integration via the [Chat API](https://developers.google.com/workspace/chat). Receives messages through an HTTP webhook endpoint and sends outbound messages/media via the REST API with service account authentication.

## Prerequisites

1. A Google Cloud project with the Chat API enabled
2. A service account with Chat Bot scope, or Application Default Credentials
3. A Chat app configured in Google Cloud Console with HTTP endpoint pointing to your server
4. Set verification token for webhook authentication

## Configuration

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CHAT_CREDENTIALS` | Path to service account JSON key file | — |
| `GOOGLE_APPLICATION_CREDENTIALS` | Fallback credentials path (standard GCP env var) | — |
| `GOOGLE_CHAT_VERIFICATION_TOKEN` | Webhook verification token | — |
| `GOOGLE_CHAT_WEBHOOK_PORT` | Port for webhook HTTP server | `8765` |

### Config file (`eclaw.config.yaml`)

```yaml
channels:
  googlechat:
    enabled: true
    token: "your-verification-token"
    allowFrom:
      - "user@example.com"
      - "users/123456789"
```

## Capabilities

- **Chat types**: direct (DM), group (Room/Space), thread
- **Reactions**: supported
- **Media**: multipart upload with fallback to text-only
- **Threads**: supported
- **Block streaming**: true (sends complete messages)
- **Text chunk limit**: 4096 characters
- **Aliases**: google-chat, gchat

## Architecture

- **Gateway**: HTTP server on configurable port (default 8765). Health check at `GET /health`, webhook events at `POST /`.
- **Authentication**: Google service account via `google-auth-library` with `chat.bot` scope. Supports credentials file path or Application Default Credentials.
- **Webhook verification**: Timing-safe comparison of Bearer token against configured verification token. Padded buffers prevent length-based timing leaks.
- **Inbound**: Processes `MESSAGE` events only, filters bot senders, applies email/userId allowlist, caps messages at 8000 chars. Responds 200 immediately to prevent Google retries, processes asynchronously.
- **Outbound text**: POST to `https://chat.googleapis.com/v1/{space}/messages` with JSON body.
- **Outbound media**: Multipart upload to Chat API upload endpoint, then sends message with attachment reference. Falls back to text-only caption on upload failure.
- **Request limits**: 1 MB max request body size on webhook endpoint.
- **Chat type mapping**: DM -> "direct", ROOM/SPACE -> "group".
- **Space ID validation**: Must match `spaces/[a-zA-Z0-9_-]+` pattern, auto-prefixed if missing.
