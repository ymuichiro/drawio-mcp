import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDiagramXml,
  describeDiagramXmlInput,
} from "../src/normalize-diagram-xml.js";

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

test("normalizeDiagramXml unwraps additional wrapped payload shapes", function()
{
  const xml = "<mxfile><diagram id=\"d1\" name=\"Page-1\"/></mxfile>";

  assert.equal(normalizeDiagramXml(JSON.stringify({ xml: xml })), xml);
  assert.equal(normalizeDiagramXml(JSON.stringify({ input: { text: xml } })), xml);
  assert.equal(normalizeDiagramXml(JSON.stringify({ input: { xml: xml } })), xml);
  assert.equal(
    normalizeDiagramXml(
      JSON.stringify(
        {
          content:
          [
            { type: "text", text: "Here is the XML" },
            { type: "text", text: xml },
          ],
        }
      )
    ),
    xml
  );
});

test("normalizeDiagramXml unwraps nested wrapper combinations within depth limit", function()
{
  const xml = "<mxGraphModel><root/></mxGraphModel>";
  const wrapped = JSON.stringify(
    {
      input:
      {
        content:
        [
          {
            type: "text",
            text: JSON.stringify({ xml: xml }),
          },
        ],
      },
    }
  );

  assert.equal(normalizeDiagramXml(wrapped), xml);
});

test("normalizeDiagramXml rejects malformed wrapped payloads", function()
{
  assert.equal(normalizeDiagramXml("{not-json"), null);
  assert.equal(normalizeDiagramXml({ nope: true }), null);
  assert.equal(
    normalizeDiagramXml(
      JSON.stringify(
        {
          content:
          [
            { type: "text", text: "Here is the XML" },
            { type: "text", text: "still not xml" },
          ],
        }
      )
    ),
    null
  );
  assert.equal(normalizeDiagramXml(JSON.stringify({ input: { value: "not xml" } })), null);
});

test("describeDiagramXmlInput summarizes request shape safely", function()
{
  assert.deepEqual(
    describeDiagramXmlInput(JSON.stringify({ input: { xml: "<mxfile><diagram/></mxfile>" } })),
    {
      shape: "json-string",
      preview: "{\"input\":{\"xml\":\"<mxfile><diagram/></mxfile>\"}}",
    }
  );
});
