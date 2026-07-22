import { countBytes, countWords } from "./calculations"
import type { TokenizerBenchmarkMetrics } from "./types"

export const INTRINSIC_BENCHMARK_VERSION = "intrinsic-v2"

export const PROSE_BENCHMARK_CASES = [
  "A tokenizer turns language into countable pieces—but the seams appear in different places for every model family.",
  "Reliable evaluation separates the measurement from the claim. A smaller prompt footprint can reduce context use, but it cannot establish language-model quality on its own.",
  "The field notes were revised after the first review. Terms became more precise, assumptions moved closer to the evidence, and the conclusion became appropriately narrower.",
  "“Can we reproduce the result?” the reviewer asked. “Yes,” Mira replied, “as long as we preserve the tokenizer revision, the exact input, and the measurement protocol.”",
] as const

export const MULTILINGUAL_BENCHMARK_CASES = [
  "Tokenization across languages: 你好世界 · مرحباً بالعالم · नमस्ते दुनिया · こんにちは世界",
  "Bonjour le monde · Γειά σου κόσμε · Привіт, світе · Merhaba dünya",
  "বাংলা ভাষা · தமிழ் மொழி · 한국어 문장 · ภาษาไทย",
] as const

export const CODE_BENCHMARK_CASES = [
  `const specimen = {\n  lab: "Connor's Tokenizer",\n  ready: true,\n  values: [13, 21, 34]\n};`,
  "def normalize_records(rows):\n    return [row.strip().lower() for row in rows if row]\n",
  "SELECT account_id, COUNT(*) AS events FROM audit_log WHERE created_at >= $1 GROUP BY account_id;",
] as const

export const EMOJI_URL_BENCHMARK_CASES = [
  "Family 👩🏽‍🚀 + flags 🇺🇳 → https://example.com/search?q=connors-tokenizer&lang=en#specimen",
  "Release ✅ · warning ⚠️ · blocked ⛔ · retry 🔁 · sparkles ✨ · hearts ❤️‍🔥 💙",
  "https://docs.example.org/tokenizers/compare?model=connors-tokenizer&format=json#throughput",
  "Contact research@example.org or open https://例え.テスト/路径?q=مرحبا%20بالعالم",
] as const

export const BENCHMARK_DOMAINS = [
  { id: "prose", label: "Prose", cases: PROSE_BENCHMARK_CASES },
  { id: "multilingual", label: "Multilingual", cases: MULTILINGUAL_BENCHMARK_CASES },
  { id: "code", label: "Code", cases: CODE_BENCHMARK_CASES },
  { id: "emoji-url", label: "Emoji / URLs", cases: EMOJI_URL_BENCHMARK_CASES },
] as const

export const BENCHMARK_SUITE_CASES = BENCHMARK_DOMAINS.flatMap((domain) => [...domain.cases])
export const BENCHMARK_SUITE_TEXT = BENCHMARK_SUITE_CASES.join("\n\n")

const THROUGHPUT_UNIT = [
  ...BENCHMARK_SUITE_CASES,
].join("\n")

const THROUGHPUT_MINIMUM_BYTES = 64 * 1024
const THROUGHPUT_SAMPLE_COUNT = 3
const THROUGHPUT_MINIMUM_SAMPLE_MS = 30
const THROUGHPUT_MAX_RUNS_PER_SAMPLE = 16

export type EncodeText = (text: string) => number[]

export function measureTokenizerBenchmarks(
  text: string,
  tokenCount: number,
  encode: EncodeText,
  now: () => number = () => performance.now(),
): TokenizerBenchmarkMetrics {
  const wordUnits = whitespaceUnits(text)
  const uniqueUnitCounts = new Map<string, number>()
  for (const unit of wordUnits) uniqueUnitCounts.set(unit, (uniqueUnitCounts.get(unit) ?? 0) + 1)
  let singleTokenUnits = 0
  for (const [unit, occurrences] of uniqueUnitCounts) {
    if (encode(unit).length === 1) singleTokenUnits += occurrences
  }

  return {
    version: INTRINSIC_BENCHMARK_VERSION,
    currentBytesPerToken: ratio(countBytes(text), tokenCount),
    currentTokensPerWord: ratio(tokenCount, countWords(text)),
    singleTokenWordCoverage: ratio(singleTokenUnits, wordUnits.length),
    proseBytesPerToken: compressionRatio(PROSE_BENCHMARK_CASES, encode),
    multilingualBytesPerToken: compressionRatio(MULTILINGUAL_BENCHMARK_CASES, encode),
    codeBytesPerToken: compressionRatio(CODE_BENCHMARK_CASES, encode),
    emojiUrlBytesPerToken: compressionRatio(EMOJI_URL_BENCHMARK_CASES, encode),
    throughputMegabytesPerSecond: measureWarmThroughput(encode, now),
  }
}

export function compressionRatio(cases: readonly string[], encode: EncodeText) {
  let bytes = 0
  let tokens = 0
  for (const specimen of cases) {
    bytes += countBytes(specimen)
    tokens += encode(specimen).length
  }
  return ratio(bytes, tokens)
}

function measureWarmThroughput(encode: EncodeText, now: () => number) {
  const payload = repeatToMinimumBytes(THROUGHPUT_UNIT, THROUGHPUT_MINIMUM_BYTES)
  const payloadBytes = countBytes(payload)
  encode(payload)
  const samples = []
  for (let sample = 0; sample < THROUGHPUT_SAMPLE_COUNT; sample += 1) {
    const startedAt = now()
    let runs = 0
    let elapsedMs = 0
    do {
      encode(payload)
      runs += 1
      elapsedMs = now() - startedAt
    } while (
      elapsedMs < THROUGHPUT_MINIMUM_SAMPLE_MS
      && runs < THROUGHPUT_MAX_RUNS_PER_SAMPLE
    )
    if (elapsedMs > 0) samples.push((payloadBytes * runs) / elapsedMs / 1_000)
  }
  if (!samples.length) return 0
  samples.sort((left, right) => left - right)
  return samples[Math.floor(samples.length / 2)]
}

function repeatToMinimumBytes(unit: string, minimumBytes: number) {
  const unitBytes = countBytes(unit) + 1
  const copies = Math.max(1, Math.ceil(minimumBytes / unitBytes))
  return Array.from({ length: copies }, () => unit).join("\n")
}

function whitespaceUnits(text: string) {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u) : []
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}
