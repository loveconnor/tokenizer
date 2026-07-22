import Image from "next/image"

import type { LabId } from "@/lib/tokenizers/types"

const LAB_LOGO_PATHS: Partial<Record<LabId, string>> = {
  openai: "/lab-marks/openai.svg",
  anthropic: "/lab-marks/anthropic.svg",
  google: "/lab-marks/google.svg",
  kimi: "/lab-marks/kimi.svg",
  deepseek: "/lab-marks/deepseek.svg",
  xai: "/lab-marks/xai.svg",
  meta: "/lab-marks/meta.svg",
  mistral: "/lab-marks/mistral.svg",
  qwen: "/lab-marks/qwen.svg",
}

export function LabMark({ lab, compact = false }: { lab: LabId; compact?: boolean }) {
  const className = [
    "lab-mark",
    compact ? "is-compact" : "",
    lab === "atlas" ? "is-owner" : "",
  ].filter(Boolean).join(" ")
  const logoPath = LAB_LOGO_PATHS[lab]

  return <span className={className} data-lab={lab} aria-hidden="true">
    {logoPath
      ? <Image src={logoPath} alt="" width={24} height={24} unoptimized />
      : "CL"}
  </span>
}
