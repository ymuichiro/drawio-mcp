import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DiagramPreviewStore } from "../src/preview-store.js";

async function createRootDir()
{
  return await fs.mkdtemp(path.join(os.tmpdir(), "drawio-mcp-preview-test-"));
}

test("DiagramPreviewStore binds previews to the creating session", async function(t)
{
  const rootDir = await createRootDir();
  const store = new DiagramPreviewStore(
  {
    rootDir,
    renderer:
    {
      async renderPng(xml)
      {
        return Buffer.from(`png:${xml}`);
      },
    },
  });

  t.after(async function()
  {
    await store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const preview = await store.createPreview("session-a", "<mxGraphModel />");
  const rendered = await store.renderPreview("session-a", preview.previewId);

  assert.ok(rendered);
  assert.equal(rendered.data.toString("utf8"), "png:<mxGraphModel />");

  const wrongSession = await store.renderPreview("session-b", preview.previewId);
  assert.equal(wrongSession, null);
});

test("DiagramPreviewStore expires previews after ttl", async function(t)
{
  const rootDir = await createRootDir();
  const store = new DiagramPreviewStore(
  {
    rootDir,
    ttlMs: 20,
    renderer:
    {
      async renderPng()
      {
        return Buffer.from("png");
      },
    },
  });

  t.after(async function()
  {
    await store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const preview = await store.createPreview("session-a", "<mxGraphModel />");

  await new Promise(function(resolve)
  {
    setTimeout(resolve, 30);
  });

  const rendered = await store.renderPreview("session-a", preview.previewId);
  assert.equal(rendered, null);
});
