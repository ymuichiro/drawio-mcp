import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { chromium } from "playwright-core";

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

async function findChromiumExecutable()
{
  for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES)
  {
    try
    {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    }
    catch
    {
      continue;
    }
  }

  throw new Error(
    "No Chromium-compatible executable was found. Set CHROMIUM_PATH or install Chromium/Google Chrome."
  );
}

function escapeInlineScript(value)
{
  return value.replace(/<\/script/giu, "<\\/script");
}

function buildPreviewHtml(viewerScript, xml)
{
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>draw.io Preview</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      #graph {
        background: #ffffff;
      }
    </style>
    <script>${escapeInlineScript(viewerScript)}</script>
  </head>
  <body>
    <div id="graph" class="mxgraph"></div>
    <script>
      const diagramXml = ${JSON.stringify(xml)};

      (function()
      {
        try
        {
          if (typeof GraphViewer === "undefined")
          {
            throw new Error("GraphViewer was not loaded.");
          }

          const graphDiv = document.getElementById("graph");
          const config =
          {
            xml: diagramXml,
            nav: false,
            resize: false,
            toolbar: "",
            "dark-mode": "light",
            highlight: "#0000ff",
          };

          graphDiv.setAttribute("data-mxgraph", JSON.stringify(config));
          GraphViewer.darkBackgroundColor = "#ffffff";
          GraphViewer.processElements();
          document.body.dataset.status = "rendering";
        }
        catch (error)
        {
          document.body.dataset.status = "error";
          document.body.dataset.error = String(error && error.message ? error.message : error);
        }
      })();
    </script>
  </body>
</html>`;
}

export class DiagramPreviewRenderer
{
  constructor(options = {})
  {
    this.viewerScriptPath = options.viewerScriptPath;
    this.browser = null;
    this.viewerScript = null;
  }

  async getViewerScript()
  {
    if (!this.viewerScript)
    {
      if (!this.viewerScriptPath)
      {
        throw new Error("Preview renderer is missing viewerScriptPath.");
      }

      this.viewerScript = await fs.readFile(this.viewerScriptPath, "utf8");
    }

    return this.viewerScript;
  }

  async getBrowser()
  {
    if (!this.browser)
    {
      const executablePath = await findChromiumExecutable();

      this.browser = await chromium.launch(
      {
        executablePath,
        headless: true,
        args:
        [
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-setuid-sandbox",
          "--font-render-hinting=medium",
          "--no-sandbox",
        ],
      });
    }

    return this.browser;
  }

  async renderPng(xml)
  {
    const browser = await this.getBrowser();
    const context = await browser.newContext(
    {
      deviceScaleFactor: 2,
      viewport:
      {
        width: 1600,
        height: 1200,
      },
    });
    const page = await context.newPage();

    try
    {
      const html = buildPreviewHtml(await this.getViewerScript(), xml);

      await page.setContent(html, { waitUntil: "load" });
      await page.waitForFunction(function()
      {
        return document.body.dataset.status === "rendering" || document.body.dataset.status === "error";
      }, { timeout: 5000 });

      const status = await page.locator("body").evaluate(function(body)
      {
        return {
          status: body.dataset.status,
          error: body.dataset.error || null,
        };
      });

      if (status.status !== "ready")
      {
        if (status.status === "error")
        {
          throw new Error(status.error || "draw.io preview rendering failed.");
        }

        try
        {
          await page.waitForSelector("#graph svg", { timeout: 15000, state: "attached" });
          await page.waitForTimeout(250);
        }
        catch
        {
          const error = await page.locator("body").evaluate(function(body)
          {
            return body.dataset.error || null;
          });

          throw new Error(error || "Timed out waiting for the draw.io preview to render.");
        }
      }

      return await page.locator("#graph").screenshot({ type: "png" });
    }
    finally
    {
      await context.close();
    }
  }

  async close()
  {
    if (this.browser)
    {
      await this.browser.close();
      this.browser = null;
    }
  }
}
