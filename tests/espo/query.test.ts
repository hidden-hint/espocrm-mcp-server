import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQuery } from "../../src/espo/query.js";

function serialize(value: unknown): string {
  const params = new URLSearchParams();
  applyQuery(params, value);

  return decodeURIComponent(params.toString());
}

test("applyQuery serializes a flat object of primitives", () => {
  assert.equal(serialize({ maxSize: 20, offset: 0, order: "desc" }), "maxSize=20&offset=0&order=desc");
});

test("applyQuery serializes nested where conditions into PHP bracket notation", () => {
  const query = { where: [{ type: "equals", attribute: "status", value: "New" }] };
  assert.equal(
    serialize(query),
    "where[0][type]=equals&where[0][attribute]=status&where[0][value]=New",
  );
});

test("applyQuery indexes multiple array elements", () => {
  const query = {
    where: [
      { type: "isTrue", attribute: "doNotCall" },
      { type: "equals", attribute: "source", value: "Web" },
    ],
  };
  assert.equal(
    serialize(query),
    "where[0][type]=isTrue&where[0][attribute]=doNotCall&where[1][type]=equals&where[1][attribute]=source&where[1][value]=Web",
  );
});

test("applyQuery skips undefined and null but keeps booleans and zero", () => {
  assert.equal(serialize({ a: undefined, b: null, c: false, d: 0 }), "c=false&d=0");
});

test("applyQuery stringifies boolean values", () => {
  assert.equal(serialize({ flag: true }), "flag=true");
});

test("applyQuery does nothing for a top-level undefined or null value", () => {
  assert.equal(serialize(undefined), "");
  assert.equal(serialize(null), "");
});
