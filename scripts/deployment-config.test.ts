import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>
}
const vercelConfig = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
  buildCommand?: string
}

describe("Vercel deployment configuration", () => {
  it("downloads pinned tokenizer assets before the production build", () => {
    expect(vercelConfig.buildCommand).toBe("npm run build:vercel")
    expect(packageJson.scripts["build:vercel"]).toBe("npm run tokenizers:sync && npm run build")
  })
})
