[English](README.md) | [中文](README.zh-CN.md)

# BotBell MCP Server

Let AI assistants send push notifications to your iPhone / Mac.

## What it does

After setup, your AI assistant (Claude, Cursor, etc.) can:

- **Send you notifications** — task results, alerts, reminders push to your phone
- **Read your replies** — you reply in the BotBell app, AI reads it and continues
- **Manage your bots** — list, create bots (PAT mode only)

## Authentication Modes

BotBell MCP Server supports two token types, auto-detected by prefix:

| Token Type | Prefix | Scope | Best For |
|------------|--------|-------|----------|
| **Bot Token** | `bt_` | Single bot only | Simple setup, one bot |
| **Personal Access Token (PAT)** | `pak_` | All your bots | Multi-bot, full control |

**Bot Token**: Get it from the BotBell app when you create a bot. One token = one bot.

**PAT**: Create one at BotBell app > Settings > API Keys. One token controls all your bots.

## Quick Start

### 1. Install BotBell app

Download from the App Store, create a Bot, and get your token.

### 2. Install MCP Server

```bash
npm install -g @botbell/mcp-server
```

### 3. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

**Option A: PAT mode (recommended)**

```json
{
  "mcpServers": {
    "botbell": {
      "command": "botbell-mcp",
      "env": {
        "BOTBELL_TOKEN": "pak_your_pat_here"
      }
    }
  }
}
```

**Option B: Bot Token mode**

```json
{
  "mcpServers": {
    "botbell": {
      "command": "botbell-mcp",
      "env": {
        "BOTBELL_TOKEN": "bt_your_token_here"
      }
    }
  }
}
```

### 4. Use it

Tell Claude:

- "Send a notification to my phone saying the build is done"
- "Analyze this log file and push the summary to my phone"
- "Check if I have any replies in BotBell"
- "List my bots" (PAT mode)
- "Create a new bot called Deploy Alerts" (PAT mode)

## Tools

### PAT Mode (`pak_` token)

#### `botbell_list_bots`

List all your bots. Use this to find the `bot_id` before sending.

#### `botbell_create_bot`

Create a new bot.

| Parameter | Required | Description |
|-----------|----------|-------------|
| name | Yes | Bot name (max 50 chars) |
| description | No | Bot description |

#### `botbell_send`

Send a push notification via a specific bot.

| Parameter | Required | Description |
|-----------|----------|-------------|
| bot_id | Yes | Bot ID (use `botbell_list_bots` to find) |
| message | Yes | Message content (max 4096 chars) |
| title | No | Notification title |
| url | No | URL to attach (tappable) |
| image_url | No | Image URL to attach |
| actions | No | Quick reply buttons (max 5), see [Actions](#actions) |

#### `botbell_get_replies`

Check for user replies to a specific bot.

| Parameter | Required | Description |
|-----------|----------|-------------|
| bot_id | Yes | Bot ID to check |
| limit | No | Max replies to fetch (default 20) |

### Bot Token Mode (`bt_` token)

#### `botbell_send`

Send a push notification.

| Parameter | Required | Description |
|-----------|----------|-------------|
| message | Yes | Message content (max 4096 chars) |
| title | No | Notification title |
| url | No | URL to attach (tappable) |
| image_url | No | Image URL to attach |
| actions | No | Quick reply buttons (max 5), see [Actions](#actions) |

#### `botbell_get_replies`

Fetch user replies from the BotBell app.

| Parameter | Required | Description |
|-----------|----------|-------------|
| limit | No | Max replies to fetch (default 20) |

## Extra Tokens

If you need to send notifications to bots from multiple accounts, you can configure additional Bot Tokens via the `BOTBELL_EXTRA_TOKENS` environment variable.

Format: `alias1:bt_token1,alias2:bt_token2`

```json
{
  "mcpServers": {
    "botbell": {
      "command": "botbell-mcp",
      "env": {
        "BOTBELL_TOKEN": "pak_your_pat_here",
        "BOTBELL_EXTRA_TOKENS": "team-ops:bt_abc123,home:bt_xyz789"
      }
    }
  }
}
```

When extra tokens are configured:

- The `alias` parameter becomes available on `botbell_send` and `botbell_get_replies`
- Use `alias` to route messages through a specific extra token
- In PAT mode, `botbell_list_bots` shows extra bots alongside your own
- Without `alias`, the primary token (`BOTBELL_TOKEN`) is used as default

## For Cursor / Other MCP Clients

Add to your MCP config:

```json
{
  "botbell": {
    "command": "botbell-mcp",
    "env": {
      "BOTBELL_TOKEN": "pak_your_pat_here"
    }
  }
}
```

## Actions

Add interactive buttons to your notifications. Users can tap to reply without typing.

```json
{
  "message": "Deploy v2.3 to production?",
  "actions": [
    { "key": "approve", "label": "Yes" },
    { "key": "reject", "label": "No" },
    { "key": "custom", "label": "Other...", "type": "input", "placeholder": "Enter reason" }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| key | Yes | Identifier returned when user taps (max 64 chars) |
| label | Yes | Button text shown to user (max 64 chars) |
| type | No | `"button"` (default) or `"input"` (opens text field) |
| placeholder | No | Placeholder for input field (max 128 chars) |

When the user taps an action, `botbell_get_replies` returns the `action` key along with the message content:

```
[2026-01-15T10:30:00.000Z] [action:approve] Yes
```

## Lightweight Alternatives

If MCP is more than you need:

- **SDKs** — Call the REST API directly from your code:
  - Python: `pip install botbell` ([PyPI](https://pypi.org/project/botbell/) · [GitHub](https://github.com/qq418716640/botbell-python))
  - JavaScript: `npm install @botbell/sdk` ([npm](https://www.npmjs.com/package/@botbell/sdk) · [GitHub](https://github.com/qq418716640/botbell-js))
- **Agent Skill** — One command to install, zero dependencies, works with 30+ AI tools: [BotBell Agent Skill](https://github.com/qq418716640/botbell-skill)

## Links

- [BotBell Website](https://botbell.app)
- [API Documentation](https://botbell.app/docs/api)
- [SDK Documentation](https://botbell.app/docs/sdk)
- [MCP Setup Guide](https://botbell.app/docs/mcp)
- [Agent Skill Guide](https://botbell.app/docs/skill)
