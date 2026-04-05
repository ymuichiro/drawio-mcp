# Draw.io MCP App Server

The MCP App server renders draw.io diagrams **inline** in AI chat interfaces using the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) protocol. Instead of opening a browser tab, diagrams appear directly in the conversation as interactive iframes.

## How It Works

1. The LLM calls the `create_diagram` tool with draw.io XML, or `get_drawio_template_xml` to fetch a starter template
2. The host fetches the UI resource and renders it in a sandboxed iframe
3. The diagram is rendered using the official [draw.io viewer](https://viewer.diagrams.net)
4. The user sees an interactive diagram inline with zoom, pan, and layers support
5. In the Node.js self-hosted server, `create_diagram` can also return a temporary `previewId` so the host can call `get_diagram_preview` and inspect a rendered PNG before revising the XML

## Tool: `create_diagram`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `xml` | string | Yes | draw.io XML in mxGraphModel format |

The rendered diagram includes:
- Interactive zoom, pan, and navigation
- Layer toggling and lightbox mode
- "Open in draw.io" button to edit the diagram in the full editor
- Fullscreen mode
- In stateful HTTP sessions, a temporary `previewId` in `structuredContent` for follow-up PNG rendering

## Tool: `get_diagram_preview`

Returns a rendered `image/png` preview for a diagram that was previously created in the same MCP session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `previewId` | uuid string | Yes | Temporary preview identifier returned by `create_diagram` |

Behavior notes:

- The preview is session-bound, so a `previewId` created in one session cannot be reused from another session
- Preview entries expire after roughly 10 minutes
- The Node.js server stores the XML in a temporary directory and renders the PNG on demand through a local headless Chromium process
- The Cloudflare Worker deployment does not render previews because Workers do not have a browser runtime

## Tool: `get_drawio_template_xml`

Returns the XML for one official draw.io starter template at a time, so the host can request a concrete sample without dumping every template into the context window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `template` | enum | Yes | One of `AWS`, `AZURE`, `MINDMAP` |

Current mappings:

- `AWS` → upstream `cloud/aws/aws_1.xml`
- `AZURE` → upstream `cloud/azure/azure_1.xml`
- `MINDMAP` → upstream `maps/mind_map.xml`

The tool returns the raw `.drawio` XML text for only the requested template.

## Official Hosted Endpoint

The official draw.io MCP App server is hosted at:

```
https://mcp.draw.io/mcp
```

Add this URL as a remote MCP server in Claude.ai or any MCP Apps-compatible host — no installation or setup required.

## Self-Hosting

If you prefer to run your own instance, you can use Node.js or deploy to Cloudflare Workers.

### Installation

```bash
cd mcp-app-server
npm install
```

### Running (Node.js)

Start the HTTP server (for Claude.ai and other web-based hosts):

```bash
npm start
```

The server listens on `http://localhost:3001/mcp` by default. Set the `PORT` environment variable to change the port.

### Running with Docker

Build the container:

```bash
docker build -t drawio-mcp-app ./mcp-app-server
```

Run it locally:

```bash
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -e PORT=3001 \
  -e LISTEN=0.0.0.0 \
  -e ALLOWED_HOSTS=localhost,127.0.0.1 \
  -p 127.0.0.1:3001:3001 \
  drawio-mcp-app
```

This image runs as the unprivileged `node` user, uses production dependencies only, and exposes port `3001` inside the container.
It also bundles Chromium plus a vendored `viewer-static.min.js` so `get_diagram_preview` can render PNGs without giving the app container direct internet egress.

### Running with Docker Compose

The repository root includes a hardened [compose.yaml](../compose.yaml) that can start the app by itself, with a named Cloudflare Tunnel, or with a disposable Quick Tunnel.

The compose stack uses two Docker networks:

- `app_net` is an `internal: true` network shared by the MCP app and the tunnel sidecar
- `egress_net` is attached only to `cloudflared`, so the app container has no direct outbound internet path
- `ingress_net` is attached only to the localhost proxy, which binds `127.0.0.1:${APP_PORT}` on the host and forwards traffic to the app over `app_net`

1. Copy `.env.example` to `.env`
2. Adjust `APP_PORT` if you want a local port other than `13001`
3. Set `ALLOWED_HOSTS`
4. Start only the local app:

```bash
docker compose up -d --build
```

This publishes the MCP endpoint to `http://127.0.0.1:13001/mcp` by default.

If you prefer a shorter operational entry point, use the repository root [Makefile](/Users/you/github/oss/drawio-mcp/Makefile):

```bash
make init-env
make up
make up-quicktunnel
make down
```

### Running with Docker Compose + named Cloudflare Tunnel

1. Copy `.env.example` to `.env`
2. Set `CLOUDFLARE_TUNNEL_TOKEN` to your tunnel token
3. Set `ALLOWED_HOSTS` to your public hostname plus any local names you want to allow, for example `drawio.example.com,localhost,127.0.0.1`
4. In the Cloudflare dashboard, point the tunnel's service URL to `http://app:3001`
5. Start the stack:

```bash
docker compose --profile tunnel up -d --build
```

### Running with Docker Compose + Quick Tunnel

For ad-hoc testing without a Cloudflare account session on the host:

1. Copy `.env.example` to `.env`
2. Keep `QUICK_TUNNEL_HOST_HEADER` in sync with one of the values in `ALLOWED_HOSTS`
3. Start the stack:

```bash
docker compose --profile quicktunnel up -d --build
```

Read the temporary public URL from the logs:

```bash
make quicktunnel-url
```

The Quick Tunnel URL is ephemeral and changes when the container is recreated.

### Connecting to Claude.ai

Since Claude.ai needs a public URL, use a tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3001
```

Then add the tunnel URL (with `/mcp` appended) as a custom connector in Claude.ai settings.

### Using with Claude Desktop (stdio)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "drawio-app": {
      "command": "node",
      "args": ["path/to/mcp-app-server/src/index.js", "--stdio"]
    }
  }
}
```

> **Note:** Inline diagram rendering requires an MCP host that supports the MCP Apps extension. In hosts without MCP Apps support, the tool still works but returns the XML as text.

## Deploying to Cloudflare Workers

The server can be deployed to Cloudflare Workers for a public endpoint without tunnels.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Node.js 18+

### Deploy

```bash
npm install
npx wrangler login        # One-time: authenticate with Cloudflare
npm run deploy             # Build + deploy to Workers
```

The deploy script runs `node src/build-html.js` (pre-inlines the SDK bundles into the HTML) then `wrangler deploy`.

### Local development with Wrangler

```bash
npm run dev:worker
```

This starts a local Workers dev server at `http://localhost:8787/mcp`.

### How the Worker entry differs from Node.js

| | Node.js (`src/index.js`) | Worker (`src/worker.js`) |
|---|---|---|
| **Transport** | `StreamableHTTPServerTransport` (Express) | `WebStandardStreamableHTTPServerTransport` (Web Standard `Request`/`Response`) |
| **HTML build** | Reads bundles from `node_modules` at startup | Pre-built at deploy time via `src/build-html.js` → `src/generated-html.js` |
| **Preview PNGs** | Supported via headless Chromium + session-bound preview store | Not supported |
| **Schema validation** | Default (Zod-based) | Uses `@cfworker/json-schema` (Workers-compatible) |

## Architecture

### File layout

```
src/
  shared.js          Shared logic: buildHtml(), processAppBundle(), createServer()
  index.js           Node.js entry (Express + stdio transports)
  preview-store.js   Session-bound preview cache with 10-minute TTL
  preview-renderer.js Browser-based PNG renderer for preview requests
  worker.js          Cloudflare Workers entry (Web Standard fetch handler)
  build-html.js      Build script: generates generated-html.js + xml reference
  generated-html.js  (gitignored) Pre-built HTML string + XML reference for the Worker
vendor/
  viewer-static.min.js Vendored draw.io viewer used by the preview renderer
wrangler.toml        Wrangler configuration
../shared/
  xml-reference.md   Shared XML generation reference (single source of truth)
```

The `create_diagram` tool description is loaded from `shared/xml-reference.md` at startup (Node.js) or pre-built into `generated-html.js` at deploy time (Workers). This file is the single source of truth for XML generation guidance across all four approaches in the repository.

### How the HTML is built

The server inlines two bundles into a self-contained HTML string:

- **`app-with-deps.js`** (~319 KB) — MCP Apps SDK browser bundle from `@modelcontextprotocol/ext-apps`. The bundle is ESM (ends with `export { ... as App }`), so the server strips the export statement and creates a local `var App = <minifiedName>` alias. This makes it safe to inline in a plain `<script>` tag inside the sandboxed iframe.
- **`pako_deflate.min.js`** (~28 KB) — for compressing XML into the `#create=` URL format.

Both are inlined into the HTML served via `registerAppResource`. The inline chat viewer still loads `viewer-static.min.js` from CDN at runtime, while the preview renderer uses the vendored copy under `vendor/`.

For **Node.js**, this happens at startup (bundles read from `node_modules` via `fs`). For **Workers**, the `build-html.js` script does this at build time and writes `generated-html.js`.

### Key constraints

- The MCP Apps sandbox uses `sandbox="allow-scripts"` but **not** `allow-same-origin`, so Blob URL module imports fail silently. That's why the ESM export statement is stripped and a plain `var` alias is created.
- `app.openLink()` must be used instead of `<a target="_blank">` since the sandbox doesn't have `allow-popups`.
- `GraphViewer.processElements()` requires the container to have a nonzero `offsetWidth`, hence the `min-width: 200px` on `#diagram-container`.
