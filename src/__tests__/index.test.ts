import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createServer,
  apiHeaders,
  handleApiError,
  errorResult,
  textResult,
  parseExtraTokens,
} from "../index.js";

// ============================================================
// Unit tests for utility functions
// ============================================================

describe("apiHeaders", () => {
  it("uses Authorization header for PAT tokens", () => {
    const headers = apiHeaders("pak_abc123");
    expect(headers["Authorization"]).toBe("Bearer pak_abc123");
    expect(headers["X-Bot-Token"]).toBeUndefined();
  });

  it("uses X-Bot-Token header for bot tokens", () => {
    const headers = apiHeaders("bt_abc123");
    expect(headers["X-Bot-Token"]).toBe("bt_abc123");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("always includes Content-Type", () => {
    expect(apiHeaders("pak_x")["Content-Type"]).toBe("application/json");
    expect(apiHeaders("bt_x")["Content-Type"]).toBe("application/json");
  });
});

describe("handleApiError", () => {
  it("maps rate limit code", () => {
    const msg = handleApiError({ ok: false, status: 429, data: { code: 40029 } });
    expect(msg).toContain("Rate limit");
  });

  it("maps quota exceeded code", () => {
    const msg = handleApiError({ ok: false, status: 403, data: { code: 40030 } });
    expect(msg).toContain("quota exceeded");
  });

  it("maps permission denied code", () => {
    const msg = handleApiError({ ok: false, status: 403, data: { code: 40003 } });
    expect(msg).toContain("Permission denied");
  });

  it("falls back to message field", () => {
    const msg = handleApiError({ ok: false, status: 400, data: { message: "Bad request" } });
    expect(msg).toBe("Bad request");
  });

  it("falls back to HTTP status", () => {
    const msg = handleApiError({ ok: false, status: 500, data: {} });
    expect(msg).toBe("API error (HTTP 500)");
  });
});

describe("errorResult / textResult", () => {
  it("errorResult sets isError", () => {
    const r = errorResult("fail");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("fail");
  });

  it("textResult has no isError", () => {
    const r = textResult("ok");
    expect(r).not.toHaveProperty("isError");
    expect(r.content[0].text).toBe("ok");
  });
});

describe("parseExtraTokens", () => {
  it("parses valid pairs", () => {
    const m = parseExtraTokens("deploy:bt_aaa,monitor:bt_bbb");
    expect(m.size).toBe(2);
    expect(m.get("deploy")).toBe("bt_aaa");
    expect(m.get("monitor")).toBe("bt_bbb");
  });

  it("trims whitespace", () => {
    const m = parseExtraTokens(" deploy : bt_aaa , monitor : bt_bbb ");
    expect(m.get("deploy")).toBe("bt_aaa");
    expect(m.get("monitor")).toBe("bt_bbb");
  });

  it("ignores non-bt_ tokens", () => {
    const m = parseExtraTokens("bad:pak_xxx,good:bt_yyy");
    expect(m.size).toBe(1);
    expect(m.get("good")).toBe("bt_yyy");
  });

  it("handles empty string", () => {
    expect(parseExtraTokens("").size).toBe(0);
    expect(parseExtraTokens("  ").size).toBe(0);
  });

  it("ignores malformed entries", () => {
    const m = parseExtraTokens("nocolon,bt_abc,:bt_xyz,ok:bt_123");
    expect(m.size).toBe(1);
    expect(m.get("ok")).toBe("bt_123");
  });
});

// ============================================================
// Integration tests via MCP Client + InMemoryTransport
// ============================================================

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(handler as typeof fetch);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successSendResponse() {
  return jsonResponse(200, {
    code: 0,
    data: { message_id: "msg_ok", delivered: true, timestamp: 1700000000 },
  });
}

async function connectClient(
  token: string,
  apiBase: string,
  extraTokens?: Map<string, string>,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createServer(token, apiBase, extraTokens);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

// --- PAT mode tests (no extras) ---

describe("PAT mode (pak_ token)", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(async () => {
    fetchMock = mockFetch(async () => jsonResponse(200, { code: 0, data: {} }));
    const conn = await connectClient("pak_test123", "http://localhost:8090/v1");
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    fetchMock.mockRestore();
  });

  it("registers PAT-mode tools (list_bots, create_bot, send, get_replies)", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("botbell_list_bots");
    expect(names).toContain("botbell_create_bot");
    expect(names).toContain("botbell_send");
    expect(names).toContain("botbell_get_replies");
  });

  it("botbell_send requires bot_id in PAT mode without extras", async () => {
    const { tools } = await client.listTools();
    const sendTool = tools.find((t) => t.name === "botbell_send");
    const schema = sendTool!.inputSchema as { required?: string[] };
    expect(schema.required).toContain("bot_id");
  });

  it("botbell_list_bots returns formatted bot list", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        code: 0,
        data: {
          bots: [
            { name: "Deploy Bot", bot_id: "bot_1", description: "CI alerts" },
            { name: "Monitor", bot_id: "bot_2" },
          ],
        },
      })
    );

    const result = await client.callTool({ name: "botbell_list_bots", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Your bots (2)");
    expect(text).toContain("Deploy Bot (bot_1)");
    expect(text).toContain("CI alerts");
    expect(text).toContain("Monitor (bot_2)");
  });

  it("botbell_list_bots handles empty list", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, { code: 0, data: { bots: [] } })
    );

    const result = await client.callTool({ name: "botbell_list_bots", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("No own bots found");
  });

  it("botbell_create_bot sends correct request", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      return jsonResponse(200, {
        code: 0,
        data: { name: body.name, bot_id: "bot_new1" },
      });
    });

    const result = await client.callTool({
      name: "botbell_create_bot",
      arguments: { name: "My Bot", description: "Test bot" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Bot created successfully");
    expect(text).toContain("bot_new1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/bots");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "My Bot", description: "Test bot" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer pak_test123");
  });

  it("botbell_send passes actions to API", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        code: 0,
        data: { message_id: "msg_1", delivered: true, timestamp: 1700000000 },
      })
    );

    const actions = [
      { key: "approve", label: "Yes" },
      { key: "custom", label: "Other...", type: "input", placeholder: "Enter reason" },
    ];

    const result = await client.callTool({
      name: "botbell_send",
      arguments: { bot_id: "bot_1", message: "Deploy?", actions },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Notification sent successfully");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/bots/bot_1/push");
    const body = JSON.parse(init.body as string);
    expect(body.actions).toHaveLength(2);
    expect(body.actions[1].type).toBe("input");
    expect(body.actions[1].placeholder).toBe("Enter reason");
  });

  it("botbell_send handles API error", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(429, { code: 40029, message: "Rate limited" })
    );

    const result = await client.callTool({
      name: "botbell_send",
      arguments: { bot_id: "bot_1", message: "Hello" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Rate limit");
  });

  it("botbell_get_replies includes action key in output", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        code: 0,
        data: {
          messages: [
            { content: "Yes", timestamp: 1700000000, action: "approve" },
            { content: "No thanks", timestamp: 1700000001 },
          ],
        },
      })
    );

    const result = await client.callTool({
      name: "botbell_get_replies",
      arguments: { bot_id: "bot_1" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("2 new reply(s)");
    expect(text).toContain("[action:approve] Yes");
    expect(text).toContain("No thanks");
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}.*\] No thanks/);
  });

  it("botbell_get_replies handles empty queue", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, { code: 0, data: { messages: [] } })
    );

    const result = await client.callTool({
      name: "botbell_get_replies",
      arguments: { bot_id: "bot_1" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe("No new replies.");
  });
});

