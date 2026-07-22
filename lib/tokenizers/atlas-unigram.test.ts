import { describe, expect, it } from "vitest"

import { ConnorsTokenizer, type ConnorsTokenizerArtifact } from "./atlas-unigram"

function base64(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes))
}

function artifact(): ConnorsTokenizerArtifact {
  const vocabulary = Array.from({ length: 256 }, (_, id) => ({ id, bytes: base64([id]), score: -10 }))
  vocabulary.push({ id: 256, bytes: base64(Array.from(new TextEncoder().encode("hello"))), score: -1 })
  return {
    schemaVersion: 1,
    tokenizerId: "test",
    modelType: "byte-unigram",
    normalization: "identity",
    vocabulary,
    controlTokens: { bos: { id: 257, surface: "<|atlas_bos|>" } },
    limits: { maxInputBytes: 100, maxPieceBytes: 8 },
  }
}

describe("ConnorsTokenizer", () => {
  it("chooses the highest-scoring path and round-trips multilingual text", () => {
    const tokenizer = new ConnorsTokenizer(artifact())
    expect(tokenizer.encode("hello")).toEqual([256])
    const specimen = "A界👩🏽‍🚀\n"
    expect(tokenizer.decode(tokenizer.encode(specimen))).toBe(specimen)
  })

  it("keeps controls outside ordinary text encoding", () => {
    const tokenizer = new ConnorsTokenizer(artifact())
    expect(tokenizer.encode("<|atlas_bos|>")).not.toContain(257)
    const ids = tokenizer.encodeSegments([{ type: "control", name: "bos" }, { type: "text", value: "hello" }])
    expect(ids).toEqual([257, 256])
    expect(tokenizer.decode(ids)).toBe("<|atlas_bos|>hello")
    expect(tokenizer.decode(ids, { skip_special_tokens: true })).toBe("hello")
  })

  it("rejects oversized input", () => {
    const tokenizer = new ConnorsTokenizer(artifact())
    expect(() => tokenizer.encode("x".repeat(101))).toThrow(/exceeds/)
  })
})
