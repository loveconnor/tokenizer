/// <reference lib="webworker" />

import { charactersPerToken, createPiece } from "@/lib/tokenizers/calculations"
import { measureTokenizerBenchmarks, type EncodeText } from "@/lib/tokenizers/benchmarks"
import { manifestByLab } from "@/lib/tokenizers/manifest"
import { AtlasUnigramTokenizer } from "@/lib/tokenizers/atlas-unigram"
import type { LabId, TokenizerResult } from "@/lib/tokenizers/types"

type WorkerRequest = { id: number; text: string }
interface TokenizerLike {
  encode(text: string, options?: { add_special_tokens?: boolean }): number[]
  decode(ids: number[], options?: { skip_special_tokens?: boolean }): string
}

const tokenizerCache = new Map<LabId, Promise<TokenizerLike>>()
let anthropicEncodingPromise: Promise<TokenizerLike> | undefined

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, text } = event.data
  const labs: LabId[] = ["atlas", "anthropic", "google", "kimi", "deepseek", "xai", "meta", "mistral", "qwen"]
  const settled = await Promise.allSettled(labs.map((lab) => tokenize(lab, text)))
  const results = settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value
    const manifest = manifestByLab[labs[index]]
    return {
      lab: manifest.lab,
      modelId: manifest.modelId,
      status: "error",
      fidelity: manifest.fidelity,
      sourceUrl: manifest.sourceUrl,
      note: manifest.lab === "atlas"
        ? "The generated Connor’s Tokenizer artifact is unavailable. Run npm run tokenizer:corpus and npm run tokenizer:train before deployment."
        : `Pinned tokenizer assets for ${manifest.shortName} are unavailable. Run npm run tokenizers:sync before deployment.`,
    } satisfies TokenizerResult
  })

  self.postMessage({ id, results, done: true })
}

async function tokenize(lab: LabId, text: string): Promise<TokenizerResult> {
  const manifest = manifestByLab[lab]
  if (!manifest.assetDirectory) throw new Error("No local asset directory")

  if (lab === "atlas") return tokenizeAtlas(text)

  let tokenizerPromise = lab === "anthropic" ? anthropicEncodingPromise : tokenizerCache.get(lab)
  if (!tokenizerPromise) {
    tokenizerPromise = lab === "anthropic"
      ? loadAnthropicLegacyTokenizer(manifest.assetDirectory)
      : loadHuggingFaceTokenizer(manifest.assetDirectory)
    if (lab === "anthropic") anthropicEncodingPromise = tokenizerPromise
    else tokenizerCache.set(lab, tokenizerPromise)
  }

  const tokenizer = await tokenizerPromise
  const encode: EncodeText = lab === "anthropic"
    ? (value) => Array.from(tokenizer.encode(value.normalize("NFKC")), Number)
    : (value) => Array.from(tokenizer.encode(value, { add_special_tokens: false }), Number)
  const rawIds = encode(text)
  const pieces = rawIds.slice(0, 200).map((tokenId) => {
    const rawValue = tokenizer.decode([tokenId], { skip_special_tokens: false })
    const bytes = Array.from(new TextEncoder().encode(rawValue))
    return createPiece(tokenId, rawValue, bytes)
  })

  return {
    lab,
    modelId: manifest.modelId,
    tokenizerId: manifest.tokenizerId,
    status: "ok",
    tokenCount: rawIds.length,
    charactersPerToken: charactersPerToken(text, rawIds.length),
    benchmarks: measureTokenizerBenchmarks(text, rawIds.length, encode),
    fidelity: "official_tokenizer",
    sourceUrl: manifest.sourceUrl,
    pieces,
    note: rawTextNote(lab),
  }
}

async function tokenizeAtlas(text: string): Promise<TokenizerResult> {
  const manifest = manifestByLab.atlas
  let tokenizerPromise = tokenizerCache.get("atlas")
  if (!tokenizerPromise) {
    tokenizerPromise = AtlasUnigramTokenizer.load()
    tokenizerCache.set("atlas", tokenizerPromise)
  }
  const tokenizer = await tokenizerPromise as AtlasUnigramTokenizer
  const encoded = tokenizer.encodeDetailed(text)
  const encode = (value: string) => tokenizer.encode(value)
  const pieces = encoded.slice(0, 200).map(({ id, bytes }) => {
    const rawValue = new TextDecoder().decode(bytes)
    return createPiece(id, rawValue, Array.from(bytes))
  })
  return {
    lab: "atlas",
    modelId: manifest.modelId,
    tokenizerId: manifest.tokenizerId,
    status: "ok",
    tokenCount: encoded.length,
    charactersPerToken: charactersPerToken(text, encoded.length),
    benchmarks: measureTokenizerBenchmarks(text, encoded.length, encode),
    fidelity: "research_candidate",
    sourceUrl: manifest.sourceUrl,
    pieces,
    note: "Experimental byte-lossless Unigram candidate with conservative prose forms derived from the locked production corpus. Standardized emoji and privacy-minimized URL pieces remain protected. This is evaluation evidence, not a provider tokenizer or a universal winner.",
  }
}

async function loadHuggingFaceTokenizer(assetDirectory: string) {
  const { env, AutoTokenizer } = await import("@huggingface/transformers")
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = "/tokenizers/"
  return AutoTokenizer.from_pretrained(assetDirectory, { local_files_only: true }) as Promise<TokenizerLike>
}

async function loadAnthropicLegacyTokenizer(assetDirectory: string) {
  const [{ Tiktoken }, response] = await Promise.all([
    import("js-tiktoken/lite"),
    fetch(`/tokenizers/${assetDirectory}/claude.json`),
  ])
  if (!response.ok) throw new Error("Anthropic legacy tokenizer asset unavailable")
  const ranks = await response.json() as {
    bpe_ranks: string
    special_tokens: Record<string, number>
    pat_str: string
  }
  return new Tiktoken(ranks) as TokenizerLike
}

function rawTextNote(lab: LabId) {
  if (lab === "anthropic") return "Exact output from Anthropic's 2023 open tokenizer after its required NFKC normalization. Anthropic says it is only a rough proxy for Claude 3 and newer."
  if (lab === "google") return "Exact Gemma 4 raw-text count. Gemini uses a private tokenizer and is not represented by this result."
  if (lab === "kimi") return "Exact Kimi K2.6 raw-text count. Kimi K3 assets are scheduled for release after this app's pinned research date."
  if (lab === "xai") return "Exact Grok-1 raw-text count from xAI's open tokenizer. Current Grok models may tokenize differently."
  return "Exact raw-text count from the pinned tokenizer artifact. Chat-template framing is not added."
}

export {}
