#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_API_BASE = "https://api.botbell.app/v1";

export function apiHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token.startsWith("pak_")) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    headers["X-Bot-Token"] = token;
  }
  return headers;
}

export async function apiRequest(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  apiBase: string = DEFAULT_API_BASE,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${apiBase}${path}`;
  const headers = apiHeaders(token);

  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json() as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

export function textResult(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

export function handleApiError(result: { ok: boolean; status: number; data: Record<string, unknown> }): string {
  const errorData = result.data as { code?: number; message?: string };
  if (errorData.code === 40029) return "Rate limit exceeded (max 60 messages/minute per bot)";
  if (errorData.code === 40030) return "Monthly message quota exceeded";
  if (errorData.code === 40003) return "Permission denied";
  return errorData.message || `API error (HTTP ${result.status})`;
}

// ============================================================
// Server factory
// ============================================================

export function createServer(token: string, apiBase: string = DEFAULT_API_BASE): McpServer {
  const isPatMode = token.startsWith("pak_");

  const server = new McpServer({
    name: "BotBell",
    version: "0.1.0",
  });

  function api(method: string, path: string, body?: Record<string, unknown>) {
    return apiRequest(token, method, path, body, apiBase);
  }

  // PAT-mode tools: list_bots, create_bot
  if (isPatMode) {
    server.tool(
      "botbell_list_bots",
      "List all bots available to you in BotBell. " +
      "Use this to find the bot_id before sending a notification.",
      {},
      async () => {
        try {
          const result = await api("GET", "/bots");
          if (!result.ok) return errorResult(`Failed to list bots: ${handleApiError(result)}`);

          const data = result.data.data as { bots: Array<Record<string, unknown>> };
          if (!data.bots || data.bots.length === 0) {
            return textResult("No bots found. Create one first with botbell_create_bot.");
          }

          const text = data.bots.map((b) =>
            `- ${b.name} (${b.bot_id})${b.description ? ` — ${b.description}` : ""}`
          ).join("\n");

          return textResult(`${data.bots.length} bot(s):\n\n${text}`);
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );

    server.tool(
      "botbell_create_bot",
      "Create a new bot in BotBell. Returns the bot_id to use with botbell_send.",
      {
        name: z.string().max(50).describe("Bot name (max 50 chars)"),
        description: z.string().max(200).optional().describe("Bot description (optional)"),
      },
      async ({ name, description }) => {
        try {
          const body: Record<string, unknown> = { name };
          if (description) body.description = description;

          const result = await api("POST", "/bots", body);
          if (!result.ok) return errorResult(`Failed to create bot: ${handleApiError(result)}`);

          const data = result.data.data as Record<string, unknown>;
          return textResult(
            `Bot created successfully.\n` +
            `Name: ${data.name}\n` +
            `Bot ID: ${data.bot_id}\n` +
            `Use this bot_id with botbell_send to push notifications.`
          );
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  }

  // Send notification (both modes)
  if (isPatMode) {
    server.tool(
      "botbell_send",
      "Send a push notification to the user's iPhone/Mac via BotBell. " +
      "Use botbell_list_bots first to find the bot_id. " +
      "Use this to deliver task results, alerts, reminders, or any message " +
      "the user should see on their phone. " +
      "You can include action buttons for quick replies. Use type 'input' to let the user type a custom response.",
      {
        bot_id: z.string().describe("Bot ID to send from (use botbell_list_bots to find it)"),
        message: z.string().max(4096).describe("Message content (required, max 4096 chars)"),
        title: z.string().max(256).optional().describe("Message title (optional, shown as notification header)"),
        url: z.string().url().max(2048).optional().describe("URL to attach (optional, user can tap to open)"),
        image_url: z.string().url().max(2048).optional().describe("Image URL to attach (optional)"),
        actions: z.array(z.object({
          key: z.string().max(64).describe("Action identifier returned when user taps"),
          label: z.string().max(64).describe("Button text shown to user"),
          type: z.enum(["button", "input"]).optional().describe("'button' (default) sends label as reply; 'input' opens a text field for custom input"),
          placeholder: z.string().max(128).optional().describe("Placeholder text for input field (only used when type is 'input')"),
        })).max(5).optional().describe("Quick reply buttons (max 5). Use type 'input' for free-text option."),
      },
      async ({ bot_id, message, title, url, image_url, actions }) => {
        try {
          const body: Record<string, unknown> = { message };
          if (title) body.title = title;
          if (url) body.url = url;
          if (image_url) body.image_url = image_url;
          if (actions) body.actions = actions;

          const result = await api("POST", `/bots/${bot_id}/push`, body);
          if (!result.ok) return errorResult(`Failed to send: ${handleApiError(result)}`);

          const data = result.data.data as Record<string, unknown>;
          return textResult(
            `Notification sent successfully.\n` +
            `Message ID: ${data.message_id}\n` +
            `Delivered: ${data.delivered}\n` +
            `Timestamp: ${data.timestamp}`
          );
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  } else {
    server.tool(
      "botbell_send",
      "Send a push notification to the user's iPhone/Mac via BotBell. " +
      "Use this to deliver task results, alerts, reminders, or any message " +
      "the user should see on their phone. " +
      "You can include action buttons for quick replies. Use type 'input' to let the user type a custom response.",
      {
        message: z.string().max(4096).describe("Message content (required, max 4096 chars)"),
        title: z.string().max(256).optional().describe("Message title (optional, shown as notification header)"),
        url: z.string().url().max(2048).optional().describe("URL to attach (optional, user can tap to open)"),
        image_url: z.string().url().max(2048).optional().describe("Image URL to attach (optional)"),
        actions: z.array(z.object({
          key: z.string().max(64).describe("Action identifier returned when user taps"),
          label: z.string().max(64).describe("Button text shown to user"),
          type: z.enum(["button", "input"]).optional().describe("'button' (default) sends label as reply; 'input' opens a text field for custom input"),
          placeholder: z.string().max(128).optional().describe("Placeholder text for input field (only used when type is 'input')"),
        })).max(5).optional().describe("Quick reply buttons (max 5). Use type 'input' for free-text option."),
      },
      async ({ message, title, url, image_url, actions }) => {
        try {
          const body: Record<string, unknown> = { message };
          if (title) body.title = title;
          if (url) body.url = url;
          if (image_url) body.image_url = image_url;
          if (actions) body.actions = actions;

          const pushUrl = `${apiBase}/push/${token}`;
          const response = await fetch(pushUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const result = await response.json() as Record<string, unknown>;

          if (!response.ok) {
            const errorData = result as { code?: number; message?: string };
            const errorMsg = errorData.code === 40029
              ? "Rate limit exceeded (max 60 messages/minute per bot)"
              : errorData.code === 40030
              ? "Monthly message quota exceeded"
              : errorData.message || `API error (HTTP ${response.status})`;
            return errorResult(`Failed to send: ${errorMsg}`);
          }

          const data = result.data as Record<string, unknown>;
          return textResult(
            `Notification sent successfully.\n` +
            `Message ID: ${data.message_id}\n` +
            `Delivered: ${data.delivered}\n` +
            `Timestamp: ${data.timestamp}`
          );
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  }

  // Get replies (both modes)
  if (isPatMode) {
    server.tool(
      "botbell_get_replies",
      "Check if the user has replied to messages in the BotBell app. " +
      "Use botbell_list_bots first to find the bot_id. " +
      "Messages are consumed on fetch (won't be returned again).",
      {
        bot_id: z.string().describe("Bot ID to check replies for"),
        limit: z.number().int().min(1).max(100).default(20)
          .describe("Max number of replies to fetch (default 20, max 100)"),
      },
      async ({ bot_id, limit }) => {
        try {
          const result = await api("GET", `/bots/${bot_id}/replies?limit=${limit}`);
          if (!result.ok) return errorResult(`Failed to fetch replies: ${handleApiError(result)}`);

          const data = result.data.data as { messages: Array<Record<string, unknown>> };
          const messages = data.messages;

          if (!messages || messages.length === 0) {
            return textResult("No new replies.");
          }

          const text = messages.map((m) =>
            `[${new Date((m.timestamp as number) * 1000).toISOString()}]${m.action ? ` [action:${m.action}]` : ""} ${m.content}`
          ).join("\n");

          return textResult(`${messages.length} new reply(s):\n\n${text}`);
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  } else {
    server.tool(
      "botbell_get_replies",
      "Check if the user has replied to your messages in the BotBell app. " +
      "Messages are consumed on fetch (won't be returned again).",
      {
        limit: z.number().int().min(1).max(100).default(20)
          .describe("Max number of replies to fetch (default 20, max 100)"),
      },
      async ({ limit }) => {
        try {
          const result = await api("GET", `/messages/poll?limit=${limit}`);
          if (!result.ok) return errorResult(`Failed to fetch replies: HTTP ${result.status}`);

          const data = result.data.data as { messages: Array<Record<string, unknown>> };
          const messages = data.messages;

          if (!messages || messages.length === 0) {
            return textResult("No new replies.");
          }

          const text = messages.map((m) =>
            `[${new Date((m.timestamp as number) * 1000).toISOString()}]${m.action ? ` [action:${m.action}]` : ""} ${m.content}`
          ).join("\n");

          return textResult(`${messages.length} new reply(s):\n\n${text}`);
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  }

  return server;
}

// ============================================================
// CLI entry point
// ============================================================

async function main() {
  const token = process.env.BOTBELL_TOKEN;
  if (!token) {
    throw new Error(
      "BOTBELL_TOKEN environment variable is required. " +
      "Get your token from the BotBell app."
    );
  }

  const server = createServer(token);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when run directly (not when imported in tests)
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
