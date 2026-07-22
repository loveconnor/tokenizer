import type { LabId, TokenizerFidelity } from "./types"

export interface TokenizerManifestEntry {
  lab: LabId
  labName: string
  shortName: string
  modelId: string
  tokenizerId: string
  mode: "local" | "hybrid"
  fidelity: TokenizerFidelity
  sourceUrl: string
  revision?: string
  assetDirectory?: string
  accent: string
}

export const TOKENIZER_MANIFEST: readonly TokenizerManifestEntry[] = [
  {
    lab: "atlas",
    labName: "Connor’s Tokenizer",
    shortName: "Connor’s Tokenizer",
    modelId: "Byte-lossless Unigram · research candidate",
    tokenizerId: "byte-lossless Unigram · 195,124 vocabulary",
    mode: "local",
    fidelity: "research_candidate",
    sourceUrl: "/tokenizers/atlas-unigram-v3/revision.json",
    revision: "production-corpus candidate",
    assetDirectory: "atlas-unigram-v3",
    accent: "#b45309",
  },
  {
    lab: "openai",
    labName: "OpenAI",
    shortName: "OpenAI",
    modelId: "o200k_base",
    tokenizerId: "tiktoken byte-level BPE · 200K vocabulary",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://platform.openai.com/tokenizer",
    revision: "js-tiktoken@1.0.21",
    accent: "#18181b",
  },
  {
    lab: "anthropic",
    labName: "Anthropic",
    shortName: "Anthropic",
    modelId: "Anthropic legacy tokenizer · local proxy",
    tokenizerId: "Anthropic 2023 BPE · pre-Claude 3",
    mode: "hybrid",
    fidelity: "official_tokenizer",
    sourceUrl: "https://github.com/anthropics/anthropic-tokenizer-typescript",
    revision: "@anthropic-ai/tokenizer@0.0.4",
    assetDirectory: "anthropic-legacy",
    accent: "#27272a",
  },
  {
    lab: "google",
    labName: "Google",
    shortName: "Google",
    modelId: "Gemma 4 12B · open model",
    tokenizerId: "Gemma BPE · 262,144 vocabulary · not Gemini",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://huggingface.co/google/gemma-4-12B",
    revision: "023679e",
    assetDirectory: "gemma-4",
    accent: "#3f3f46",
  },
  {
    lab: "kimi",
    labName: "Moonshot AI",
    shortName: "Kimi",
    modelId: "Kimi K2.6 · open fallback",
    tokenizerId: "TikToken BPE · 163,584 vocabulary · K3 pending",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://huggingface.co/moonshotai/Kimi-K2.6",
    revision: "81bcaaa",
    assetDirectory: "kimi-k2.6",
    accent: "#52525b",
  },
  {
    lab: "deepseek",
    labName: "DeepSeek",
    shortName: "DeepSeek",
    modelId: "DeepSeek-V3.2",
    tokenizerId: "LlamaTokenizerFast BPE · 128K vocabulary",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V3.2",
    revision: "c69397e",
    assetDirectory: "deepseek-v3.2",
    accent: "#18181b",
  },
  {
    lab: "xai",
    labName: "xAI",
    shortName: "Grok",
    modelId: "Grok-1 · open local proxy",
    tokenizerId: "SentencePiece · 131,072 vocabulary · not Grok 4.5",
    mode: "hybrid",
    fidelity: "official_tokenizer",
    sourceUrl: "https://github.com/xai-org/grok-1",
    revision: "Xenova conversion@40ee9ae",
    assetDirectory: "grok-1",
    accent: "#27272a",
  },
  {
    lab: "meta",
    labName: "Meta",
    shortName: "Meta",
    modelId: "Llama 3.1 tokenizer family",
    tokenizerId: "TikToken-based BPE · 128K vocabulary · converted asset",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://huggingface.co/Xenova/llama3-tokenizer",
    revision: "72bff9e",
    assetDirectory: "llama-3.1",
    accent: "#3f3f46",
  },
  {
    lab: "mistral",
    labName: "Mistral AI",
    shortName: "Mistral",
    modelId: "Mistral Small 4",
    tokenizerId: "Tekken BPE · 131,072 vocabulary",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://huggingface.co/mistralai/Mistral-Small-4-119B-2603",
    revision: "233ef01",
    assetDirectory: "mistral-small-4",
    accent: "#52525b",
  },
  {
    lab: "qwen",
    labName: "Alibaba Cloud",
    shortName: "Qwen",
    modelId: "Qwen3",
    tokenizerId: "byte-level BPE · 151,643 vocabulary",
    mode: "local",
    fidelity: "official_tokenizer",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-8B",
    revision: "b968826",
    assetDirectory: "qwen3",
    accent: "#18181b",
  },
]

export const manifestByLab = Object.fromEntries(
  TOKENIZER_MANIFEST.map((entry) => [entry.lab, entry]),
) as Record<LabId, TokenizerManifestEntry>
