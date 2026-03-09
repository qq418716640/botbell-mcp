# Changelog

## 0.2.1 (2026-03-09)

### Features

- **`botbell_get_quota`** — New tool to check message quota usage (PAT mode only). Shows plan, used/remaining messages, and reset date.

## 0.2.0 (2026-03-09)

### Features

- **Extra tokens** — Configure additional Bot Tokens via `BOTBELL_EXTRA_TOKENS` for multi-account scenarios
- **`alias` parameter** — Route `botbell_send` and `botbell_get_replies` through extra tokens by alias
- **Dynamic tool schemas** — `alias` and `bot_id` parameters adapt based on configuration

## 0.1.0 (2026-03-09)

Initial release.

### Features

- **botbell_send** — Send push notifications to iPhone/Mac
- **botbell_get_replies** — Fetch user replies (with action key support)
- **botbell_list_bots** — List all bots (PAT mode)
- **botbell_create_bot** — Create new bots (PAT mode)
- **Dual auth modes** — Bot Token (`bt_`) and Personal Access Token (`pak_`), auto-detected
- **Interactive actions** — Attach reply buttons with optional free-text input (`type: "input"`)
- **Rich notifications** — Support title, URL, image attachments
