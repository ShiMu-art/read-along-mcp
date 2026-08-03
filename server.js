import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const BASE = process.env.READALONG_BASE_URL || "https://read-along.zeabur.app";
const PORT = process.env.PORT || 3000;

async function api(method, path, body) {
  const url = BASE + path;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || data.raw || `${res.status}`);
  return data;
}

const server = new McpServer({
  name: "read-along-mcp",
  version: "1.0.0"
});

server.tool("list_books", "列出所有书籍", {}, async () => {
  const books = await api("GET", "/api/books");
  return { content: [{ type: "text", text: JSON.stringify(books, null, 2) }] };
});

server.tool("get_book", "获取书籍详情", {
  bookId: z.string().describe("书籍ID，从list_books获取")
}, async ({ bookId }) => {
  const book = await api("GET", `/api/book/${bookId}`);
  return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
});

server.tool("get_chapter", "获取章节内容", {
  bookId: z.string().describe("书籍ID"),
  chapter: z.number().int().min(1).describe("章节编号，从1开始")
}, async ({ bookId, chapter }) => {
  const data = await api("GET", `/api/book/${bookId}/chapter/${chapter}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("list_annotations", "获取某本书的批注列表", {
  bookId: z.string().describe("书籍ID")
}, async ({ bookId }) => {
  const data = await api("GET", `/api/annotations/${bookId}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("create_ai_annotation", "以AI身份创建批注", {
  bookId: z.string().describe("书籍ID"),
  chapter: z.number().int().min(1).describe("章节编号"),
  text: z.string().describe("批注文本内容"),
  range: z.string().optional().describe("选中文本范围（可选）"),
  cfi: z.string().optional().describe("EPUB CFI位置标记（可选）")
}, async ({ bookId, chapter, text, range, cfi }) => {
  const body = { bookId, chapter, text };
  if (range) body.range = range;
  if (cfi) body.cfi = cfi;
  const data = await api("POST", "/api/annotate", body);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("add_comment", "回复某条批注", {
  bookId: z.string().describe("书籍ID"),
  annotationId: z.string().describe("批注ID，从list_annotations获取"),
  text: z.string().describe("回复内容")
}, async ({ bookId, annotationId, text }) => {
  const data = await api("POST", `/api/annotations/${bookId}/${annotationId}/comment`, { text });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("list_bookmarks", "获取某本书的书签列表", {
  bookId: z.string().describe("书籍ID")
}, async ({ bookId }) => {
  const data = await api("GET", `/api/bookmarks/${bookId}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("search_gate", "在gate文本中搜索关键词", {
  bookId: z.string().describe("书籍ID"),
  keyword: z.string().describe("搜索关键词")
}, async ({ bookId, keyword }) => {
  const data = await api("GET", `/api/gate/${bookId}/search?q=${encodeURIComponent(keyword)}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_inbox", "获取推送收件箱消息", {
  unreadOnly: z.boolean().optional().default(false).describe("是否只看未读")
}, async ({ unreadOnly }) => {
  const qs = unreadOnly ? "?unread=1" : "";
  const data = await api("GET", `/api/push-inbox${qs}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("health", "检查read-along服务状态", {}, async () => {
  const data = await api("GET", "/health");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

const app = express();

let transport = null;
let connectPromise = null;

async function getTransport() {
  if (transport) return transport;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await server.connect(transport);
    console.log("MCP transport connected");
    return transport;
  })();
  return connectPromise;
}

app.post("/mcp", async (req, res) => {
  try {
    const t = await getTransport();
    await t.handleRequest(req, res);
  } catch (err) {
    console.error("MCP error:", err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`read-along MCP 服务运行在端口 ${PORT}`);
});