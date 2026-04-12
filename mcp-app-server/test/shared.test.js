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