// --- Bot token mode tests (no extras) ---

describe("Bot token mode (bt_ token)", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(async () => {
    fetchMock = mockFetch(async () => jsonResponse(200, { code: 0, data: {} }));
    const conn = await connectClient("bt_test456", "http://localhost:8090/v1");
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    fetchMock.mockRestore();
  });

  it("registers only send and get_replies (no list_bots/create_bot)", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("botbell_send");
    expect(names).toContain("botbell_get_replies");
    expect(names).not.toContain("botbell_list_bots");
    expect(names).not.toContain("botbell_create_bot");
  });

  it("botbell_send does NOT require bot_id", async () => {
    const { tools } = await client.listTools();
    const sendTool = tools.find((t) => t.name === "botbell_send");
    const schema = sendTool!.inputSchema as { required?: string[] };
    expect(schema.required).not.toContain("bot_id");
  });

  it("botbell_send uses token-in-URL push endpoint", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () => successSendResponse());

    await client.callTool({
      name: "botbell_send",
      arguments: { message: "Hello from bot token" },
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/push/bt_test456");
  });

  it("botbell_send with actions via bot token mode", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () => successSendResponse());

    const actions = [
      { key: "yes", label: "Approve" },
      { key: "no", label: "Reject" },
    ];

    const result = await client.callTool({
      name: "botbell_send",
      arguments: { message: "Deploy v2?", actions },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Notification sent successfully");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.actions).toEqual(actions);
  });

  it("botbell_send handles quota exceeded", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(403, { code: 40030, message: "Quota exceeded" })
    );

    const result = await client.callTool({
      name: "botbell_send",
      arguments: { message: "Test" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("quota exceeded");
  });

  it("botbell_get_replies uses X-Bot-Token header", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, { code: 0, data: { messages: [] } })
    );

    await client.callTool({
      name: "botbell_get_replies",
      arguments: {},
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/messages/poll");
    expect((init.headers as Record<string, string>)["X-Bot-Token"]).toBe("bt_test456");
  });

  it("botbell_send with all optional fields", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () => successSendResponse());

    await client.callTool({
      name: "botbell_send",
      arguments: {
        message: "Check this",
        title: "Alert",
        url: "https://example.com",
        image_url: "https://example.com/img.png",
        actions: [{ key: "ok", label: "OK", type: "button" }],
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("Check this");
    expect(body.title).toBe("Alert");
    expect(body.url).toBe("https://example.com");
    expect(body.image_url).toBe("https://example.com/img.png");
    expect(body.actions[0].type).toBe("button");
  });
});

