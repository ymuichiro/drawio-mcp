#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtml, processAppBundle, createServer } from "./shared.js";
import { DiagramPreviewRenderer } from "./preview-renderer.js";
import { DiagramPreviewStore } from "./preview-store.js";

const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;

// Read the browser bundles once at startup and inline them into the HTML
const extAppsEntry = fileURLToPath(import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"));
const appWithDepsRaw = fs.readFileSync(extAppsEntry, "utf-8");
const appWithDepsJs = processAppBundle(appWithDepsRaw);

const pakoEntry = fileURLToPath(import.meta.resolve("pako"));
const pakoDeflateJs = fs.readFileSync(
  path.join(path.dirname(pakoEntry), "..", "dist", "pako_deflate.min.js"),
  "utf-8"
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerScriptPath = path.join(__dirname, "..", "vendor", "viewer-static.min.js");
const xmlReferenceCandidates = [
  path.join(__dirname, "..", "..", "shared", "xml-reference.md"),
  path.join(__dirname, "..", "shared", "xml-reference.md"),
];
const shapeIndexCandidates = [
  path.join(__dirname, "..", "..", "shape-search", "search-index.json"),
  path.join(__dirname, "..", "shape-search", "search-index.json"),
];

function findFirstExistingPath(candidates)
{
  for (const candidate of candidates)
  {
    if (fs.existsSync(candidate))
    {
      return candidate;
    }
  }

  return null;
}

const xmlReferencePath = findFirstExistingPath(xmlReferenceCandidates);
const xmlReference = xmlReferencePath
  ? fs.readFileSync(xmlReferencePath, "utf-8")
  : "";
const shapeIndexPath = findFirstExistingPath(shapeIndexCandidates);
var shapeIndex = null;

if (shapeIndexPath)
{
  shapeIndex = JSON.parse(fs.readFileSync(shapeIndexPath, "utf-8"));
  console.log("Shape index: " + shapeIndex.length + " shapes");
}

const html = buildHtml(appWithDepsJs, pakoDeflateJs);

function parseBooleanEnv(value)
{
  if (typeof value !== "string")
  {
    return Boolean(value);
  }

  return value === "1" || value.toLowerCase() === "true";
}

function parseAllowedHosts(value)
{
  if (!value)
  {
    return undefined;
  }

  const allowedHosts = value
    .split(",")
    .map(function(hostname) { return hostname.trim(); })
    .filter(Boolean);

  return allowedHosts.length > 0 ? allowedHosts : undefined;
}

function isInitializeRequest(body)
{
  return Boolean(body && typeof body === "object" && body.method === "initialize");
}

function getSessionIdHeader(req)
{
  const sessionId = req.headers["mcp-session-id"];

  return Array.isArray(sessionId) ? sessionId[0] : sessionId;
}

function summarizeRpcRequest(body)
{
  if (!body || typeof body !== "object")
  {
    return "unknown";
  }

  if (body.method === "tools/call")
  {
    return "tools/call:" + (body.params && body.params.name ? body.params.name : "unknown");
  }

  return body.method || "unknown";
}

async function startStreamableHTTPServer()
{
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.LISTEN ?? "127.0.0.1";
  const allowedHosts = parseAllowedHosts(process.env.ALLOWED_HOSTS);
  const chatgptCompatMode = parseBooleanEnv(process.env.CHATGPT_COMPAT_MODE);
  const previewService = new DiagramPreviewStore(
  {
    renderer: new DiagramPreviewRenderer({ viewerScriptPath }),
  });
  const sessions = new Map();
  const app = createMcpExpressApp(
  {
    host: host,
    allowedHosts: allowedHosts,
  });

  async function deleteSession(sessionId, closeTransport = false)
  {
    const session = sessions.get(sessionId);

    if (!session)
    {
      return;
    }

    sessions.delete(sessionId);

    if (closeTransport)
    {
      await session.transport.close().catch(function() {});
    }

    await session.server.close().catch(function() {});
    await previewService.clearSession(sessionId).catch(function() {});
  }

  async function cleanupStaleSessions()
  {
    const now = Date.now();
    const expiredSessionIds = [];

    for (const [sessionId, session] of sessions.entries())
    {
      if (now - session.lastAccess > SESSION_IDLE_TTL_MS)
      {
        expiredSessionIds.push(sessionId);
      }
    }

    await Promise.all(expiredSessionIds.map(function(sessionId)
    {
      return deleteSession(sessionId, true);
    }));

    await previewService.cleanupExpired().catch(function(error)
    {
      console.error("Failed to clean up expired previews:", error);
    });
  }

  async function createSession(req, res)
  {
    const server = createServer(
      html,
      {
        domain: process.env.DOMAIN,
        xmlReference,
        shapeIndex,
        previewService,
        chatgptCompatMode,
      }
    );
    let transport;

    transport = new StreamableHTTPServerTransport(
    {
      sessionIdGenerator: function() { return randomUUID(); },
      onsessioninitialized: function(sessionId)
      {
        sessions.set(sessionId,
        {
          server,
          transport,
          lastAccess: Date.now(),
        });

        if (process.env.MCP_DEBUG_REQUESTS === "1")
        {
          console.log("[session:init] session=%s", sessionId);
        }
      },
    });

    transport.onclose = function()
    {
      if (transport.sessionId)
      {
        if (process.env.MCP_DEBUG_REQUESTS === "1")
        {
          console.log("[session:close] session=%s", transport.sessionId);
        }

        deleteSession(transport.sessionId, false).catch(function() {});
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async function handleMcpRequest(req, res)
  {
    const sessionId = getSessionIdHeader(req);
    const rpcSummary = summarizeRpcRequest(req.body);

    try
    {
      await cleanupStaleSessions();

      if (process.env.MCP_DEBUG_REQUESTS === "1")
      {
        console.log(
          "[mcp:req] http=%s rpc=%s session=%s",
          req.method,
          rpcSummary,
          sessionId || "none"
        );
      }

      if (sessionId)
      {
        const session = sessions.get(sessionId);

        if (!session)
        {
          if (process.env.MCP_DEBUG_REQUESTS === "1")
          {
            console.warn("[mcp:missing-session] rpc=%s session=%s", rpcSummary, sessionId);
          }

          res.status(404).json(
          {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          });
          return;
        }

        session.lastAccess = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === "POST" && isInitializeRequest(req.body))
      {
        await createSession(req, res);
        return;
      }

      if (process.env.MCP_DEBUG_REQUESTS === "1")
      {
        console.warn("[mcp:bad-request] rpc=%s session=%s", rpcSummary, sessionId || "none");
      }

      res.status(400).json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
    }
    catch (error)
    {
      console.error("MCP error:", error);

      if (!res.headersSent)
      {
        res.status(500).json(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  }

  app.post("/mcp", handleMcpRequest);
  app.get("/mcp", handleMcpRequest);
  app.delete("/mcp", handleMcpRequest);

  const httpServer = app.listen(port, function()
  {
    console.log(`MCP App server listening on http://${host}:${port}/mcp`);
    console.log("ChatGPT compatibility mode: " + (chatgptCompatMode ? "enabled" : "disabled"));
  });

  const shutdown = async function()
  {
    console.log("\nShutting down...");

    for (const sessionId of sessions.keys())
    {
      await deleteSession(sessionId, true);
    }

    await previewService.close().catch(function() {});
    httpServer.close(function() { process.exit(0); });
    setTimeout(function() { process.exit(0); }, 1000).unref();
  };

  process.on("SIGINT", function() { shutdown().catch(function() { process.exit(1); }); });
  process.on("SIGTERM", function() { shutdown().catch(function() { process.exit(1); }); });
}

async function startStdioServer()
{
  const chatgptCompatMode = parseBooleanEnv(process.env.CHATGPT_COMPAT_MODE);

  await createServer(
    html,
    {
      domain: process.env.DOMAIN,
      xmlReference,
      shapeIndex,
      chatgptCompatMode,
    }
  ).connect(new StdioServerTransport());
}

async function main()
{
  if (process.argv.includes("--stdio"))
  {
    await startStdioServer();
  }
  else
  {
    await startStreamableHTTPServer();
  }
}

main().catch(function(e)
{
  console.error(e);
  process.exit(1);
});
