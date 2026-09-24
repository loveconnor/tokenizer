#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

import { AutoTokenizer, env } from "@huggingface/transformers"
import { Tiktoken } from "js-tiktoken/lite"
import o200kBase from "js-tiktoken/ranks/o200k_base"

const ROOT = process.cwd()
const CORPUS_DIRECTORY = path.join(ROOT, "data", "tokenizer-benchmark")
const LOCK_PATH = path.join(ROOT, "benchmarks", "atlas-corpus-v3.lock.json")
const SOURCES_PATH = path.join(ROOT, "benchmarks", "atlas-corpus-v3.sources.json")
const REPORT_PATH = path.join(ROOT, "benchmarks", "atlas-corpus-v3.report.json")
const MARKDOWN_PATH = path.join(ROOT, "docs", "atlas-corpus-v3-benchmark.md")
const JOINER = "\n\n"

export const SYSTEMS = [
  { lab: "atlas", label: "Connor's Tokenizer", model: "Byte-lossless Unigram v3", kind: "atlas", asset: "atlas-unigram-v3", fidelity: "research candidate" },
  { lab: "openai", label: "OpenAI", model: "o200k_base", kind: "openai", fidelity: "official tokenizer" },
  { lab: "anthropic", label: "Anthropic", model: "Anthropic 2023 legacy proxy", kind: "anthropic", asset: "anthropic-legacy", fidelity: "official legacy proxy" },
  { lab: "google", label: "Google", model: "Gemma 4 tokenizer (not Gemini)", kind: "huggingface", asset: "gemma-4", fidelity: "official open-model tokenizer" },
  { lab: "kimi", label: "Kimi", model: "Kimi K2.6 tokenizer", kind: "huggingface", asset: "kimi-k2.6", fidelity: "official tokenizer" },
  { lab: "deepseek", label: "DeepSeek", model: "DeepSeek-V3.2 tokenizer", kind: "huggingface", asset: "deepseek-v3.2", fidelity: "official tokenizer" },
  { lab: "xai", label: "Grok", model: "Grok-1 local proxy", kind: "huggingface", asset: "grok-1", fidelity: "official legacy proxy" },
  { lab: "meta", label: "Meta", model: "Llama 3.1 tokenizer family", kind: "huggingface", asset: "llama-3.1", fidelity: "official tokenizer" },
  { lab: "mistral", label: "Mistral", model: "Mistral Small 4 tokenizer", kind: "huggingface", asset: "mistral-small-4", fidelity: "official tokenizer" },
  { lab: "qwen", label: "Qwen", model: "Qwen3 tokenizer", kind: "huggingface", asset: "qwen3", fidelity: "official tokenizer" },
]

