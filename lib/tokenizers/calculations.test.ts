import { describe, expect, it } from "vitest"

import { charactersPerToken, countBytes, countWords, rankedResults, safeTokenDisplay } from "./calculations"
import type { TokenizerResult } from "./types"

describe("shared tokenizer calculations", () => {
  it.each([
    ["plain prose", 2],
    ["  whitespace\n and\ttabs  ", 3],
    ["你好 世界", 2],
    ["مرحباً بالعالم", 2],
    ["👩🏽‍🚀 family", 2],
    ["", 0],
  ])("counts words for %j", (text, expected) => expect(countWords(text)).toBe(expected))

  it("counts UTF-8 bytes and ratios", () => {
    expect(countBytes("é")).toBe(2)
    expect(countBytes("👩‍🚀")).toBe(11)
    expect(charactersPerToken("abcd", 2)).toBe(2)
    expect(charactersPerToken("", 0)).toBe(0)
  })

  it("makes invisible values inspectable without changing the raw value", () => {
    expect(safeTokenDisplay(" \t\n")).toBe("·⇥↵\n")
    expect(safeTokenDisplay("", [0xff])).toBe("bytes FF")
  })

  it("ranks successful results stably, including ties", () => {
    const result = (lab: TokenizerResult["lab"], tokenCount: number): TokenizerResult => ({
      lab,
      modelId: lab,
      status: "ok",
      tokenCount,
      fidelity: "official_tokenizer",
      sourceUrl: "https://example.com",
    })
    expect(rankedResults([result("qwen", 5), result("openai", 5), result("meta", 3)]).map((item) => item.lab)).toEqual(["meta", "openai", "qwen"])
  })
})
