import { test } from "node:test"
import assert from "node:assert/strict"
import { pruneUndefined, truncate } from "../src/util.js"

test("truncate returns the text unchanged when within the limit", (): void => {
  assert.equal(truncate("abcdef", 6), "abcdef")
  assert.equal(truncate("abc", 6), "abc")
  assert.equal(truncate("", 6), "")
})

test("truncate slices and appends an ellipsis when over the limit", (): void => {
  assert.equal(truncate("abcdef", 3), "abc…")
  assert.equal(truncate("abcdef", 0), "…")
})

test("pruneUndefined drops only undefined values", (): void => {
  assert.deepEqual(pruneUndefined({ a: 1, b: undefined, c: null, d: "", e: false, f: 0 }), {
    a: 1,
    c: null,
    d: "",
    e: false,
    f: 0,
  })
})

test("pruneUndefined returns an empty object when everything is undefined", (): void => {
  assert.deepEqual(pruneUndefined({ a: undefined, b: undefined }), {})
})
