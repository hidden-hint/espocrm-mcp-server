import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { log } from "../src/logger.js";

const realError = console.error;

afterEach(() => {
  console.error = realError;
});

test("log writes to stderr with the server prefix", () => {
  const captured: unknown[][] = [];
  console.error = (...parts: unknown[]) => {
    captured.push(parts);
  };
  log("hello", 42);
  assert.deepEqual(captured, [["[espocrm-mcp]", "hello", 42]]);
});
