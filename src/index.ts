#!/usr/bin/env node
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import Parser from "rss-parser";
import cors from "cors";

const RSS_URL = process.env.RSS_URL || "https://hnrss.org/frontpage";
const PORT = process.env.PORT || 3000;
const parser = new Parser();

const app = express();
app.use(cors());

// In-memory cache (refreshes every 5 min)
let feedCache: Parser.Output<{}> | null = null;
let lastFetch = 0;

async function refresh() {
  if (Date.now() - lastFetch < 5 * 60 * 1000) return;
  try {
    feedCache = await parser.parseURL(RSS_URL);
    lastFetch = Date.now();
  } catch (e) {
    console.error("RSS fetch failed:", e);
  }
}

// MCP server
const mcp = new Server(
  { name: "rss-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

mcp.addTool({
  name: "get_latest_items",
  description: "Return the most recent items from the RSS feed.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", default: 5, description: "max items to return" },
    },
  },
  execute: async ({ limit = 5 }) => {
    await refresh();
    if (!feedCache) throw new Error("Feed unavailable");
    const items = feedCache.items.slice(0, limit).map((i) => ({
      title: i.title,
      link: i.link,
      summary: i.contentSnippet || i.content || "",
      pubDate: i.pubDate,
    }));
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
  },
});

mcp.addTool({
  name: "search_items",
  description: "Search items by keyword in title or summary.",
  parameters: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "case-insensitive keyword" },
      limit: { type: "number", default: 10 },
    },
    required: ["keyword"],
  },
  execute: async ({ keyword, limit = 10 }) => {
    await refresh();
    if (!feedCache) throw new Error("Feed unavailable");
    const k = keyword.toLowerCase();
    const items = feedCache.items
      .filter(
        (i) =>
          i.title?.toLowerCase().includes(k) ||
          (i.contentSnippet || "").toLowerCase().includes(k)
      )
      .slice(0, limit)
      .map((i) => ({
        title: i.title,
        link: i.link,
        summary: i.contentSnippet || i.content || "",
        pubDate: i.pubDate,
      }));
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
  },
});

// SSE endpoint
app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  await mcp.connect(transport);
});

app.post("/messages", (req, res) => {
  // body parser handled by SSEServerTransport
});

app.get("/", (_req, res) =>
  res.send(`RSS MCP server running. Feed: ${RSS_URL}`)
);

app.listen(PORT, () => console.log(`Listening on :${PORT}`));
