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
  if (errorData.code === 40029) return "Rate limit exceeded (max 30 messages/minute per bot)";
  if (errorData.code === 40030) return "Monthly message quota exceeded";
  if (errorData.code === 40003) return errorData.message || "Permission denied";
  return errorData.message || `API error (HTTP ${result.status})`;
}

/**
 * Parse "name1:bt_token1,name2:bt_token2" into a Map.
 */
export function parseExtraTokens(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw.trim()) return map;
  for (const pair of raw.split(",")) {
    const sep = pair.indexOf(":");
    if (sep <= 0) continue;
    const alias = pair.slice(0, sep).trim();
    const token = pair.slice(sep + 1).trim();
    if (alias && token.startsWith("bt_")) {
      map.set(alias, token);
    }
  }
  return map;
}

// ============================================================
// Shared action schema
// ============================================================

const actionSchema = z.object({
  key: z.string().max(64).describe("Action identifier returned when user taps"),
  label: z.string().max(64).describe("Button text shown to user"),
  type: z.enum(["button", "input"]).optional().describe("'button' (default) sends label as reply; 'input' opens a text field for custom input"),
  placeholder: z.string().max(128).optional().describe("Placeholder text for input field (only used when type is 'input')"),
});

const actionsSchema = z.array(actionSchema).max(5).optional()
  .describe("Quick reply buttons (max 5). Use type 'input' for free-text option.");

// ============================================================
// Shared formatting
// ============================================================

export function formatPollMessage(m: Record<string, unknown>): string {
  return `[${new Date((m.timestamp as number) * 1000).toISOString()}]${m.action ? ` [action:${m.action}]` : ""}${m.reply_to ? ` [reply_to:${m.reply_to}]` : ""} ${m.content}`;
}

// ============================================================
// Helpers for sending/polling via a bot token
// ============================================================

