export const TOKENIZER_STATUSES = [
  "ok",
  "error",
] as const

export const TOKENIZER_FIDELITIES = [
  "official_tokenizer",
  "research_candidate",
] as const

export type TokenizerStatus = (typeof TOKENIZER_STATUSES)[number]
export type TokenizerFidelity = (typeof TOKENIZER_FIDELITIES)[number]

export type LabId =
  | "openai"
  | "anthropic"
  | "google"
  | "kimi"
  | "deepseek"
  | "xai"
  | "meta"
  | "mistral"
  | "qwen"
  | "atlas"

export interface TokenizerPiece {
  tokenId: number
  rawValue: string
  displayValue: string
  bytes?: number[]
}

export interface TokenizerBenchmarkMetrics {
  version: "intrinsic-v2"
  currentBytesPerToken: number
  currentTokensPerWord: number
  singleTokenWordCoverage: number
  proseBytesPerToken: number
  multilingualBytesPerToken: number
  codeBytesPerToken: number
  emojiUrlBytesPerToken: number
  throughputMegabytesPerSecond: number
}

export interface TokenizerResult {
  lab: LabId
  modelId: string
  tokenizerId?: string
  status: TokenizerStatus
  tokenCount?: number
  charactersPerToken?: number
  benchmarks?: TokenizerBenchmarkMetrics
  fidelity: TokenizerFidelity
  sourceUrl: string
  pieces?: TokenizerPiece[]
  note?: string
  latencyMs?: number
}
