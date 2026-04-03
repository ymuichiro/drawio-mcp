import test from "node:test";
import assert from "node:assert/strict";
import {
  DIAGRAM_TEMPLATE_NAMES,
  getDiagramTemplate,
  getDiagramTemplateXml,
} from "../src/diagram-templates.js";

test("supported diagram templates stay discoverable", function()
{
  assert.deepEqual(DIAGRAM_TEMPLATE_NAMES, ["AWS", "AZURE", "MINDMAP"]);
});

test("each supported template returns mxfile xml", function()
{
  for (const templateName of DIAGRAM_TEMPLATE_NAMES)
  {
    const xml = getDiagramTemplateXml(templateName);

    assert.ok(xml);
    assert.match(xml, /^(<\?xml[^>]*\?>)?<mxfile/i);
  }
});

test("template metadata retains upstream source information", function()
{
  const azureTemplate = getDiagramTemplate("AZURE");

  assert.equal(
    azureTemplate.upstreamPath,
    "src/main/webapp/templates/cloud/azure/azure_1.xml"
  );
  assert.match(azureTemplate.upstreamUrl, /raw\.githubusercontent\.com/);
});

test("mind map template avoids external image dependencies", function()
{
  const mindMapXml = getDiagramTemplateXml("MINDMAP");

  assert.doesNotMatch(mindMapXml, /https?:\/\//);
  assert.doesNotMatch(mindMapXml, /shape=image/);
});
