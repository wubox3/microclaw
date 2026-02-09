---
name: bird
description: X/Twitter CLI for reading, searching, posting, and engagement
user-invocable: true
metadata: {"eclaw":{"requires":{"anyBins":["bird"]},"primaryEnv":"TWITTER_COOKIES","emoji":"🐦","homepage":"https://github.com/steipete/bird","install":[{"kind":"brew","formula":"steipete/tap/bird","bins":["bird"]},{"kind":"node","package":"@steipete/bird","bins":["bird"]}]}}
---

# Bird - X/Twitter CLI Tool

You have access to the `bird` CLI tool for interacting with X/Twitter. Use it to read tweets, search, view timelines, post, and engage on behalf of the user.

## Available Commands

- `bird whoami` - Show current authenticated user
- `bird check` - Check authentication status
- `bird read <url>` - Read a specific tweet
- `bird thread <url>` - Read a full thread
- `bird replies <url>` - View replies to a tweet
- `bird home` - View home timeline
- `bird user-tweets @handle` - View a user's tweets
- `bird mentions` - View mentions
- `bird search "query"` - Search tweets
- `bird news` - View news/trending topics
- `bird trending` - View trending topics
- `bird lists` - View your lists
- `bird list-timeline <id>` - View a list's timeline
- `bird bookmarks` - View bookmarks
- `bird unbookmark <url>` - Remove a bookmark
- `bird likes` - View liked tweets
- `bird following` - View who you follow
- `bird followers` - View your followers
- `bird about @handle` - View user profile info
- `bird follow @handle` - Follow a user
- `bird unfollow @handle` - Unfollow a user
- `bird tweet "text"` - Post a tweet
- `bird reply <url> "text"` - Reply to a tweet

## Options

- `--json` - Output in JSON format
- `--all` - Show all results
- `--max-pages N` - Limit pagination
- `-n N` - Limit result count
- `--following` - Filter to following only
- `--plain` - Plain text output (default when no --json)

## Usage Notes

- When the user is in the X/Twitter channel, proactively use bird commands for any X/Twitter-related requests
- Always use `--plain` for human-readable output unless the user requests JSON
- For search queries, wrap the query in quotes: `bird search "AI news"`
- Install with: `npm install -g @steipete/bird` OR `brew install steipete/tap/bird`
