[English](README.md) | [中文](README.zh-CN.md)

# BotBell MCP Server

让 AI 助手向你的 iPhone / Mac 发送推送通知。

## 功能

配置完成后，你的 AI 助手（Claude、Cursor 等）可以：

- **发送通知** — 任务结果、告警、提醒推送到手机
- **读取回复** — 你在 BotBell App 中回复，AI 读取后继续工作
- **管理 Bot** — 列出、创建 Bot（PAT 模式）

## 认证模式

BotBell MCP Server 支持两种 Token，根据前缀自动识别：

| Token 类型 | 前缀 | 作用域 | 适用场景 |
|------------|------|--------|----------|
| **Bot Token** | `bt_` | 单个 Bot | 简单场景，一个 Bot |
| **个人访问令牌 (PAT)** | `pak_` | 所有 Bot | 多 Bot，完整控制 |

**Bot Token**：在 BotBell App 中创建 Bot 时获取，一个 Token 对应一个 Bot。

**PAT**：在 BotBell App > 设置 > API Keys 中创建，一个 Token 管理所有 Bot。

## 快速开始

### 1. 安装 BotBell App

从 App Store 下载，创建一个 Bot，获取 Token。

### 2. 安装 MCP Server

```bash
npm install -g @botbell/mcp-server
```

### 3. 配置 Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

**方式 A：PAT 模式（推荐）**

```json
{
  "mcpServers": {
    "botbell": {
      "command": "botbell-mcp",
      "env": {
        "BOTBELL_TOKEN": "pak_你的PAT"
      }
    }
  }
}
```

**方式 B：Bot Token 模式**

```json
{
  "mcpServers": {
    "botbell": {
      "command": "botbell-mcp",
      "env": {
        "BOTBELL_TOKEN": "bt_你的Token"
      }
    }
  }
}
```

### 4. 开始使用

对 Claude 说：

- "给我手机发个通知，说构建完成了"
- "分析这个日志文件，把摘要推送到我手机"
- "看看 BotBell 有没有新回复"
- "列出我的 Bot"（PAT 模式）
- "创建一个叫「部署告警」的 Bot"（PAT 模式）

## 工具

### PAT 模式（`pak_` Token）

#### `botbell_list_bots`

列出所有 Bot，用于获取 `bot_id`。

#### `botbell_create_bot`

创建新 Bot。

| 参数 | 必填 | 说明 |
|------|------|------|
| name | 是 | Bot 名称（最多 50 字符） |
| description | 否 | Bot 描述 |

#### `botbell_send`

通过指定 Bot 发送推送通知。

| 参数 | 必填 | 说明 |
|------|------|------|
| bot_id | 是 | Bot ID（用 `botbell_list_bots` 获取） |
| message | 是 | 消息内容（最多 4096 字符） |
| title | 否 | 通知标题 |
| url | 否 | 附带链接（可点击打开） |
| image_url | 否 | 附带图片链接 |
| actions | 否 | 快捷回复按钮（最多 5 个），见 [Actions](#actions) |

#### `botbell_get_replies`

获取用户对指定 Bot 的回复。

| 参数 | 必填 | 说明 |
|------|------|------|
| bot_id | 是 | 要查询的 Bot ID |
| limit | 否 | 最多获取条数（默认 20） |

### Bot Token 模式（`bt_` Token）

#### `botbell_send`

发送推送通知。

| 参数 | 必填 | 说明 |
|------|------|------|
| message | 是 | 消息内容（最多 4096 字符） |
| title | 否 | 通知标题 |
| url | 否 | 附带链接（可点击打开） |
| image_url | 否 | 附带图片链接 |
| actions | 否 | 快捷回复按钮（最多 5 个），见 [Actions](#actions) |

#### `botbell_get_replies`

获取用户回复。

| 参数 | 必填 | 说明 |
|------|------|------|
| limit | 否 | 最多获取条数（默认 20） |

## Cursor / 其他 MCP 客户端

在 MCP 配置中添加：

```json
{
  "botbell": {
    "command": "botbell-mcp",
    "env": {
      "BOTBELL_TOKEN": "pak_你的PAT"
    }
  }
}
```

## Actions

为通知添加交互按钮，用户点选即可回复，无需手动输入。

```json
{
  "message": "是否部署 v2.3 到生产环境？",
  "actions": [
    { "key": "approve", "label": "是" },
    { "key": "reject", "label": "否" },
    { "key": "custom", "label": "其他...", "type": "input", "placeholder": "输入原因" }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| key | 是 | 用户点击后返回的标识符（最多 64 字符） |
| label | 是 | 按钮显示文字（最多 64 字符） |
| type | 否 | `"button"`（默认）或 `"input"`（弹出输入框） |
| placeholder | 否 | 输入框占位文字（最多 128 字符） |

用户点击 action 后，`botbell_get_replies` 返回的内容会包含 `action` 标识：

```
[2026-01-15T10:30:00.000Z] [action:approve] 是
```

## 链接

- [BotBell 官网](https://botbell.app)
- [API 文档](https://botbell.app/docs/api)
- [MCP 配置指南](https://botbell.app/docs/mcp)