function sha256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex")
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function loadTracks(lock) {
  const tracks = new Map()
  for (const summary of lock.tracks) {
    const records = fs.readFileSync(path.join(CORPUS_DIRECTORY, summary.path), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const payload = records.map((record) => record.text).join(JOINER)
    tracks.set(summary.id, { ...summary, records, payload })
  }
  return tracks
}

class ConnorsTokenizer {
  constructor(artifact) {
    this.artifact = artifact
    this.maximumPieceBytes = artifact.limits.maxPieceBytes
    this.root = new Map()
    this.pieces = new Map()
    for (const piece of artifact.vocabulary) {
      const bytes = Uint8Array.from(Buffer.from(piece.bytes, "base64"))
      this.pieces.set(piece.id, bytes)
      let node = this.root
      for (const value of bytes) {
        if (!node.has(value)) node.set(value, new Map())
        node = node.get(value)
      }
      node.terminal = { id: piece.id, score: piece.score }
    }
  }

  encode(text) {
    return this.#solve(text, true)
  }

  count(text) {
    return this.#solve(text, false)
  }

  #solve(text, includeIds) {
    const payload = new TextEncoder().encode(text)
    const scores = new Float64Array(payload.length + 1)
    scores.fill(Number.NEGATIVE_INFINITY)
    scores[0] = 0
    const counts = new Uint32Array(payload.length + 1)
    counts.fill(0xffffffff)
    counts[0] = 0
    const previous = includeIds ? new Int32Array(payload.length + 1).fill(-1) : undefined
    const tokenIds = includeIds ? new Int32Array(payload.length + 1).fill(-1) : undefined
    for (let start = 0; start < payload.length; start += 1) {
      if (!Number.isFinite(scores[start])) continue
      let node = this.root
      const maximum = Math.min(payload.length, start + this.maximumPieceBytes)
      for (let end = start; end < maximum; end += 1) {
        node = node.get(payload[end])
        if (!node) break
        const terminal = node.terminal
        if (!terminal) continue
        const position = end + 1
        const candidateScore = scores[start] + terminal.score
        const candidateCount = counts[start] + 1
        const difference = candidateScore - scores[position]
        if (difference > 1e-12 || (Math.abs(difference) <= 1e-12 && candidateCount < counts[position])) {
          scores[position] = candidateScore
          counts[position] = candidateCount
          if (includeIds) {
            previous[position] = start
            tokenIds[position] = terminal.id
          }
        }
      }
    }
    if (!Number.isFinite(scores[payload.length])) throw new Error("Connor's Tokenizer cannot encode benchmark record")
    if (!includeIds) return counts[payload.length]
    const ids = []
    for (let cursor = payload.length; cursor > 0; cursor = previous[cursor]) ids.push(tokenIds[cursor])
    ids.reverse()
    return ids
  }

  decode(ids) {
    const bytes = []
    for (const id of ids) {
      const piece = this.pieces.get(id)
      if (!piece) throw new Error(`Unknown Connor's Tokenizer token ${id}`)
      bytes.push(...piece)
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes))
  }
}

export async function loadTokenizer(system) {
  if (system.kind === "atlas") {
    const artifactPath = path.join(ROOT, "public", "tokenizers", system.asset, "tokenizer.json")
    const artifactPayload = fs.readFileSync(artifactPath)
    const tokenizer = new ConnorsTokenizer(JSON.parse(artifactPayload))
    return { tokenizer, revision: sha256(artifactPayload), vocabularySize: tokenizer.artifact.vocabulary.length }
  }
  if (system.kind === "openai") {
    const encoding = new Tiktoken(o200kBase)
    return {
      tokenizer: {
        encode: (text) => encoding.encode(text),
        count: (text) => encoding.encode(text).length,
        decode: (ids) => encoding.decode(ids),
      },
      revision: "js-tiktoken o200k_base",
      vocabularySize: 200019,
    }
  }
  if (system.kind === "anthropic") {
    const configPath = path.join(ROOT, "public", "tokenizers", system.asset, "claude.json")
    const configPayload = fs.readFileSync(configPath)
    const config = JSON.parse(configPayload)
    const encoding = new Tiktoken(config)
    return {
      tokenizer: {
        encode: (text) => encoding.encode(text.normalize("NFKC")),
        count: (text) => encoding.encode(text.normalize("NFKC")).length,
        decode: (ids) => encoding.decode(ids),
      },
      revision: sha256(configPayload),
      vocabularySize: Object.keys(config.special_tokens ?? {}).length + config.bpe_ranks.split(" ").length,
    }
  }
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = path.join(ROOT, "public", "tokenizers") + path.sep
  const tokenizer = await AutoTokenizer.from_pretrained(system.asset, { local_files_only: true })
  return {
    tokenizer: {
      encode: (text) => Array.from(tokenizer.encode(text, { add_special_tokens: false }), Number),
      count: (text) => tokenizer.encode(text, { add_special_tokens: false }).length,
      decode: (ids) => tokenizer.decode(ids, { skip_special_tokens: false, clean_up_tokenization_spaces: false }),
    },
    revision: readJson(path.join(ROOT, "public", "tokenizers", system.asset, "revision.json")).revision,
    vocabularySize: tokenizer.model?.vocab?.length ?? tokenizer.model?.vocab_size ?? null,
  }
}

function codePointLength(text) {
  return Array.from(text).length
}

function words(text) {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u) : []
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0
}

function trackMetrics(tokenizer, track) {
  const tokens = tokenizer.count(track.payload)
  const bytes = Buffer.byteLength(track.payload, "utf8")
  const characters = codePointLength(track.payload)
  return {
    records: track.records.length,
    utf8Bytes: bytes,
    characters,
    tokens,
    bytesPerToken: ratio(bytes, tokens),
    charactersPerToken: ratio(characters, tokens),
    normalizedSequenceLength: ratio(tokens, characters),
  }
}

