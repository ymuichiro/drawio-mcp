import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDiagramXml } from "../src/normalize-diagram-xml.js";

test("normalizeDiagramXml keeps raw xml unchanged", function()
{
  const xml = "<mxGraphModel><root/></mxGraphModel>";

  assert.equal(normalizeDiagramXml(xml), xml);
});

test("normalizeDiagramXml unwraps ChatGPT-style json text payloads", function()
{
  const xml = "<mxGraphModel><root/></mxGraphModel>";

  assert.equal(normalizeDiagramXml(JSON.stringify({ text: xml })), xml);
  assert.equal(
    normalizeDiagramXml(JSON.stringify({ content: [{ type: "text", text: xml }] })),
    xml
  );
});

test("normalizeDiagramXml rejects malformed wrapped payloads", function()
{
  assert.equal(normalizeDiagramXml("{not-json"), null);
  assert.equal(normalizeDiagramXml({ nope: true }), null);
});
