import { describe, expect, it } from "vitest"

import lock from "./atlas-corpus-v3.lock.json"
import report from "./atlas-corpus-v3.report.json"

const REQUIRED_TRACKS = [
  "wikipedia",
  "common-crawl",
  "github-repositories",
  "stack-overflow",
  "books",
  "news",
  "scientific-papers",
  "html",
  "json",
  "markdown",
  "python",
  "typescript",
  "rust",
  "cpp",
  "java",
  "tokenizerbench-languages",
  "tokenizerbench-code",
  "tokenizerbench-math",
  "tokenizerbench-edge",
] as const

describe("Connor's Tokenizer corpus v3 report", () => {
  it("matches the locked corpus and required source tracks", () => {
    expect(report.corpus.corpusSha256).toBe(lock.corpusSha256)
    expect(report.corpus.tracks.map((track) => track.id)).toEqual(REQUIRED_TRACKS)
    expect(report.corpus.tracks.reduce((sum, track) => sum + track.records, 0)).toBe(2_116)
    expect(Object.keys(report.corpus.tracks.find((track) => track.id === "tokenizerbench-languages")!.groups)).toHaveLength(84)
    expect(Object.keys(report.corpus.tracks.find((track) => track.id === "tokenizerbench-code")!.groups)).toHaveLength(17)
  })

  it("contains complete measurements for all ten systems", () => {
    expect(report.systems).toHaveLength(10)
    for (const system of report.systems) {
      expect(system.overall.tokens).toBeGreaterThan(0)
      expect(Object.keys(system.tracks)).toEqual(REQUIRED_TRACKS)
      expect(Object.keys(system.toklens.languages)).toHaveLength(15)
      expect(system.robustness.roundTrip.cases).toBe(292)
    }
  })
})