function isolatedWordMetrics(tokenizer, text, cache) {
  const units = words(text)
  let tokenTotal = 0
  let oneToken = 0
  for (const word of units) {
    let count = cache.get(word)
    if (count === undefined) {
      count = tokenizer.count(word)
      cache.set(word, count)
    }
    tokenTotal += count
    if (count === 1) oneToken += 1
  }
  return {
    words: units.length,
    isolatedTokens: tokenTotal,
    fertility: ratio(tokenTotal, units.length),
    singleTokenRetentionRate: ratio(oneToken, units.length),
  }
}

function wikipediaByLanguage(track) {
  const records = new Map()
  for (const record of track.records) {
    if (!records.has(record.subgroup)) records.set(record.subgroup, [])
    records.get(record.subgroup).push(record.text)
  }
  return records
}

function computeTokLens(tokenizer, wikipedia) {
  const byLanguage = wikipediaByLanguage(wikipedia)
  const languageResults = {}
  const cache = new Map()
  let englishTokens = 0
  for (const [language, texts] of byLanguage) {
    const text = texts.join(JOINER)
    const tokens = tokenizer.count(text)
    if (language === "en") englishTokens = tokens
    const characters = codePointLength(text)
    const wordMetrics = isolatedWordMetrics(tokenizer, text, cache)
    languageResults[language] = {
      articles: texts.length,
      characters,
      utf8Bytes: Buffer.byteLength(text, "utf8"),
      tokens,
      fertility: wordMetrics.fertility,
      charactersPerToken: ratio(characters, tokens),
      compressionRatio: ratio(Buffer.byteLength(text, "utf8"), tokens),
      singleTokenRetentionRate: wordMetrics.singleTokenRetentionRate,
      normalizedSequenceLength: ratio(tokens, characters),
      parity: 0,
    }
  }
  for (const result of Object.values(languageResults)) result.parity = ratio(result.tokens, englishTokens)
  const values = Object.values(languageResults)
  const macro = (key) => values.reduce((sum, value) => sum + value[key], 0) / values.length
  return {
    protocol: "TokLens-compatible metrics on its 15-language Wikipedia 20231101 corpus recipe",
    languages: languageResults,
    macro: {
      fertility: macro("fertility"),
      charactersPerToken: macro("charactersPerToken"),
      compressionRatio: macro("compressionRatio"),
      singleTokenRetentionRate: macro("singleTokenRetentionRate"),
      normalizedSequenceLength: macro("normalizedSequenceLength"),
      parity: macro("parity"),
      parityRange: [Math.min(...values.map((value) => value.parity)), Math.max(...values.map((value) => value.parity))],
    },
  }
}

function roundTripMetrics(tokenizer, track) {
  let exact = 0
  const failures = []
  for (const record of track.records) {
    const decoded = tokenizer.decode(tokenizer.encode(record.text))
    if (decoded === record.text) exact += 1
    else if (failures.length < 10) failures.push(record.id)
  }
  return { cases: track.records.length, exact, rate: ratio(exact, track.records.length), failureExamples: failures }
}

function segmentationDistribution(tokenizer, track) {
  const counts = track.records.map((record) => tokenizer.count(record.text)).sort((left, right) => left - right)
  const percentile = (p) => counts[Math.min(counts.length - 1, Math.floor((counts.length - 1) * p))]
  return { minimum: counts[0], median: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), maximum: counts.at(-1) }
}

function measureThroughput(tokenizer, payload) {
  const sample = Buffer.byteLength(payload, "utf8") > 512_000 ? Buffer.from(payload).subarray(0, 512_000).toString("utf8") : payload
  const bytes = Buffer.byteLength(sample, "utf8")
  tokenizer.count(sample)
  const results = []
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now()
    tokenizer.count(sample)
    const elapsed = performance.now() - started
    results.push(bytes / elapsed / 1_000)
  }
  results.sort((left, right) => left - right)
  return { megabytesPerSecond: results[1], sampleBytes: bytes, samples: 3 }
}

