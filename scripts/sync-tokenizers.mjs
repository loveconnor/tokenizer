import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const assets = [
  {
    directory: "anthropic-legacy",
    source: "@anthropic-ai/tokenizer",
    revision: "0.0.4",
    license: "MIT",
    baseUrl: "https://unpkg.com/@anthropic-ai/tokenizer@0.0.4",
    files: ["claude.json"],
  },
  {
    directory: "grok-1",
    repo: "Xenova/grok-1-tokenizer",
    revision: "40ee9ae4aed428f623d105e0d85afbbb7985c4b6",
    license: "Apache-2.0",
    files: ["tokenizer.json", "tokenizer_config.json"],
  },
  {
    directory: "gemma-4",
    repo: "google/gemma-4-12B",
    revision: "023679ed352de9bb66cc873c9009ce3482585c08",
    license: "Apache-2.0",
    files: ["tokenizer.json", "tokenizer_config.json"],
  },
  {
    directory: "kimi-k2.6",
    repo: "moonshotai/Kimi-K2.6",
    revision: "81bcaaa7947338ce2641983d98947bca0cc1a4d4",
    license: "Modified MIT; see upstream license and third-party notices",
    files: ["tokenizer.json", "tokenizer_config.json"],
  },
  {
    directory: "deepseek-v3.2",
    repo: "deepseek-ai/DeepSeek-V3.2",
    revision: "c69397e",
    license: "MIT",
    files: ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"],
  },
  {
    directory: "llama-3.1",
    repo: "Xenova/llama3-tokenizer",
    revision: "72bff9ee09897a16b3b4b2b9995fecb0bfa7dbe6",
    license: "No license declared by conversion repository; upstream Meta Llama 3.1 Community License applies",
    files: ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"],
  },
  {
    directory: "mistral-small-4",
    repo: "mistralai/Mistral-Small-4-119B-2603",
    revision: "233ef01d21386af67064b8f3a56d3f477ca52ce8",
    license: "Apache-2.0",
    files: ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"],
  },
  {
    directory: "qwen3",
    repo: "Qwen/Qwen3-8B",
    revision: "b968826d9c46dd6066d109eabc6255188de91218",
    license: "Apache-2.0",
    files: ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"],
  },
]

const root = path.join(process.cwd(), "public", "tokenizers")

for (const asset of assets) {
  const destination = path.join(root, asset.directory)
  await mkdir(destination, { recursive: true })
  const downloaded = []

  for (const file of asset.files) {
    const url = asset.baseUrl
      ? `${asset.baseUrl}/${file}`
      : `https://huggingface.co/${asset.repo}/resolve/${asset.revision}/${file}`
    const response = await fetch(url, { redirect: "follow" })
    if (response.status === 404 && file === "special_tokens_map.json") continue
    if (!response.ok) throw new Error(`Could not download ${asset.repo ?? asset.source}/${file}: ${response.status}`)
    await writeFile(path.join(destination, file), Buffer.from(await response.arrayBuffer()))
    downloaded.push(file)
  }

  await writeFile(
    path.join(destination, "revision.json"),
    `${JSON.stringify({ source: asset.repo ?? asset.source, revision: asset.revision, license: asset.license, files: downloaded }, null, 2)}\n`,
  )
}
