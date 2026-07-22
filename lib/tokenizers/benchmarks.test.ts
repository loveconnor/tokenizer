import { describe, expect, it } from "vitest"

import {
  BENCHMARK_DOMAINS,
  BENCHMARK_SUITE_CASES,
  BENCHMARK_SUITE_TEXT,
  CODE_BENCHMARK_CASES,
  EMOJI_URL_BENCHMARK_CASES,
  MULTILINGUAL_BENCHMARK_CASES,
  PROSE_BENCHMARK_CASES,
  compressionRatio,
  measureTokenizerBenchmarks,
} from "./benchmarks"

describe("intrinsic tokenizer benchmarks", () => {
  const encodeCharacters = (text: string) => Array.from(text, (_, index) => index)

  it("uses ratios of summed UTF-8 bytes and tokens for fixed suites", () => {
    expect(compressionRatio(["é", "ab"], encodeCharacters)).toBeCloseTo(4 / 3)
    expect(PROSE_BENCHMARK_CASES).toHaveLength(4)
    expect(MULTILINGUAL_BENCHMARK_CASES).toHaveLength(3)
    expect(CODE_BENCHMARK_CASES).toHaveLength(3)
    expect(EMOJI_URL_BENCHMARK_CASES).toHaveLength(4)
    expect(BENCHMARK_DOMAINS.map((domain) => domain.label)).toEqual([
      "Prose",
      "Multilingual",
      "Code",
      "Emoji / URLs",
    ])
    expect(BENCHMARK_SUITE_CASES).toHaveLength(14)
    expect(BENCHMARK_SUITE_TEXT).toContain("Can we reproduce the result?")
    expect(BENCHMARK_SUITE_TEXT).toContain("https://例え.テスト")
  })

  it("defines prompt fertility and isolated one-token coverage explicitly", () => {
    const encode = (text: string) => text === "one" ? [1] : Array.from(text, (_, index) => index)
    let time = 0
    const metrics = measureTokenizerBenchmarks(
      "one three three",
      6,
      encode,
      () => {
        time += 10
        return time
      },
    )
    expect(metrics.version).toBe("intrinsic-v2")
    expect(metrics.currentBytesPerToken).toBe(2.5)
    expect(metrics.currentTokensPerWord).toBe(2)
    expect(metrics.singleTokenWordCoverage).toBeCloseTo(1 / 3)
    expect(metrics.proseBytesPerToken).toBeGreaterThan(1)
    expect(metrics.multilingualBytesPerToken).toBeGreaterThan(1)
    expect(metrics.codeBytesPerToken).toBe(1)
    expect(metrics.emojiUrlBytesPerToken).toBeGreaterThan(1)
    expect(metrics.throughputMegabytesPerSecond).toBeGreaterThan(0)
  })
})
