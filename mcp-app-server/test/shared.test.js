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
