import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TokenizerWorkbench } from "./tokenizer-workbench"

const workerInstances: WorkerStub[] = []

class WorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    workerInstances.push(this)
  }
}

describe("TokenizerWorkbench", () => {
  beforeEach(() => {
    workerInstances.length = 0
    localStorage.clear()
    vi.stubGlobal("Worker", WorkerStub)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("loads examples without persisting the specimen", () => {
    render(<TokenizerWorkbench />)
    expect(screen.getByRole("heading", { level: 1, name: "Connor’s Tokenizer" })).toBeVisible()
    expect(screen.getByRole("heading", { level: 3, name: "Connor’s Tokenizer" })).toBeVisible()
    expect(document.body).not.toHaveTextContent(/Atlas/i)
    const openAiHeading = screen.getByRole("heading", { name: "OpenAI" })
    const openAiMark = openAiHeading.closest(".lab-title")?.querySelector(".lab-mark")
    expect(openAiMark?.querySelector('img[src="/lab-marks/openai.svg"]')).toBeTruthy()
    expect(document.querySelectorAll(".lab-mark img")).toHaveLength(9)
    expect(document.querySelector('[data-lab="atlas"]')).toHaveTextContent("CL")
    expect(screen.getByRole("link", { name: "Source code" })).toHaveAttribute(
      "href",
      "https://github.com/loveconnor/tokenizer",
    )
    fireEvent.click(screen.getByRole("button", { name: "Multilingual" }))
    expect((screen.getByLabelText("Text to compare") as HTMLTextAreaElement).value).toContain("你好世界")
    expect(localStorage.getItem("connors-tokenizer:text")).toBeNull()
  })

  it("dispatches the initial specimen once to each worker", () => {
    render(<TokenizerWorkbench />)
    expect(workerInstances).toHaveLength(2)
    expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1)
    expect(workerInstances[1].postMessage).toHaveBeenCalledTimes(1)
  })

  it("keeps every comparison local", () => {
    render(<TokenizerWorkbench />)
    expect(screen.queryByText("Hosted providers")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /hosted providers/i })).not.toBeInTheDocument()
    expect(localStorage.getItem("connors-tokenizer:hosted-consent")).toBeNull()
  })

  it("switches to the fixed benchmark suite without changing the specimen", () => {
    render(<TokenizerWorkbench />)
    const specimen = (screen.getByLabelText("Text to compare") as HTMLTextAreaElement).value
    const compareTab = screen.getByRole("tab", { name: "Compare text" })
    const benchmarkTab = screen.getByRole("tab", { name: "Benchmark suite" })
    expect(compareTab).toHaveAttribute("aria-selected", "true")

    fireEvent.keyDown(compareTab, { key: "ArrowRight" })
    expect(benchmarkTab).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByLabelText("Text to compare")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Benchmark corpus" })).toBeVisible()
    expect(document.body).not.toHaveTextContent(/Atlas/i)
    expect(screen.getByText("Source inventory")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Wikipedia" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Pride and Prejudice" })).toBeVisible()
    expect(screen.getByText("TokenizerBench 0.2.0 inventory")).toBeVisible()
    expect(screen.getByRole("heading", { name: "UTF-8 bytes per token" })).toBeVisible()
    const trackTable = screen.getByRole("table", { name: /UTF-8 bytes per token for every benchmark track/ })
    expect(trackTable).toBeVisible()
    for (const row of within(trackTable).getAllByRole("row").slice(1)) {
      const bestCell = row.querySelector("td[data-best='true']")
      expect(bestCell).toBeTruthy()
      expect(bestCell?.querySelector(".benchmark-best[data-best='true']")).toBeTruthy()
    }
    const contextTable = screen.getByRole("table", { name: /Original UTF-8 bytes retained by each tokenizer/ })
    expect(within(contextTable).getAllByRole("row")).toHaveLength(7)
    const wikipedia32k = within(contextTable).getByRole("row", { name: /Wikipedia 32,768/ })
    expect(wikipedia32k).toHaveTextContent("154,350")
    expect(wikipedia32k.querySelectorAll("td[data-best='true']")).toHaveLength(1)
    const books128k = within(contextTable).getByRole("row", { name: /Books 131,072/ })
    expect(books128k.querySelectorAll("td[data-best='true']")).toHaveLength(0)
    expect(screen.getByText(/This does not measure model recall/)).toBeVisible()
    expect(screen.getByRole("columnheader", { name: /fertility.*lower is better/i })).toBeVisible()
    const toklensTable = screen.getByRole("table", { name: /TokLens-compatible intrinsic metrics/ })
    const googleRow = within(toklensTable).getByRole("row", { name: /Google/ })
    const connorRow = within(toklensTable).getByRole("row", { name: /Connor’s Tokenizer/ })
    expect(googleRow.querySelectorAll("td")[0]).toHaveAttribute("data-best", "true")
    expect(googleRow.querySelectorAll("td")[0].querySelector(".benchmark-best")).toBeTruthy()
    expect(connorRow.querySelectorAll("td")[0].querySelector(".benchmark-best")).toBeNull()
    expect(connorRow.querySelectorAll("td")[1].querySelector(".benchmark-best")).toBeTruthy()
    expect(screen.queryByText(/bits per byte/i)).not.toBeInTheDocument()
    expect(screen.getByText(/do not measure language-model loss/i)).toBeVisible()
    expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1)
    expect(workerInstances[1].postMessage).toHaveBeenCalledTimes(1)
    expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: specimen }))
    expect(workerInstances[1].postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: specimen }))

    fireEvent.click(compareTab)
    expect((screen.getByLabelText("Text to compare") as HTMLTextAreaElement).value).toBe(specimen)
  })
})
