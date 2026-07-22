import type { TokenizerPiece, TokenizerResult } from "./types"

export function countWords(text: string) {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

export function countBytes(text: string) {
  return new TextEncoder().encode(text).length
}

export function charactersPerToken(text: string, tokenCount: number) {
  return tokenCount > 0 ? text.length / tokenCount : 0
}

export function safeTokenDisplay(raw: string, bytes?: number[]) {
  if (raw === "") return bytes?.length ? `bytes ${bytes.map(toHex).join(" ")}` : "∅"
  return raw
    .replaceAll(" ", "·")
    .replaceAll("\t", "⇥")
    .replaceAll("\r", "↵")
    .replaceAll("\n", "↵\n")
}

export function createPiece(tokenId: number, rawValue: string, bytes?: number[]): TokenizerPiece {
  return {
    tokenId,
    rawValue,
    displayValue: safeTokenDisplay(rawValue, bytes),
    ...(bytes?.length ? { bytes } : {}),
  }
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0").toUpperCase()
}

export function rankedResults(results: TokenizerResult[]) {
  return results
    .filter((result): result is TokenizerResult & { tokenCount: number } =>
      result.status === "ok" && typeof result.tokenCount === "number",
    )
    .sort((a, b) => a.tokenCount - b.tokenCount || a.lab.localeCompare(b.lab))
}

export function relativeDifference(tokenCount: number, smallest: number) {
  if (smallest <= 0 || tokenCount === smallest) return 0
  return ((tokenCount - smallest) / smallest) * 100
}