// --- PAT mode + extra tokens ---

describe("PAT mode with extra tokens", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;
  const extras = new Map([["deploy", "bt_deploy1"], ["monitor", "bt_monitor2"]]);

  beforeEach(async () => {
    fetchMock = mockFetch(async () => jsonResponse(200, { code: 0, data: {} }));
    const conn = await connectClient("pak_test123", "http://localhost:8090/v1", extras);
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    fetchMock.mockRestore();
  });

  it("botbell_send has optional bot_id and alias", async () => {
    const { tools } = await client.listTools();
    const sendTool = tools.find((t) => t.name === "botbell_send");
    const schema = sendTool!.inputSchema as { required?: string[] };
    // bot_id should NOT be required when extras exist
    expect(schema.required).not.toContain("bot_id");
  });

  it("botbell_list_bots shows both own bots and external aliases", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        code: 0,
        data: { bots: [{ name: "My Bot", bot_id: "bot_1" }] },
      })
    );

    const result = await client.callTool({ name: "botbell_list_bots", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Your bots (1)");
    expect(text).toContain("My Bot (bot_1)");
    expect(text).toContain("External bots (2)");
    expect(text).toContain("deploy");
    expect(text).toContain("monitor");
  });

  it("botbell_send via alias uses push URL with extra token", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () => successSendResponse());

    const result = await client.callTool({
      name: "botbell_send",
      arguments: { alias: "deploy", message: "Deployed v3" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Notification sent successfully");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/push/bt_deploy1");
  });

  it("botbell_send via bot_id still uses PAT API", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        code: 0,
        data: { message_id: "msg_pat", delivered: true, timestamp: 1700000000 },
      })
    );

    await client.callTool({
      name: "botbell_send",
      arguments: { bot_id: "bot_1", message: "Hello via PAT" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/bots/bot_1/push");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer pak_test123");
  });

  it("botbell_send with unknown alias returns error", async () => {
    const result = await client.callTool({
      name: "botbell_send",
      arguments: { alias: "unknown", message: "Test" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Unknown alias "unknown"');
    expect(text).toContain("deploy");
  });

  it("botbell_send with neither bot_id nor alias returns error", async () => {
    const result = await client.callTool({
      name: "botbell_send",
      arguments: { message: "No target" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("bot_id or alias");
  });

  it("botbell_get_replies via alias polls with extra token", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, { code: 0, data: { messages: [] } })
    );

    await client.callTool({
      name: "botbell_get_replies",
      arguments: { alias: "monitor" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/messages/poll");
    expect((init.headers as Record<string, string>)["X-Bot-Token"]).toBe("bt_monitor2");
  });

  it("botbell_get_replies via bot_id still uses PAT API", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        code: 0,
        data: { messages: [{ content: "Hi", timestamp: 1700000000 }] },
      })
    );

    await client.callTool({
      name: "botbell_get_replies",
      arguments: { bot_id: "bot_1" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/bots/bot_1/replies");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer pak_test123");
  });
});

// --- Bot token mode + extra tokens ---

describe("Bot token mode with extra tokens", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;
  const extras = new Map([["alerts", "bt_alerts1"]]);

  beforeEach(async () => {
    fetchMock = mockFetch(async () => jsonResponse(200, { code: 0, data: {} }));
    const conn = await connectClient("bt_primary", "http://localhost:8090/v1", extras);
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    fetchMock.mockRestore();
  });

  it("botbell_send without alias uses primary token", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () => successSendResponse());

    await client.callTool({
      name: "botbell_send",
      arguments: { message: "Default bot" },
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/push/bt_primary");
  });

  it("botbell_send with alias uses extra token", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () => successSendResponse());

    await client.callTool({
      name: "botbell_send",
      arguments: { alias: "alerts", message: "Alert!" },
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8090/v1/push/bt_alerts1");
  });

  it("botbell_get_replies without alias uses primary token", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, { code: 0, data: { messages: [] } })
    );

    await client.callTool({
      name: "botbell_get_replies",
      arguments: {},
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Bot-Token"]).toBe("bt_primary");
  });

  it("botbell_get_replies with alias uses extra token", async () => {
    fetchMock.mockRestore();
    fetchMock = mockFetch(async () =>
      jsonResponse(200, { code: 0, data: { messages: [] } })
    );

    await client.callTool({
      name: "botbell_get_replies",
      arguments: { alias: "alerts" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Bot-Token"]).toBe("bt_alerts1");
  });

  it("has alias parameter in send schema", async () => {
    const { tools } = await client.listTools();
    const sendTool = tools.find((t) => t.name === "botbell_send");
    const props = (sendTool!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("alias");
  });
});
