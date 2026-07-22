/// <reference lib="webworker" />

import { Tiktoken } from "js-tiktoken/lite"
import o200kBase from "js-tiktoken/ranks/o200k_base"

import { charactersPerToken, createPiece } from "@/lib/tokenizers/calculations"
import { measureTokenizerBenchmarks } from "@/lib/tokenizers/benchmarks"
import { manifestByLab } from "@/lib/tokenizers/manifest"
import type { TokenizerResult } from "@/lib/tokenizers/types"

type WorkerRequest = { id: number; text: string }
let encoding: Tiktoken | undefined

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, text } = event.data
  try {
    encoding ??= new Tiktoken(o200kBase)
    const rawIds = encoding.encode(text)
    const encode = (value: string) => encoding!.encode(value)
    const pieces = rawIds.slice(0, 200).map((tokenId) => {
      const rawValue = encoding!.decode([tokenId])
      return createPiece(tokenId, rawValue, Array.from(new TextEncoder().encode(rawValue)))
    })
    const tokenCount = rawIds.length
    const result: TokenizerResult = {
      lab: "openai",
      modelId: manifestByLab.openai.modelId,
      tokenizerId: manifestByLab.openai.tokenizerId,
      status: "ok",
      tokenCount,
      charactersPerToken: charactersPerToken(text, tokenCount),
      benchmarks: measureTokenizerBenchmarks(text, tokenCount, encode),
      fidelity: "official_tokenizer",
      sourceUrl: manifestByLab.openai.sourceUrl,
      pieces,
      note: "Exact raw-text count from o200k_base, matching OpenAI's tokenizer tool. API request framing is not added.",
    }
    self.postMessage({ id, results: [result], done: false })
  } catch {
    const manifest = manifestByLab.openai
    self.postMessage({
      id,
      done: false,
      results: [{
        lab: "openai",
        modelId: manifest.modelId,
        status: "error",
        fidelity: manifest.fidelity,
        sourceUrl: manifest.sourceUrl,
        note: "The o200k_base tokenizer could not initialize in this browser.",
      } satisfies TokenizerResult],
    })
  }
}

export {}
