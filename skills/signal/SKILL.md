---
name: signal
description: Send and receive Signal messages via signal-cli. Supports direct and group messaging with media attachments.
metadata:
  {
    "eclaw":
      {
        "emoji": "📡",
        "primaryEnv": "SIGNAL_PHONE_NUMBER",
        "requires": { "bins": ["signal-cli"], "env": ["SIGNAL_PHONE_NUMBER"] },
      },
  }
---

# signal-cli

Use `signal-cli` to send/receive Signal messages. Your phone number is in `$SIGNAL_PHONE_NUMBER`.

Safety

- Require explicit recipient + message text before sending.
- Confirm recipient + message before sending.
- If anything is ambiguous, ask a clarifying question.

## Link device (first-time setup)

```bash
signal-cli link -n "EClaw"
```

Scan the QR code with Signal on your phone (Settings > Linked Devices > Link New Device).

## Receive messages

```bash
signal-cli -u $SIGNAL_PHONE_NUMBER receive --json --timeout 1
```

## Send text message

```bash
signal-cli -u $SIGNAL_PHONE_NUMBER send -m "Hello!" "+14155551212"
```

## Send to group

```bash
signal-cli -u $SIGNAL_PHONE_NUMBER send -m "Hello group!" -g "GROUP_ID"
```

## Send attachment

```bash
signal-cli -u $SIGNAL_PHONE_NUMBER send -m "See attached" -a /path/to/file.pdf "+14155551212"
```

## List groups

```bash
signal-cli -u $SIGNAL_PHONE_NUMBER listGroups
```

## Notes

- Install: `brew install signal-cli`
- Phone numbers must be in E.164 format (e.g. `+14155551212`).
- You must link signal-cli as a secondary device before first use.
- Messages are capped at 4000 characters.
- `--json` flag outputs one JSON object per line for machine parsing.
