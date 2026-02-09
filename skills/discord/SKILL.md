---
name: discord
description: Discord Bot API channel with gateway lifecycle. Supports DMs, guild channels, threads, reactions, media, polls, stickers, moderation, and presence management.
metadata: { "eclaw": { "emoji": "🎮", "requires": { "config": ["channels.discord"], "env": ["DISCORD_BOT_TOKEN"] } } }
---

# Discord Channel

## Overview

Discord integration via [discord.js](https://discord.js.org/). Bidirectional messaging through the Discord Bot API with gateway intents for guilds, DMs, and message content.

## Prerequisites

1. A Discord bot application with a bot token
2. Bot invited to your server with appropriate permissions
3. Set `DISCORD_BOT_TOKEN` environment variable or `channels.discord.token` in config

## Configuration

### Environment variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token |

### Config file (`eclaw.config.yaml`)

```yaml
channels:
  discord:
    enabled: true
    token: "your-bot-token"
    allowFrom:
      - "123456789012345678"  # Discord user IDs
```

## Capabilities

- **Chat types**: direct, channel, thread
- **Reactions**: supported
- **Media**: file attachments with MIME-based extensions
- **Threads**: supported
- **Text chunk limit**: 2000 characters (Discord limit)

## Architecture

- **Gateway**: discord.js Client with intents `Guilds`, `GuildMessages`, `DirectMessages`, `MessageContent` and partial `Channel`
- **Inbound**: Listens on `MessageCreate` event, filters bot messages and applies `allowFrom` user ID allowlist, caps messages at 8000 chars
- **Outbound**: Sends text/media via `channel.send()` after fetching sendable channels (GuildText, DM, PublicThread, PrivateThread) by snowflake ID
- **Chat type resolution**: DM channels -> "direct", thread channels -> "thread", everything else -> "channel"

## Actions

Use `discord` to manage messages, reactions, threads, polls, and moderation. You can disable groups via `discord.actions.*` (defaults to enabled, except roles/moderation). The tool uses the bot token configured for EClaw.

### Inputs to collect

- For reactions: `channelId`, `messageId`, and an `emoji`.
- For fetchMessage: `guildId`, `channelId`, `messageId`, or a `messageLink` like `https://discord.com/channels/<guildId>/<channelId>/<messageId>`.
- For stickers/polls/sendMessage: a `to` target (`channel:<id>` or `user:<id>`). Optional `content` text.
- Polls also need a `question` plus 2-10 `answers`.
- For media: `mediaUrl` with `file:///path` for local files or `https://...` for remote.
- For emoji uploads: `guildId`, `name`, `mediaUrl`, optional `roleIds` (limit 256KB, PNG/JPG/GIF).
- For sticker uploads: `guildId`, `name`, `description`, `tags`, `mediaUrl` (limit 512KB, PNG/APNG/Lottie JSON).

Message context lines include `discord message id` and `channel` fields you can reuse directly.

**Note:** `sendMessage` uses `to: "channel:<id>"` format, not `channelId`. Other actions like `react`, `readMessages`, `editMessage` use `channelId` directly.
**Note:** `fetchMessage` accepts message IDs or full links like `https://discord.com/channels/<guildId>/<channelId>/<messageId>`.

### Action groups

| Action group | Default | Notes |
|-------------|---------|-------|
| reactions | enabled | React + list reactions + emojiList |
| messages | enabled | Read/send/edit/delete |
| threads | enabled | Create/list/reply |
| pins | enabled | Pin/unpin/list |
| search | enabled | Search messages |
| stickers | enabled | Send stickers |
| polls | enabled | Create polls |
| permissions | enabled | Check bot permissions |
| memberInfo | enabled | Member info |
| roleInfo | enabled | Role info |
| channelInfo | enabled | Channel info |
| voiceStatus | enabled | Voice status |
| events | enabled | Scheduled events |
| emojiUploads | enabled | Upload custom emojis |
| stickerUploads | enabled | Upload stickers |
| roles | **disabled** | Role add/remove |
| channels | **disabled** | Channel/category CRUD |
| moderation | **disabled** | Timeout/kick/ban |
| presence | **disabled** | Bot status/activity |

### React to a message

```json
{
  "action": "react",
  "channelId": "123",
  "messageId": "456",
  "emoji": "✅"
}
```

### List reactions + users

```json
{
  "action": "reactions",
  "channelId": "123",
  "messageId": "456",
  "limit": 100
}
```

### Send a sticker

```json
{
  "action": "sticker",
  "to": "channel:123",
  "stickerIds": ["9876543210"],
  "content": "Nice work!"
}
```

- Up to 3 sticker IDs per message.
- `to` can be `user:<id>` for DMs.

### Upload a custom emoji

```json
{
  "action": "emojiUpload",
  "guildId": "999",
  "name": "party_blob",
  "mediaUrl": "file:///tmp/party.png",
  "roleIds": ["222"]
}
```

### Upload a sticker

```json
{
  "action": "stickerUpload",
  "guildId": "999",
  "name": "eclaw_wave",
  "description": "EClaw waving hello",
  "tags": "wave",
  "mediaUrl": "file:///tmp/wave.png"
}
```

### Create a poll

```json
{
  "action": "poll",
  "to": "channel:123",
  "question": "Lunch?",
  "answers": ["Pizza", "Sushi", "Salad"],
  "allowMultiselect": false,
  "durationHours": 24,
  "content": "Vote now"
}
```

### Check bot permissions

```json
{
  "action": "permissions",
  "channelId": "123"
}
```

### Read recent messages

```json
{
  "action": "readMessages",
  "channelId": "123",
  "limit": 20
}
```

### Fetch a single message

```json
{
  "action": "fetchMessage",
  "guildId": "999",
  "channelId": "123",
  "messageId": "456"
}
```

### Send/edit/delete a message

```json
{
  "action": "sendMessage",
  "to": "channel:123",
  "content": "Hello from EClaw"
}
```

With media:

```json
{
  "action": "sendMessage",
  "to": "channel:123",
  "content": "Check this out!",
  "mediaUrl": "file:///tmp/audio.mp3"
}
```

```json
{
  "action": "editMessage",
  "channelId": "123",
  "messageId": "456",
  "content": "Fixed typo"
}
```

```json
{
  "action": "deleteMessage",
  "channelId": "123",
  "messageId": "456"
}
```

### Threads

```json
{ "action": "threadCreate", "channelId": "123", "name": "Bug triage", "messageId": "456" }
```

```json
{ "action": "threadList", "guildId": "999" }
```

```json
{ "action": "threadReply", "channelId": "777", "content": "Replying in thread" }
```

### Pins

```json
{ "action": "pinMessage", "channelId": "123", "messageId": "456" }
```

```json
{ "action": "listPins", "channelId": "123" }
```

### Search messages

```json
{
  "action": "searchMessages",
  "guildId": "999",
  "content": "release notes",
  "channelIds": ["123", "456"],
  "limit": 10
}
```

### Member + role info

```json
{ "action": "memberInfo", "guildId": "999", "userId": "111" }
```

```json
{ "action": "roleInfo", "guildId": "999" }
```

### List custom emojis

```json
{ "action": "emojiList", "guildId": "999" }
```

### Role changes (disabled by default)

```json
{ "action": "roleAdd", "guildId": "999", "userId": "111", "roleId": "222" }
```

### Channel info

```json
{ "action": "channelInfo", "channelId": "123" }
```

```json
{ "action": "channelList", "guildId": "999" }
```

### Channel management (disabled by default)

```json
{ "action": "channelCreate", "guildId": "999", "name": "general-chat", "type": 0, "parentId": "888", "topic": "General discussion" }
```

```json
{ "action": "categoryCreate", "guildId": "999", "name": "Projects" }
```

```json
{ "action": "channelEdit", "channelId": "123", "name": "new-name", "topic": "Updated topic" }
```

```json
{ "action": "channelMove", "guildId": "999", "channelId": "123", "parentId": "888", "position": 2 }
```

```json
{ "action": "channelDelete", "channelId": "123" }
```

### Voice status

```json
{ "action": "voiceStatus", "guildId": "999", "userId": "111" }
```

### Scheduled events

```json
{ "action": "eventList", "guildId": "999" }
```

### Moderation (disabled by default)

```json
{ "action": "timeout", "guildId": "999", "userId": "111", "durationMinutes": 10 }
```

### Bot presence/activity (disabled by default)

```json
{ "action": "setPresence", "activityType": "playing", "activityName": "with fire" }
```

```json
{ "action": "setPresence", "activityType": "custom", "activityState": "Vibing" }
```

```json
{ "action": "setPresence", "status": "dnd" }
```

Parameters: `activityType` (playing/streaming/listening/watching/competing/custom), `activityName`, `activityUrl`, `activityState`, `status` (online/dnd/idle/invisible).

## Discord Writing Style Guide

**Keep it conversational!** Discord is a chat platform, not documentation.

### Do

- Short, punchy messages (1-3 sentences ideal)
- Multiple quick replies > one wall of text
- Use emoji for tone/emphasis
- Lowercase casual style is fine
- Break up info into digestible chunks

### Don't

- No markdown tables (Discord renders them as ugly raw `| text |`)
- No `## Headers` for casual chat (use **bold** or CAPS for emphasis)
- Avoid multi-paragraph essays
- Don't over-explain simple things
