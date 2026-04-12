export const INVALID_DIAGRAM_XML_MESSAGE =
  "Expected draw.io XML or a wrapped payload containing XML. If your host wrapped the payload as JSON text, pass the raw XML string to `xml` when possible.";

const MAX_UNWRAP_DEPTH = 8;
const DEBUG_PREVIEW_LIMIT = 120;

function getXmlCandidate(value)
{
  if (typeof value === "string")
  {
    var trimmed = value.trim();

    if (
      trimmed.length > 0 &&
      trimmed.charAt(0) === "<" &&
      (trimmed.indexOf("<mxGraphModel") !== -1 || trimmed.indexOf("<mxfile") !== -1)
    )
    {
      return trimmed;
    }

    return null;
  }

  return null;
}

function parseJsonEnvelope(value)
{
  if (typeof value !== "string")
  {
    return null;
  }

  var trimmed = value.trim();

  if (trimmed.length === 0)
  {
    return null;
  }

  if (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")
  {
    return null;
  }

  try
  {
    return JSON.parse(trimmed);
  }
  catch (error)
  {
    return null;
  }
}

function getNestedCandidates(value)
{
  if (Array.isArray(value))
  {
    return value;
  }

  if (!value || typeof value !== "object")
  {
    return [];
  }

  var candidates = [];
  var prioritizedKeys = ["text", "xml", "content", "input"];
  var seenKeys = Object.create(null);

  for (var i = 0; i < prioritizedKeys.length; i++)
  {
    var key = prioritizedKeys[i];

    if (Object.prototype.hasOwnProperty.call(value, key))
    {
      seenKeys[key] = true;
      candidates.push(value[key]);
    }
  }

  var objectKeys = Object.keys(value);

  for (var j = 0; j < objectKeys.length; j++)
  {
    var objectKey = objectKeys[j];

    if (!seenKeys[objectKey])
    {
      candidates.push(value[objectKey]);
    }
  }

  return candidates;
}

function findXmlCandidate(value, depth)
{
  if (depth < 0 || value === null || value === undefined)
  {
    return null;
  }

  var directXml = getXmlCandidate(value);

  if (directXml)
  {
    return directXml;
  }

  var parsedJson = parseJsonEnvelope(value);

  if (parsedJson !== null)
  {
    return findXmlCandidate(parsedJson, depth - 1);
  }

  var candidates = getNestedCandidates(value);

  for (var i = 0; i < candidates.length; i++)
  {
    var xmlCandidate = findXmlCandidate(candidates[i], depth - 1);

    if (xmlCandidate)
    {
      return xmlCandidate;
    }
  }

  return null;
}

function classifyInputShape(value, depth)
{
  if (depth < 0)
  {
    return "depth-limit";
  }

  var directXml = getXmlCandidate(value);

  if (directXml)
  {
    return "raw-xml";
  }

  if (typeof value === "string")
  {
    return parseJsonEnvelope(value) !== null
      ? "json-string"
      : "string";
  }

  if (Array.isArray(value))
  {
    if (value.length === 0)
    {
      return "array:empty";
    }

    return "array:" + classifyInputShape(value[0], depth - 1);
  }

  if (!value || typeof value !== "object")
  {
    return value === null ? "null" : typeof value;
  }

  if (typeof value.text === "string")
  {
    return "object:text";
  }

  if (typeof value.xml === "string")
  {
    return "object:xml";
  }

  if (Array.isArray(value.content))
  {
    return "object:content";
  }

  if (value.input !== undefined)
  {
    return "object:input";
  }

  return "object:" + Object.keys(value).slice(0, 3).join(",");
}

function buildDebugPreview(value)
{
  var preview;

  if (typeof value === "string")
  {
    preview = value;
  }
  else
  {
    try
    {
      preview = JSON.stringify(value);
    }
    catch (error)
    {
      preview = String(value);
    }
  }

  if (typeof preview !== "string")
  {
    preview = String(preview);
  }

  preview = preview.replace(/\s+/g, " ").trim();

  if (preview.length > DEBUG_PREVIEW_LIMIT)
  {
    preview = preview.slice(0, DEBUG_PREVIEW_LIMIT) + "...";
  }

  return preview;
}

export function describeDiagramXmlInput(input)
{
  return {
    shape: classifyInputShape(input, MAX_UNWRAP_DEPTH),
    preview: buildDebugPreview(input),
  };
}

export const NORMALIZE_DIAGRAM_XML_BROWSER_RUNTIME = `
const MAX_UNWRAP_DEPTH = ${MAX_UNWRAP_DEPTH};
${getXmlCandidate.toString()}
${parseJsonEnvelope.toString()}
${getNestedCandidates.toString()}
${findXmlCandidate.toString()}
${normalizeDiagramXml.toString()}
`;

/**
 * Extracts raw draw.io XML from raw XML or common JSON-wrapped text payloads.
 *
 * Some MCP hosts (e.g. ChatGPT) wrap the XML string in a JSON envelope like
 * {"text": "<mxGraphModel ...>"} before sending it. This function peels off
 * up to 4 wrapper layers so the server and client can handle these payloads.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizeDiagramXml(input)
{
  return findXmlCandidate(input, MAX_UNWRAP_DEPTH);
}
