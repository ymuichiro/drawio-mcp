import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ROOT_DIR = path.join(os.tmpdir(), "drawio-mcp-preview");
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

function buildPreviewMetadata(previewId, expiresAt)
{
  return {
    previewId,
    expiresAt: new Date(expiresAt).toISOString(),
    ttlSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
  };
}

export class DiagramPreviewStore
{
  constructor(options = {})
  {
    this.renderer = options.renderer;
    this.rootDir = options.rootDir || DEFAULT_ROOT_DIR;
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs || DEFAULT_CLEANUP_INTERVAL_MS;
    this.ready = false;
    this.cleanupTimer = setInterval(() =>
    {
      this.cleanupExpired().catch(function(error)
      {
        console.error("Failed to clean up expired previews:", error);
      });
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === "function")
    {
      this.cleanupTimer.unref();
    }
  }

  isEnabled()
  {
    return Boolean(this.renderer);
  }

  async ensureReady()
  {
    if (!this.ready)
    {
      await fs.mkdir(this.rootDir, { recursive: true });
      this.ready = true;
    }
  }

  getSessionDir(sessionId)
  {
    return path.join(this.rootDir, sessionId);
  }

  getPreviewBasePath(sessionId, previewId)
  {
    return path.join(this.getSessionDir(sessionId), previewId);
  }

  getPreviewPaths(sessionId, previewId)
  {
    const basePath = this.getPreviewBasePath(sessionId, previewId);

    return {
      metadataPath: `${basePath}.json`,
      xmlPath: `${basePath}.drawio`,
      pngPath: `${basePath}.png`,
    };
  }

  async createPreview(sessionId, xml)
  {
    if (!this.isEnabled())
    {
      return null;
    }

    await this.ensureReady();
    await this.cleanupExpired();

    const previewId = randomUUID();
    const sessionDir = this.getSessionDir(sessionId);
    const paths = this.getPreviewPaths(sessionId, previewId);
    const expiresAt = Date.now() + this.ttlMs;

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(paths.xmlPath, xml, "utf8");
    await fs.writeFile(
      paths.metadataPath,
      JSON.stringify({ previewId, expiresAt }),
      "utf8"
    );

    return buildPreviewMetadata(previewId, expiresAt);
  }

  async readPreviewMetadata(sessionId, previewId)
  {
    const paths = this.getPreviewPaths(sessionId, previewId);

    try
    {
      const raw = await fs.readFile(paths.metadataPath, "utf8");
      const metadata = JSON.parse(raw);

      if (!metadata || typeof metadata.expiresAt !== "number")
      {
        return null;
      }

      if (metadata.expiresAt <= Date.now())
      {
        await this.deletePreview(sessionId, previewId);
        return null;
      }

      return {
        expiresAt: metadata.expiresAt,
        paths,
      };
    }
    catch
    {
      return null;
    }
  }

  async renderPreview(sessionId, previewId)
  {
    if (!this.isEnabled())
    {
      return null;
    }

    await this.ensureReady();
    const preview = await this.readPreviewMetadata(sessionId, previewId);

    if (!preview)
    {
      return null;
    }

    let data;

    try
    {
      data = await fs.readFile(preview.paths.pngPath);
    }
    catch
    {
      const xml = await fs.readFile(preview.paths.xmlPath, "utf8");
      data = await this.renderer.renderPng(xml);
      await fs.writeFile(preview.paths.pngPath, data);
    }

    return {
      data,
      mimeType: "image/png",
      ...buildPreviewMetadata(previewId, preview.expiresAt),
    };
  }

  async deletePreview(sessionId, previewId)
  {
    const paths = this.getPreviewPaths(sessionId, previewId);

    await Promise.all(
    [
      fs.rm(paths.metadataPath, { force: true }),
      fs.rm(paths.xmlPath, { force: true }),
      fs.rm(paths.pngPath, { force: true }),
    ]);

    try
    {
      await fs.rmdir(this.getSessionDir(sessionId));
    }
    catch
    {
      return;
    }
  }

  async clearSession(sessionId)
  {
    if (!sessionId)
    {
      return;
    }

    await fs.rm(this.getSessionDir(sessionId), { recursive: true, force: true });
  }

  async cleanupExpired()
  {
    if (!this.ready)
    {
      return;
    }

    let sessionEntries;

    try
    {
      sessionEntries = await fs.readdir(this.rootDir, { withFileTypes: true });
    }
    catch
    {
      return;
    }

    await Promise.all(sessionEntries.map(async (sessionEntry) =>
    {
      if (!sessionEntry.isDirectory())
      {
        return;
      }

      const sessionDir = path.join(this.rootDir, sessionEntry.name);
      const previewEntries = await fs.readdir(sessionDir, { withFileTypes: true }).catch(function()
      {
        return [];
      });

      await Promise.all(previewEntries.map(async (previewEntry) =>
      {
        if (!previewEntry.isFile() || !previewEntry.name.endsWith(".json"))
        {
          return;
        }

        const previewId = previewEntry.name.slice(0, -".json".length);
        const metadataPath = path.join(sessionDir, previewEntry.name);

        try
        {
          const raw = await fs.readFile(metadataPath, "utf8");
          const metadata = JSON.parse(raw);

          if (!metadata || typeof metadata.expiresAt !== "number" || metadata.expiresAt <= Date.now())
          {
            await this.deletePreview(sessionEntry.name, previewId);
          }
        }
        catch
        {
          await this.deletePreview(sessionEntry.name, previewId);
        }
      }));

      const remainingEntries = await fs.readdir(sessionDir).catch(function()
      {
        return [];
      });

      if (remainingEntries.length === 0)
      {
        await fs.rm(sessionDir, { recursive: true, force: true });
      }
    }));
  }

  async close()
  {
    clearInterval(this.cleanupTimer);

    if (this.renderer && typeof this.renderer.close === "function")
    {
      await this.renderer.close();
    }
  }
}