function uniqueCorpus(tracks) {
  const seen = new Set()
  const texts = []
  for (const track of tracks.values()) {
    for (const record of track.records) {
      if (seen.has(record.sha256)) continue
      seen.add(record.sha256)
      texts.push(record.text)
    }
  }
  return { records: texts.length, payload: texts.join(JOINER) }
}

function compactCorpus(lock, sources) {
  return {
    corpusSha256: lock.corpusSha256,
    sourceManifestSha256: lock.sourceManifestSha256,
    tracks: lock.tracks.map((track) => ({
      id: track.id,
      label: track.label,
      records: track.records,
      utf8Bytes: track.utf8Bytes,
      groups: track.groups,
      jsonlSha256: track.jsonlSha256,
      samples: track.samples,
    })),
    sources: {
      tokenizerBench: sources.tokenizerBench,
      tokLens: sources.tokLens,
      commonCrawl: sources.commonCrawl,
      stackOverflow: { ...sources.stackOverflow, questions: sources.stackOverflow.questions },
      books: sources.books,
      news: sources.news,
      scientificPapers: sources.scientificPapers,
      github: sources.github,
    },
  }
}

async function evaluateSystem(system, tracks, allUnique) {
  console.log(`Loading ${system.label} — ${system.model}`)
  const { tokenizer, revision, vocabularySize } = await loadTokenizer(system)
  const trackResults = {}
  for (const [id, track] of tracks) {
    const started = performance.now()
    trackResults[id] = trackMetrics(tokenizer, track)
    console.log(`  ${id}: ${trackResults[id].tokens.toLocaleString()} tokens (${(performance.now() - started).toFixed(0)} ms)`)
  }
  const totalTokens = tokenizer.count(allUnique.payload)
  const totalBytes = Buffer.byteLength(allUnique.payload, "utf8")
  const totalCharacters = codePointLength(allUnique.payload)
  const result = {
    lab: system.lab,
    label: system.label,
    model: system.model,
    fidelity: system.fidelity,
    revision,
    vocabularySize,
    overall: {
      uniqueRecords: allUnique.records,
      utf8Bytes: totalBytes,
      characters: totalCharacters,
      tokens: totalTokens,
      bytesPerToken: ratio(totalBytes, totalTokens),
      charactersPerToken: ratio(totalCharacters, totalTokens),
      normalizedSequenceLength: ratio(totalTokens, totalCharacters),
    },
    tracks: trackResults,
    toklens: computeTokLens(tokenizer, tracks.get("wikipedia")),
    robustness: {
      roundTrip: roundTripMetrics(tokenizer, tracks.get("tokenizerbench-edge")),
      sequenceLength: segmentationDistribution(tokenizer, tracks.get("tokenizerbench-edge")),
    },
    throughput: measureThroughput(tokenizer, allUnique.payload),
  }
  console.log(`  overall: ${totalTokens.toLocaleString()} tokens; TokLens and robustness complete`)
  return result
}

