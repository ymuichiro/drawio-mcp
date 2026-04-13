import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/shared.js";

test("createServer registers all app tools without throwing", function()
{
  assert.doesNotThrow(function()
  {
    createServer("<!DOCTYPE html><html><body></body></html>");
  });
});

test("create_diagram normalizes wrapped xml payloads before returning text content", async function()
{
  const server = createServer("<!DOCTYPE html><html><body></body></html>");
  const xml = "<mxfile><diagram id=\"d1\" name=\"Page-1\"/></mxfile>";
  const wrapped = JSON.stringify({ input: { xml: xml } });

  await assert.doesNotReject(async function()
  {
    const result = await server._registeredTools.create_diagram.handler(
      { xml: wrapped },
      { sessionId: "test-session" }
    );

    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].type, "text");
    assert.equal(result.content[0].text, xml);
  });
});

test("create_diagram returns preview metadata when compatibility mode is disabled", async function()
{
  let createPreviewCalls = 0;
  const server = createServer(
    "<!DOCTYPE html><html><body></body></html>",
    {
      previewService:
      {
        async createPreview()
        {
          createPreviewCalls += 1;
          return {
            previewId: "11111111-1111-4111-8111-111111111111",
            expiresAt: "2026-04-14T00:00:00.000Z",
            ttlSeconds: 600,
          };
        },
      },
    }
  );
  const xml = "<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>";

  const result = await server._registeredTools.create_diagram.handler(
    { xml: xml },
    { sessionId: "test-session" }
  );

  assert.equal(createPreviewCalls, 1);
  assert.deepEqual(
    result.structuredContent,
    {
      previewId: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-04-14T00:00:00.000Z",
      ttlSeconds: 600,
      previewTool: "get_diagram_preview",
    }
  );
});

test("create_diagram omits structuredContent in ChatGPT compatibility mode", async function()
{
  let createPreviewCalls = 0;
  const server = createServer(
    "<!DOCTYPE html><html><body></body></html>",
    {
      chatgptCompatMode: true,
      previewService:
      {
        async createPreview()
        {
          createPreviewCalls += 1;
          return {
            previewId: "11111111-1111-4111-8111-111111111111",
            expiresAt: "2026-04-14T00:00:00.000Z",
            ttlSeconds: 600,
          };
        },
      },
    }
  );
  const xml = "<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>";

  const result = await server._registeredTools.create_diagram.handler(
    { xml: xml },
    { sessionId: "test-session" }
  );

  assert.equal(createPreviewCalls, 0);
  assert.equal(result.structuredContent, undefined);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[0].text, xml);
});
