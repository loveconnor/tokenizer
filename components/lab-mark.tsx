import type { LabId } from "@/lib/tokenizers/types"

const LAB_MONOGRAMS: Record<LabId, string> = {
  openai: "OA",
  anthropic: "AN",
  google: "GO",
  kimi: "KI",
  deepseek: "DS",
  xai: "XA",
  meta: "ME",
  mistral: "MI",
  qwen: "QW",
  atlas: "CL",
}

export function LabMark({ lab, compact = false }: { lab: LabId; compact?: boolean }) {
  const className = [
    "lab-mark",
    compact ? "is-compact" : "",
    lab === "atlas" ? "is-owner" : "",
  ].filter(Boolean).join(" ")

  return <span className={className} aria-hidden="true">{LAB_MONOGRAMS[lab]}</span>
}
