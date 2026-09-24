import { describe, expect, it } from "vitest"

import { retainedSuffix } from "./benchmark_context_capacity.mjs"

function boundaries(text: string) {
  const result = [0]
  let offset = 0
  for (const point of text) {
    offset += point.length
    result.push(offset)
  }
  return result
}

describe("context capacity", () => {
  const tokenizer = { count: (text: string) => Array.from(text).length }

  it("retains the complete input when it fits", () => {
    const text = "A🙂B"
    expect(retainedSuffix(tokenizer, text, boundaries(text), 3, 3)).toEqual({
      retainedBytes: Buffer.byteLength(text, "utf8"),
      retainedTokens: 3,
    })
  })

  it("trims from the start at a Unicode code point boundary", () => {
    const text = "A🙂B"
    expect(retainedSuffix(tokenizer, text, boundaries(text), 2, 3)).toEqual({
      retainedBytes: Buffer.byteLength("🙂B", "utf8"),
      retainedTokens: 2,
    })
  })
})