async function sendViaBotToken(
  btToken: string, apiBase: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof textResult>> {
  const response = await fetch(`${apiBase}/push/${btToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const errorData = result as { code?: number; message?: string };
    const errorMsg = errorData.code === 40029
      ? "Rate limit exceeded (max 30 messages/minute per bot)"
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
}

async function pollViaBotToken(
  btToken: string, apiBase: string, limit: number,
): Promise<ReturnType<typeof textResult>> {
  const result = await apiRequest(btToken, "GET", `/messages/poll?limit=${limit}`, undefined, apiBase);
  if (!result.ok) return errorResult(`Failed to fetch replies: HTTP ${result.status}`);

  const data = result.data.data as { messages: Array<Record<string, unknown>> };
  const messages = data.messages;

  if (!messages || messages.length === 0) {
    return textResult("No new replies.");
  }

  const text = messages.map(formatPollMessage).join("\n");

  return textResult(`${messages.length} new reply(s):\n\n${text}`);
}

function buildMessageBody(args: {
  message: string; title?: string; url?: string;
  image_url?: string; summary?: string; format?: string;
  actions_description?: string; actions?: unknown[];
  reply_mode?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { message: args.message };
  if (args.title) body.title = args.title;
  if (args.url) body.url = args.url;
  if (args.image_url) body.image_url = args.image_url;
  if (args.summary) body.summary = args.summary;
  if (args.format) body.format = args.format;
  if (args.actions_description) body.actions_description = args.actions_description;
  if (args.actions) body.actions = args.actions;
  if (args.reply_mode) body.reply_mode = args.reply_mode;
  return body;
}

// ============================================================
// Server factory
// ============================================================

export function createServer(
  token: string,
  apiBase: string = DEFAULT_API_BASE,
  extraTokens: Map<string, string> = new Map(),
): McpServer {
  const isPatMode = token.startsWith("pak_");
  const hasExtras = extraTokens.size > 0;
  const aliasNames = [...extraTokens.keys()];

  const server = new McpServer({
    name: "BotBell",
    version: "0.2.1",
  });

  function api(method: string, path: string, body?: Record<string, unknown>) {
    return apiRequest(token, method, path, body, apiBase);
  }

  function resolveAlias(alias: string): string | undefined {
    return extraTokens.get(alias);
  }

  // ── PAT-mode tools: list_bots, create_bot ──

  if (isPatMode) {
    server.tool(
      "botbell_list_bots",
      "List all bots available to you in BotBell. " +
      "Use this to find the bot_id or alias before sending a notification." +
      (hasExtras ? ` Extra tokens configured: ${aliasNames.join(", ")}.` : ""),
      {},
      async () => {
        try {
          const result = await api("GET", "/bots");
          if (!result.ok) return errorResult(`Failed to list bots: ${handleApiError(result)}`);

          const data = result.data.data as { bots: Array<Record<string, unknown>> };
          const lines: string[] = [];

          // Own bots
          if (data.bots && data.bots.length > 0) {
            lines.push(`Your bots (${data.bots.length}):`);
            for (const b of data.bots) {
              lines.push(`- ${b.name} (${b.bot_id})${b.description ? ` — ${b.description}` : ""}`);
            }
          } else {
            lines.push("No own bots found. Create one with botbell_create_bot.");
          }

          // Extra tokens
          if (hasExtras) {
            lines.push("");
            lines.push(`External bots (${extraTokens.size}):`);
            for (const alias of aliasNames) {
              lines.push(`- ${alias} (use alias="${alias}" to send/poll)`);
            }
          }

          return textResult(lines.join("\n"));
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );

    server.tool(
      "botbell_get_quota",
      "Check your BotBell message quota — how many messages you've used this month and how many remain.",
      {},
      async () => {
        try {
          const result = await api("GET", "/account/quota");
          if (!result.ok) return errorResult(`Failed to get quota: ${handleApiError(result)}`);

          const data = result.data.data as {
            plan: string; monthly_limit: number;
            used: number; remaining: number; reset_at: number;
          };

          const resetDate = new Date(data.reset_at * 1000).toISOString().split("T")[0];
          const lines = [
            `Plan: ${data.plan}`,
            `Used: ${data.used} / ${data.monthly_limit}`,
            `Remaining: ${data.remaining}`,
            `Resets: ${resetDate}`,
          ];
          if (data.plan === "free" && data.remaining === 0) {
            lines.push("\nQuota exhausted. Upgrade to Pro for unlimited messages.");
          }
          return textResult(lines.join("\n"));
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

  // ── Send notification ──

  if (isPatMode) {
    // PAT mode: bot_id for own bots, alias for external bots
    const sendSchema: Record<string, z.ZodType> = {
      message: z.string().max(4096).describe("Message content (required, max 4096 chars)"),
      title: z.string().max(256).optional().describe("Message title (optional)"),
      url: z.string().url().max(2048).optional().describe("URL to attach (optional)"),
      image_url: z.string().url().max(2048).optional().describe("Image URL to attach (optional)"),
      summary: z.string().max(512).optional().describe("Custom summary for long messages (optional, max 512 chars)"),
      format: z.enum(["text", "markdown"]).optional().describe("Message format: 'text' (default) or 'markdown' for Markdown rendering"),
      actions_description: z.string().max(256).optional().describe("Description text shown above action buttons (optional, max 256 chars)"),
      actions: actionsSchema,
      reply_mode: z.enum(["open", "actions_only", "none"]).optional()
        .describe("Controls how the recipient can reply: 'open' (default, free text + actions), 'actions_only' (only action buttons, no free text), 'none' (pure notification, no reply)"),
    };

    if (hasExtras) {
      sendSchema.bot_id = z.string().optional().describe("Bot ID for your own bot (use botbell_list_bots to find it). Provide either bot_id or alias.");
      sendSchema.alias = z.string().optional().describe(`Alias for an external bot token (${aliasNames.join(", ")}). Provide either bot_id or alias.`);
    } else {
      sendSchema.bot_id = z.string().describe("Bot ID to send from (use botbell_list_bots to find it)");
    }

    server.tool(
      "botbell_send",
      "Send a push notification to the user's iPhone/Mac via BotBell. " +
      (hasExtras
        ? "Use bot_id for your own bots or alias for external bots. Use botbell_list_bots to see all available targets. "
        : "Use botbell_list_bots first to find the bot_id. ") +
      "You can include action buttons for quick replies. Use type 'input' to let the user type a custom response.",
      sendSchema,
      async (args) => {
        try {
          const { bot_id, alias, ...msgArgs } = args as {
            bot_id?: string; alias?: string;
            message: string; title?: string; url?: string;
            image_url?: string; summary?: string; format?: string;
            actions_description?: string; actions?: unknown[];
            reply_mode?: string;
          };
          const body = buildMessageBody(msgArgs);

          // Route via alias (extra token)
          if (alias) {
            const btToken = resolveAlias(alias);
            if (!btToken) return errorResult(`Unknown alias "${alias}". Available: ${aliasNames.join(", ")}`);
            return await sendViaBotToken(btToken, apiBase, body);
          }

          // Route via bot_id (PAT)
          if (!bot_id) return errorResult("Provide either bot_id or alias.");
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
    // Bot token mode: primary token by default, alias for extras
    const sendSchema: Record<string, z.ZodType> = {
      message: z.string().max(4096).describe("Message content (required, max 4096 chars)"),
      title: z.string().max(256).optional().describe("Message title (optional)"),
      url: z.string().url().max(2048).optional().describe("URL to attach (optional)"),
      image_url: z.string().url().max(2048).optional().describe("Image URL to attach (optional)"),
      summary: z.string().max(512).optional().describe("Custom summary for long messages (optional, max 512 chars)"),
      format: z.enum(["text", "markdown"]).optional().describe("Message format: 'text' (default) or 'markdown' for Markdown rendering"),
      actions_description: z.string().max(256).optional().describe("Description text shown above action buttons (optional, max 256 chars)"),
      actions: actionsSchema,
      reply_mode: z.enum(["open", "actions_only", "none"]).optional()
        .describe("Controls how the recipient can reply: 'open' (default, free text + actions), 'actions_only' (only action buttons, no free text), 'none' (pure notification, no reply)"),
    };

    if (hasExtras) {
      sendSchema.alias = z.string().optional().describe(
        `Alias for an external bot token (${aliasNames.join(", ")}). Omit to use the default bot.`
      );
    }

    server.tool(
      "botbell_send",
      "Send a push notification to the user's iPhone/Mac via BotBell. " +
      (hasExtras ? `You can also send via external bots: ${aliasNames.join(", ")}. ` : "") +
      "You can include action buttons for quick replies. Use type 'input' to let the user type a custom response.",
      sendSchema,
      async (args) => {
        try {
          const { alias, ...msgArgs } = args as {
            alias?: string;
            message: string; title?: string; url?: string;
            image_url?: string; summary?: string; format?: string;
            actions_description?: string; actions?: unknown[];
            reply_mode?: string;
          };
          const body = buildMessageBody(msgArgs);

          // Route via alias (extra token)
          if (alias) {
            const btToken = resolveAlias(alias);
            if (!btToken) return errorResult(`Unknown alias "${alias}". Available: ${aliasNames.join(", ")}`);
            return await sendViaBotToken(btToken, apiBase, body);
          }

          // Default: primary bot token
          return await sendViaBotToken(token, apiBase, body);
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  }

  // ── Get replies ──

  if (isPatMode) {
    const repliesSchema: Record<string, z.ZodType> = {
      limit: z.number().int().min(1).max(100).default(20)
        .describe("Max number of replies to fetch (default 20, max 100)"),
    };

    if (hasExtras) {
      repliesSchema.bot_id = z.string().optional().describe("Bot ID for your own bot. Provide either bot_id or alias.");
      repliesSchema.alias = z.string().optional().describe(`Alias for an external bot (${aliasNames.join(", ")}). Provide either bot_id or alias.`);
    } else {
      repliesSchema.bot_id = z.string().describe("Bot ID to check replies for");
    }

    server.tool(
      "botbell_get_replies",
      "Check if the user has replied to messages in the BotBell app. " +
      (hasExtras
        ? "Use bot_id for your own bots or alias for external bots. "
        : "Use botbell_list_bots first to find the bot_id. ") +
      "Messages are consumed on fetch (won't be returned again).",
      repliesSchema,
      async (args) => {
        try {
          const { bot_id, alias, limit } = args as { bot_id?: string; alias?: string; limit: number };

          // Route via alias
          if (alias) {
            const btToken = resolveAlias(alias);
            if (!btToken) return errorResult(`Unknown alias "${alias}". Available: ${aliasNames.join(", ")}`);
            return await pollViaBotToken(btToken, apiBase, limit);
          }

          // Route via bot_id (PAT)
          if (!bot_id) return errorResult("Provide either bot_id or alias.");
          const result = await api("GET", `/bots/${bot_id}/replies?limit=${limit}`);
          if (!result.ok) return errorResult(`Failed to fetch replies: ${handleApiError(result)}`);

          const data = result.data.data as { messages: Array<Record<string, unknown>> };
          const messages = data.messages;

          if (!messages || messages.length === 0) {
            return textResult("No new replies.");
          }

          const text = messages.map(formatPollMessage).join("\n");

          return textResult(`${messages.length} new reply(s):\n\n${text}`);
        } catch (error) {
          return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  } else {
    const repliesSchema: Record<string, z.ZodType> = {
      limit: z.number().int().min(1).max(100).default(20)
        .describe("Max number of replies to fetch (default 20, max 100)"),
    };

    if (hasExtras) {
      repliesSchema.alias = z.string().optional().describe(
        `Alias for an external bot (${aliasNames.join(", ")}). Omit for the default bot.`
      );
    }

    server.tool(
      "botbell_get_replies",
      "Check if the user has replied to your messages in the BotBell app. " +
      "Messages are consumed on fetch (won't be returned again).",
      repliesSchema,
      async (args) => {
        try {
          const { alias, limit } = args as { alias?: string; limit: number };

          if (alias) {
            const btToken = resolveAlias(alias);
            if (!btToken) return errorResult(`Unknown alias "${alias}". Available: ${aliasNames.join(", ")}`);
            return await pollViaBotToken(btToken, apiBase, limit);
          }

          return await pollViaBotToken(token, apiBase, limit);
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

  const apiBase = process.env.BOTBELL_API_BASE || DEFAULT_API_BASE;
  const extraTokens = parseExtraTokens(process.env.BOTBELL_EXTRA_TOKENS || "");
  const server = createServer(token, apiBase, extraTokens);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when run directly (not when imported in tests)
import { realpathSync } from "fs";
const resolvedArgv = realpathSync(process.argv[1] || "");
const isDirectRun = import.meta.url === `file://${resolvedArgv}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