function renderMarkdown(report) {
  const lines = [
    "# Connor's Tokenizer corpus benchmark v3",
    "",
    `Generated ${report.generatedAt} from corpus \`${report.corpus.corpusSha256}\`.`,
    "",
    "This is a tokenizer-only, held-out corpus evaluation. It measures compression, segmentation, exact decoding, and encode throughput; it does not measure language-model loss or downstream task quality.",
    "",
    "## Overall unique-corpus results",
    "",
    "| Tokenizer | Tokens | UTF-8 bytes/token | Characters/token | Exact edge round trips | Encode MB/s |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ]
  for (const result of [...report.systems].sort((left, right) => left.overall.tokens - right.overall.tokens)) {
    lines.push(`| ${result.label} · ${result.model} | ${result.overall.tokens.toLocaleString()} | ${result.overall.bytesPerToken.toFixed(3)} | ${result.overall.charactersPerToken.toFixed(3)} | ${(result.robustness.roundTrip.rate * 100).toFixed(1)}% | ${result.throughput.megabytesPerSecond.toFixed(1)} |`)
  }
  lines.push("", "## TokLens-compatible 15-language macro", "", "| Tokenizer | Fertility ↓ | Chars/token ↑ | Bytes/token ↑ | STRR ↑ | NSL ↓ | Parity range |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const result of report.systems) {
    const metric = result.toklens.macro
    lines.push(`| ${result.label} | ${metric.fertility.toFixed(3)} | ${metric.charactersPerToken.toFixed(3)} | ${metric.compressionRatio.toFixed(3)} | ${(metric.singleTokenRetentionRate * 100).toFixed(1)}% | ${metric.normalizedSequenceLength.toFixed(3)} | ${metric.parityRange[0].toFixed(2)}–${metric.parityRange[1].toFixed(2)} |`)
  }
  lines.push("", "## Corpus tracks", "", "| Track | Records | UTF-8 bytes |", "| --- | ---: | ---: |")
  for (const track of report.corpus.tracks) lines.push(`| ${track.label} | ${track.records.toLocaleString()} | ${track.utf8Bytes.toLocaleString()} |`)
  lines.push(
    "",
    "## Interpretation limits",
    "",
    "- TokenizerBench 0.2.0 is used as a pinned fixture set. Its published package entry point is broken; the verified wheel's four full data modules are loaded directly.",
    "- TokLens metrics are reproduced on its Wikipedia 20231101 recipe. This report does not reproduce TokLens's downstream correlation study or claim causation.",
    "- TokenMonster's 16-model experiment is cited as external historical evidence only. Connor's Tokenizer has not been trained into matched language models, so no TokenMonster-style downstream result is reported for it.",
    "- Throughput is encode-only and machine-specific. Compare only values from this single run and use the environment recorded in the JSON report.",
    "- Google is represented by Gemma, not Gemini. Anthropic and xAI are legacy open-tokenizer proxies. These identities are not current proprietary production tokenizers.",
    "",
  )
  return lines.join("\n")
}

async function main() {
  const lock = readJson(LOCK_PATH)
  const sources = readJson(SOURCES_PATH)
  const localLock = readJson(path.join(CORPUS_DIRECTORY, "manifest.lock.json"))
  if (localLock.corpusSha256 !== lock.corpusSha256) throw new Error("Local benchmark corpus does not match checked-in lock")
  const tracks = loadTracks(lock)
  const allUnique = uniqueCorpus(tracks)
  const systems = []
  for (const system of SYSTEMS) systems.push(await evaluateSystem(system, tracks, allUnique))
  const report = {
    schemaVersion: 1,
    protocolId: sources.protocolId,
    generatedAt: new Date().toISOString(),
    corpus: compactCorpus(lock, sources),
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      throughputMethod: "Median of three warm encode-only runs over a 512,000-byte UTF-8 prefix; decimal MB/s.",
    },
    metrics: {
      compression: "UTF-8 bytes divided by raw tokens; higher is better.",
      fertility: "TokLens definition: mean isolated-token count per whitespace-delimited word; lower is better.",
      singleTokenRetentionRate: "TokLens definition: share of whitespace-delimited words encoded as one isolated token; higher is better.",
      normalizedSequenceLength: "TokLens definition: raw tokens divided by Unicode code points; lower is better.",
      parity: "TokLens definition: target-language token count divided by English token count; values near one indicate parity, but corpora are not translations.",
      roundTrip: "Exact string equality after decode(encode(text)) on all TokenizerBench edge cases.",
    },
    externalEvidence: {
      tokenizerBench: { status: "executed", version: sources.tokenizerBench.version, sourceUrl: sources.tokenizerBench.sourceUrl },
      tokLens: { status: "metrics reproduced; downstream correlation not rerun", sourceUrl: sources.tokLens.paperUrl },
      tokenMonster: {
        status: "external historical evidence only; not a result for Connor's Tokenizer",
        sourceUrl: "https://github.com/alasdairforsythe/tokenmonster/blob/main/benchmark/pretrain.md",
        note: "The author reports pretraining 16 models with different tokenizers. A comparable Connor's Tokenizer claim requires matched model pretraining and is out of scope for tokenizer-only measurement.",
      },
    },
    systems,
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(MARKDOWN_PATH, renderMarkdown(report))
  console.log(REPORT_PATH)
  console.log(MARKDOWN_PATH)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
