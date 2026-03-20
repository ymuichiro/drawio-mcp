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

// Read the browser bundles once at startup and inline them into the HTML
const extAppsEntry = fileURLToPath(import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"));
const appWithDepsRaw = fs.readFileSync(extAppsEntry, "utf-8");

// The bundle is ESM: ends with export{..., oc as App, ...}.
// We can't use <script type="module"> (export aliases aren't local vars)
// and Blob URL import() fails in sandboxed iframes without allow-same-origin.
// Fix: strip the export statement and create a local `App` alias.
const appWithDepsJs = processAppBundle(appWithDepsRaw);

const pakoEntry = fileURLToPath(import.meta.resolve("pako"));
const pakoDeflateJs = fs.readFileSync(
  path.join(path.dirname(pakoEntry), "..", "dist", "pako_deflate.min.js"),
  "utf-8"
);
const viewerScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "viewer-static.min.js");

// Pre-build the HTML once
const html = buildHtml(appWithDepsJs, pakoDeflateJs);
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

// --- Transport setup ---

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

async function startStreamableHTTPServer()
{
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.LISTEN ?? "127.0.0.1";
  const allowedHosts = parseAllowedHosts(process.env.ALLOWED_HOSTS);
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
        previewService,
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
      },
    });

    transport.onclose = function()
    {
      if (transport.sessionId)
      {
        deleteSession(transport.sessionId, false).catch(function() {});
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async function handleMcpRequest(req, res)
  {
    const sessionId = getSessionIdHeader(req);

    try
    {
      await cleanupStaleSessions();

      if (sessionId)
      {
        const session = sessions.get(sessionId);

        if (!session)
        {
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
  };

  process.on("SIGINT", function() { shutdown().catch(function() { process.exit(1); }); });
  process.on("SIGTERM", function() { shutdown().catch(function() { process.exit(1); }); });
}

async function startStdioServer()
{
  await createServer(
    html,
    {
      domain: process.env.DOMAIN,
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
