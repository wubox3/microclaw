---
name: telegram
description: Send and receive Telegram messages via the Bot API using curl. Supports text, photos, documents, and polling for updates.
metadata:
  {
    "eclaw":
      {
        "emoji": "✈️",
        "primaryEnv": "TELEGRAM_BOT_TOKEN",
        "requires": { "env": ["TELEGRAM_BOT_TOKEN"] },
      },
  }
---

# Telegram Bot API

Use `curl` with the Telegram Bot API to send/receive messages.
The bot token is in `$TELEGRAM_BOT_TOKEN`. All endpoints use `https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/<method>`.

Safety

- Require explicit recipient + message text before sending.
- Confirm recipient + message before sending.
- If anything is ambiguous, ask a clarifying question.

## Verify bot

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe" | jq .
```

## Get updates (poll for messages)

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates?limit=10&timeout=0" | jq .
```

Use `offset` to acknowledge processed updates and get only new ones:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates?offset=LAST_UPDATE_ID_PLUS_1&limit=10&timeout=0" | jq .
```

## Send text message

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": CHAT_ID, "text": "Hello!", "parse_mode": "Markdown"}' | jq .
```

## Send photo

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto" \
  -F "chat_id=CHAT_ID" \
  -F "photo=@/path/to/image.jpg" \
  -F "caption=Optional caption" | jq .
```

## Send document

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendDocument" \
  -F "chat_id=CHAT_ID" \
  -F "document=@/path/to/file.pdf" \
  -F "caption=Optional caption" | jq .
```

## Get chat info

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getChat?chat_id=CHAT_ID" | jq .
```

## Notes

- `chat_id` is a numeric ID. Use `getUpdates` to discover chat IDs from incoming messages.
- Text messages are capped at 4096 characters. Split longer messages.
- `parse_mode` supports `Markdown` or `HTML` for formatted text.
- Files up to 50 MB can be sent via multipart upload.
- To create a bot: message [@BotFather](https://t.me/BotFather) on Telegram, use `/newbot`, and save the token.
- Group messages require the bot to be added to the group first.
- Private messages require the user to `/start` the bot first.
