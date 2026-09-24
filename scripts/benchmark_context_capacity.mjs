#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { SYSTEMS, loadTokenizer } from "./run_tokenizer_benchmark.mjs"

const ROOT = process.cwd()
const LOCK_PATH = path.join(ROOT, "benchmarks", "atlas-corpus-v3.lock.json")
const LOCAL_LOCK_PATH = path.join(ROOT, "data", "tokenizer-benchmark", "manifest.lock.json")
const REPORT_PATH = path.join(ROOT, "benchmarks", "context-capacity-v1.report.json")
const MARKDOWN_PATH = path.join(ROOT, "docs", "context-capacity-v1-benchmark.md")
const TRACK_IDS = ["wikipedia", "github-repositories", "books"]
const BUDGETS = [32_768, 131_072]
const JOINER = "\n\n"

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function sha256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex")
}

function loadScenarios(lock) {
  const scenarios = []
  for (const id of TRACK_IDS) {
    const track = lock.tracks.find((entry) => entry.id === id)
    if (!track) throw new Error(`Missing locked track: ${id}`)
    const filePath = path.join(ROOT, "data", "tokenizer-benchmark", track.path)
    const file = fs.readFileSync(filePath)
    if (sha256(file) !== track.jsonlSha256) throw new Error(`Track hash mismatch: ${id}`)
    const records = file.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    if (records.length !== track.records) throw new Error(`Track record count mismatch: ${id}`)
    const text = records.map((record) => record.text).join(JOINER)
    scenarios.push({ id, label: track.label, records: records.length, text, utf8Bytes: Buffer.byteLength(text, "utf8"), jsonlSha256: track.jsonlSha256 })
  }
  return scenarios
}

function codePointBoundaries(text) {
  const boundaries = [0]
  let offset = 0
  for (const point of text) {
    offset += point.length
    boundaries.push(offset)
  }
  return boundaries
}

export function retainedSuffix(tokenizer, text, boundaries, budget, totalTokens) {
  if (totalTokens <= budget) return { retainedBytes: Buffer.byteLength(text, "utf8"), retainedTokens: totalTokens }

  let low = 0
  let high = boundaries.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (tokenizer.count(text.slice(boundaries[middle])) <= budget) high = middle
    else low = middle + 1
  }

  // Verify the boundary: a whole Unicode code point must fit, and adding the
  // immediately preceding one must exceed the budget.
  let start = low
  while (start > 0 && tokenizer.count(text.slice(boundaries[start - 1])) <= budget) start -= 1
  while (tokenizer.count(text.slice(boundaries[start])) > budget) start += 1
  const retainedText = text.slice(boundaries[start])
  return { retainedBytes: Buffer.byteLength(retainedText, "utf8"), retainedTokens: tokenizer.count(retainedText) }
}

function renderMarkdown(report) {
  const lines = [
    "# Context capacity benchmark v1",
    "",
    `Generated ${report.generatedAt} from locked corpus \`${report.corpusSha256}\`.`,
    "",
    "This measures how much original trailing text fits after a fixed token budget trims older context. It does not test a language model's recall or reasoning.",
    "",
    "## Retained UTF-8 bytes",
    "",
    "| Source | Budget | Original bytes | " + report.systems.map((system) => system.label).join(" | ") + " |",
    "| --- | ---: | ---: | " + report.systems.map(() => "---:").join(" | ") + " |",
  ]
  for (const scenario of report.scenarios) {
    for (const budget of report.budgets) {
      const cells = report.systems.map((system) => {
        const result = system.scenarios[scenario.id][budget]
        return `${result.retainedBytes.toLocaleString()} (${(result.retainedBytes / scenario.utf8Bytes * 100).toFixed(1)}%)`
      })
      lines.push(`| ${scenario.label} | ${budget.toLocaleString()} | ${scenario.utf8Bytes.toLocaleString()} | ${cells.join(" | ")} |`)
    }
  }
  lines.push(
    "",
    "## Method and limits",
    "",
    "- Each source is the full locked track in its recorded order, with two newlines between records. Every tokenizer receives identical original text.",
    "- For each budget, the runner locates a fitting original Unicode-code-point-aligned suffix by binary search, then checks adjacent boundaries. This models an application retaining the newest text after trimming older input.",
    "- Budgets exclude chat templates, role markers, tool messages, output reservations, and model-specific context limits. They are hypothetical shared budgets, not claims about any product's actual window. Some applications reject overlong input rather than trimming it.",
    "- The Anthropic legacy proxy applies NFKC normalization before counting; Qwen applies NFC. Gemma and Grok are open or legacy proxies, not current proprietary Gemini or Grok tokenizers.",
    "- Token counts can change slightly at a changed text boundary. The search checks adjacent code points, but the binary search assumes that suffix token count generally falls as older code points are removed.",
    "- Retained text measures capacity only. Testing whether information can be found or used requires matched language models trained with these tokenizers.",
    "",
  )
  return lines.join("\n")
}

async function main() {
  const lock = readJson(LOCK_PATH)
  const localLock = readJson(LOCAL_LOCK_PATH)
  if (lock.corpusSha256 !== localLock.corpusSha256) throw new Error("Local benchmark corpus does not match checked-in lock")
  const scenarios = loadScenarios(lock)
  const systems = []
  for (const system of SYSTEMS) {
    console.log(`Measuring ${system.label}`)
    const { tokenizer, revision } = await loadTokenizer(system)
    const results = {}
    for (const scenario of scenarios) {
      const boundaries = codePointBoundaries(scenario.text)
      const totalTokens = tokenizer.count(scenario.text)
      const budgets = {}
      for (const budget of BUDGETS) {
        budgets[budget] = retainedSuffix(tokenizer, scenario.text, boundaries, budget, totalTokens)
      }
      results[scenario.id] = budgets
      console.log(`  ${scenario.id}: ${totalTokens.toLocaleString()} full-input tokens`)
    }
    systems.push({ lab: system.lab, label: system.label, model: system.model, fidelity: system.fidelity, revision, scenarios: results })
  }
  const report = {
    schemaVersion: 1,
    protocolId: "context-capacity-v1",
    generatedAt: new Date().toISOString(),
    corpusSha256: lock.corpusSha256,
    budgets: BUDGETS,
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      label: scenario.label,
      records: scenario.records,
      utf8Bytes: scenario.utf8Bytes,
      jsonlSha256: scenario.jsonlSha256,
    })),
    systems,
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(MARKDOWN_PATH, renderMarkdown(report))
  console.log(REPORT_PATH)
  console.log(MARKDOWN_PATH)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
