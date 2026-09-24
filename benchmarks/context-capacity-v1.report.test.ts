import { describe, expect, it } from "vitest"

import corpusLock from "./atlas-corpus-v3.lock.json"
import capacity from "./context-capacity-v1.report.json"

describe("context capacity report", () => {
  it("uses the locked sources and measures all ten systems within each budget", () => {
    expect(capacity.corpusSha256).toBe(corpusLock.corpusSha256)
    expect(capacity.budgets).toEqual([32_768, 131_072])
    expect(capacity.systems).toHaveLength(10)
    for (const scenario of capacity.scenarios) {
      const locked = corpusLock.tracks.find((track) => track.id === scenario.id)
      expect(scenario.jsonlSha256).toBe(locked?.jsonlSha256)
      for (const system of capacity.systems) {
        for (const budget of capacity.budgets) {
          const result = system.scenarios[scenario.id as keyof typeof system.scenarios][String(budget) as "32768" | "131072"]
          expect(result.retainedBytes).toBeGreaterThan(0)
          expect(result.retainedBytes).toBeLessThanOrEqual(scenario.utf8Bytes)
          expect(result.retainedTokens).toBeLessThanOrEqual(budget)
        }
      }
    }
  })
})
