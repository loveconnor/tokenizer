"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { LabMark } from "@/components/lab-mark"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import BENCHMARK_REPORT from "@/benchmarks/atlas-corpus-v3.report.json"
import { countBytes, countWords, rankedResults, relativeDifference } from "@/lib/tokenizers/calculations"
import { manifestByLab, TOKENIZER_MANIFEST, type TokenizerManifestEntry } from "@/lib/tokenizers/manifest"
import type { LabId, TokenizerResult } from "@/lib/tokenizers/types"

const MAX_LENGTH = 20_000
const LOCAL_LAB_IDS = TOKENIZER_MANIFEST.map((entry) => entry.lab)

const EXAMPLES = [
  { label: "Prose", text: "A tokenizer splits text into tokens. Token boundaries and counts vary by tokenizer." },
  { label: "Code / JSON", text: `const specimen = {\n  lab: "Connor's Tokenizer",\n  ready: true,\n  values: [13, 21, 34]\n};` },
  { label: "Multilingual", text: "Tokenization across languages: 你好世界 · مرحباً بالعالم · नमस्ते दुनिया · こんにちは世界" },
  { label: "Emoji / URLs", text: "Family 👩🏽‍🚀 + flags 🇺🇳 → https://example.com/search?q=connors-tokenizer&lang=en#specimen" },
] as const

type ResultsMap = Partial<Record<LabId, TokenizerResult>>
type WorkbenchView = "compare" | "benchmarks"

export function TokenizerWorkbench() {
  const [view, setView] = useState<WorkbenchView>("compare")
  const [text, setText] = useState<string>(EXAMPLES[0].text)
  const [results, setResults] = useState<ResultsMap>({})
  const [localLoading, setLocalLoading] = useState(true)
  const workerRef = useRef<Worker | null>(null)
  const openAiWorkerRef = useRef<Worker | null>(null)
  const localRequestRef = useRef(0)

  const runLocal = useCallback((value: string) => {
    if (!workerRef.current || !openAiWorkerRef.current) return
    const id = ++localRequestRef.current
    if (!value) {
      setResults((current) => {
        const next = { ...current }
        for (const lab of LOCAL_LAB_IDS) delete next[lab]
        return next
      })
      setLocalLoading(false)
      return
    }
    setResults((current) => {
      const next = { ...current }
      for (const lab of LOCAL_LAB_IDS) delete next[lab]
      return next
    })
    setLocalLoading(true)
    openAiWorkerRef.current.postMessage({ id, text: value })
    workerRef.current.postMessage({ id, text: value })
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL("../workers/tokenizer.worker.ts", import.meta.url), { type: "module" })
    const openAiWorker = new Worker(new URL("../workers/openai.worker.ts", import.meta.url), { type: "module" })
    workerRef.current = worker
    openAiWorkerRef.current = openAiWorker
    const onMessage = (event: MessageEvent<{ id: number; results: TokenizerResult[]; done?: boolean }>) => {
      if (event.data.id !== localRequestRef.current) return
      setResults((current) => {
        const next = { ...current }
        for (const result of event.data.results) next[result.lab] = result
        return next
      })
      if (event.data.done !== false) setLocalLoading(false)
    }
    worker.onmessage = onMessage
    openAiWorker.onmessage = onMessage
    worker.onerror = () => {
      setLocalLoading(false)
      setResults((current) => {
        const next = { ...current }
        for (const lab of LOCAL_LAB_IDS) {
          if (!next[lab]) {
            const manifest = manifestByLab[lab]
            next[lab] = {
              lab,
              modelId: manifest.modelId,
              status: "error",
              fidelity: manifest.fidelity,
              sourceUrl: manifest.sourceUrl,
              note: "The browser worker could not initialize this tokenizer.",
            }
          }
        }
        return next
      })
    }
    openAiWorker.onerror = () => {
      const manifest = manifestByLab.openai
      setResults((current) => ({ ...current, openai: {
        lab: "openai",
        modelId: manifest.modelId,
        status: "error",
        fidelity: manifest.fidelity,
        sourceUrl: manifest.sourceUrl,
        note: "The o200k_base browser worker could not initialize.",
      } }))
    }
    const id = ++localRequestRef.current
    openAiWorker.postMessage({ id, text: EXAMPLES[0].text })
    worker.postMessage({ id, text: EXAMPLES[0].text })
    return () => {
      worker.terminate()
      openAiWorker.terminate()
    }
  }, [])

  const ranked = useMemo(() => rankedResults(Object.values(results)), [results])

  function selectView(nextView: WorkbenchView, moveFocus = false) {
    setView(nextView)
    if (moveFocus) window.requestAnimationFrame(() => document.getElementById(`view-tab-${nextView}`)?.focus())
  }

  function handleViewKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentView: WorkbenchView) {
    let nextView: WorkbenchView | undefined
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") nextView = currentView === "compare" ? "benchmarks" : "compare"
    if (event.key === "Home") nextView = "compare"
    if (event.key === "End") nextView = "benchmarks"
    if (!nextView) return
    event.preventDefault()
    selectView(nextView, true)
  }

  return (
    <TooltipProvider>
      <main className="lab-shell">
        <header className="lab-header">
          <div className="lab-title-row">
            <div>
              <h1>Tokenizer Lab</h1>
              <p className="lab-deck">{view === "compare" ? "Explore Connor Love’s tokenizer alongside nine established tokenizer baselines." : "Evaluate Connor Love’s tokenizer across compression, multilingual, robustness, and throughput benchmarks."}</p>
            </div>
            <div className="lab-index" aria-label="Ten tokenizers compared"><strong>10</strong><span>tokenizers<br />compared</span></div>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Tokenizer comparison views">
          <div role="tablist" aria-label="Comparison mode" className="view-tablist">
            {(["compare", "benchmarks"] as const).map((tabView) => {
              const selected = view === tabView
              const label = tabView === "compare" ? "Compare text" : "Benchmark suite"
              return <button
                key={tabView}
                type="button"
                role="tab"
                id={`view-tab-${tabView}`}
                aria-controls={`view-panel-${tabView}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="view-tab"
                onClick={() => selectView(tabView)}
                onKeyDown={(event) => handleViewKeyDown(event, tabView)}
              >{label}</button>
            })}
          </div>
        </nav>

        <Separator className="lab-rule" />

        {view === "compare" ? <div id="view-panel-compare" role="tabpanel" aria-labelledby="view-tab-compare" className="lab-grid">
          <aside className="composer-column" aria-label="Input controls">
            <Card variant="outline" className="composer-sheet">
              <div className="section-label"><span>01</span> Input</div>
              <label htmlFor="specimen-text" className="input-label">Text to compare</label>
              <Textarea id="specimen-text" value={text} maxLength={MAX_LENGTH} onChange={(event) => {
                const value = event.target.value
                setText(value)
                runLocal(value)
              }} placeholder="Enter or paste text" aria-describedby="specimen-counts" className="lab-textarea" />
              <div id="specimen-counts" className="counter-row" aria-live="polite">
                <span><strong>{text.length.toLocaleString()}</strong> chars</span>
                <span><strong>{countWords(text).toLocaleString()}</strong> words</span>
                <span><strong>{countBytes(text).toLocaleString()}</strong> bytes</span>
                <span className={text.length > MAX_LENGTH * 0.9 ? "counter-limit" : ""}>{(MAX_LENGTH - text.length).toLocaleString()} left</span>
              </div>

              <div className="preset-block">
                <span className="input-label">Examples</span>
                <div className="preset-grid">
                  {EXAMPLES.map((example) => <Button key={example.label} variant="outline" size="sm" onClick={() => {
                    setText(example.text)
                    runLocal(example.text)
                  }}>{example.label}</Button>)}
                </div>
              </div>

            </Card>
          </aside>

          <div className="results-column">
            <section className="ruler-section" aria-labelledby="ruler-title">
              <div className="section-label"><span>02</span> Token count</div>
              <div className="ruler-heading">
                <div><h2 id="ruler-title">Token count by tokenizer</h2></div>
                <Badge variant="outline">{ranked.length} / {TOKENIZER_MANIFEST.length} measured</Badge>
              </div>
              {!text ? <div className="empty-ruler">Enter text to compare token counts.</div> : <RankedRuler ranked={ranked} loading={localLoading} label="Token counts ranked from smallest to largest" />}
            </section>

            <Separator className="lab-rule" />

            <section className="comparison-section" aria-labelledby="comparison-title">
              <div className="section-label"><span>03</span> Tokenizer output</div>
              <div className="comparison-heading"><h2 id="comparison-title">Results</h2></div>
              <div className="result-list" aria-live="polite" aria-busy={localLoading}>
                {TOKENIZER_MANIFEST.map((manifest, index) => <ResultPanel key={manifest.lab} index={index + 1} manifest={manifest} result={results[manifest.lab]} loading={Boolean(text) && localLoading && !results[manifest.lab]} />)}
              </div>
            </section>

            <MeasurementDisclosure sectionNumber="04" />
          </div>
        </div> : <div id="view-panel-benchmarks" role="tabpanel" aria-labelledby="view-tab-benchmarks">
          <BenchmarkSuiteView />
        </div>}

        <footer className="project-footer">
          <p>Tokenizer Lab is free software licensed under GNU AGPL v3.0 only.</p>
          <nav aria-label="Project information">
            <a href="https://github.com/connorlove/tokenizer">Source code</a>
            <a href="https://github.com/connorlove/tokenizer/blob/main/LICENSE">License</a>
            <a href="https://github.com/connorlove/tokenizer/blob/main/THIRD_PARTY_NOTICES.md">Third-party notices</a>
          </nav>
        </footer>
      </main>
    </TooltipProvider>
  )
}

type BenchmarkSystem = (typeof BENCHMARK_REPORT.systems)[number]
type BenchmarkTrack = (typeof BENCHMARK_REPORT.corpus.tracks)[number]

function BenchmarkSuiteView() {
  const systems = BENCHMARK_REPORT.systems as BenchmarkSystem[]
  const tracks = BENCHMARK_REPORT.corpus.tracks as BenchmarkTrack[]
  const ranked = [...systems].sort((left, right) => left.overall.tokens - right.overall.tokens)
  const totalRecords = tracks.reduce((sum, track) => sum + track.records, 0)
  const totalBytes = tracks.reduce((sum, track) => sum + track.utf8Bytes, 0)
  const sourceTracks = tracks.filter((track) => !track.id.startsWith("tokenizerbench-"))
  const fixtureTracks = tracks.filter((track) => track.id.startsWith("tokenizerbench-"))

  return <div className="benchmark-view">
    <section className="suite-intro" aria-labelledby="suite-title">
      <div className="section-label"><span>01</span> Dataset</div>
      <div className="suite-heading">
        <div>
          <h2 id="suite-title">Benchmark corpus</h2>
          <p>{totalRecords.toLocaleString()} fixed records from source datasets, TokenizerBench 0.2.0, and the TokLens Wikipedia recipe. Results do not measure language-model loss or downstream task quality.</p>
        </div>
        <Badge variant="outline">fixed corpus</Badge>
      </div>
      <dl className="suite-facts">
        <div><dt>Records</dt><dd>{totalRecords.toLocaleString()}</dd></div>
        <div><dt>Source bytes</dt><dd>{totalBytes.toLocaleString()}</dd></div>
        <div><dt>Tracks</dt><dd>{tracks.length}</dd></div>
        <div><dt>Corpus SHA-256</dt><dd className="hash-value">{BENCHMARK_REPORT.corpus.corpusSha256.slice(0, 12)}…</dd></div>
      </dl>
      <div className="domain-list benchmark-track-list" aria-label="Benchmark source tracks">
        {sourceTracks.map((track, index) => <div className="domain-item" key={track.id}>
          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <strong>{track.label}</strong>
          <small>{track.records.toLocaleString()} records · {track.utf8Bytes.toLocaleString()} bytes</small>
        </div>)}
      </div>
      <details className="benchmark-data" open>
        <summary><span>Source inventory</span><small>revisions, licenses, and fixture groups</small></summary>
        <div className="benchmark-source-groups">
          {sourceTracks.map((track) => <section key={track.id} aria-labelledby={`benchmark-source-${track.id}`}>
            <div className="benchmark-data-heading">
              <h3 id={`benchmark-source-${track.id}`}>{track.label}</h3>
              <span>{track.records} records · {track.utf8Bytes.toLocaleString()} bytes</span>
            </div>
            {Object.keys(track.groups).length ? <p className="benchmark-group-list"><strong>Groups</strong> {Object.entries(track.groups).map(([group, count]) => `${group} (${count})`).join(" · ")}</p> : null}
            <ul className="source-sample-list">
              {track.samples.map((sample) => <li key={sample.id}>
                <a href={sample.sourceUrl} target="_blank" rel="noreferrer">{sample.title}</a>
                <span>{sample.utf8Bytes.toLocaleString()} bytes · {sample.license} · {sample.revision}</span>
              </li>)}
            </ul>
            {track.records > track.samples.length ? <p className="source-inventory-note">Showing {track.samples.length} named records. The lock file covers all {track.records} records and content hashes.</p> : null}
          </section>)}
        </div>
      </details>
      <details className="benchmark-data fixture-inventory">
        <summary><span>TokenizerBench 0.2.0 inventory</span><small>1,967 exact published fixtures · pinned wheel</small></summary>
        <div className="fixture-groups">
          {fixtureTracks.map((track) => <section key={track.id} aria-labelledby={`fixture-${track.id}`}>
            <div className="benchmark-data-heading"><h3 id={`fixture-${track.id}`}>{track.label}</h3><span>{track.records} cases · {track.utf8Bytes.toLocaleString()} bytes</span></div>
            <p className="benchmark-group-list">{Object.entries(track.groups).map(([group, count]) => `${group} (${count})`).join(" · ")}</p>
          </section>)}
        </div>
      </details>
    </section>

    <Separator className="lab-rule" />

    <section className="suite-ruler-section" aria-labelledby="suite-ruler-title">
      <div className="section-label"><span>02</span> Aggregate token count</div>
      <div className="ruler-heading">
        <div><h2 id="suite-ruler-title">Unique records</h2><p>Duplicate source files are counted once. Lower counts indicate shorter sequences on this corpus, not better language models.</p></div>
        <Badge variant="outline">{ranked.length} / {TOKENIZER_MANIFEST.length} measured</Badge>
      </div>
      <CorpusRuler systems={ranked} />
    </section>

    <Separator className="lab-rule" />

    <section className="benchmark-section" aria-labelledby="benchmark-title">
      <div className="section-label"><span>03</span> Compression by dataset</div>
      <div className="benchmark-heading">
        <div>
          <h2 id="benchmark-title">UTF-8 bytes per token</h2>
          <p>Higher values indicate denser encoding. Results are reported per dataset, without a composite score.</p>
        </div>
        <Badge variant="outline">higher is denser</Badge>
      </div>
      <div className="benchmark-table-shell" role="region" aria-labelledby="benchmark-title" tabIndex={0}>
        <table className="benchmark-table corpus-track-table">
          <caption>UTF-8 bytes per token for every benchmark track and tokenizer.</caption>
          <thead>
            <tr>
              <th scope="col">Track</th>
              <th scope="col">Input</th>
              {systems.map((system) => <th scope="col" key={system.lab} data-owner-column={system.lab === "atlas" ? "true" : undefined}><LabMark lab={system.lab as LabId} compact />{benchmarkSystemLabel(system)}</th>)}
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => <tr key={track.id}>
              <th scope="row">{track.label}</th>
              <td>{track.utf8Bytes.toLocaleString()} B</td>
              {systems.map((system) => {
                const bytesPerToken = system.tracks[track.id as keyof typeof system.tracks].bytesPerToken
                return <BenchmarkCell
                    key={system.lab}
                    isOwnerColumn={system.lab === "atlas"}
                    value={bytesPerToken.toFixed(2)}
                    isBest={isBestMetric(
                      bytesPerToken,
                      systems.map((candidate) => candidate.tracks[track.id as keyof typeof candidate.tracks].bytesPerToken),
                      "higher",
                      roundTo(2),
                    )}
                  />
              })}
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="benchmark-footnote">B/T means UTF-8 bytes per raw-text token. Track byte counts exclude the two-newline separators added between records; per-tokenizer cells include those separators consistently.</p>
    </section>

    <Separator className="lab-rule" />

    <section className="benchmark-section" aria-labelledby="toklens-title">
      <div className="section-label"><span>04</span> TokLens metrics</div>
      <div className="benchmark-heading"><div><h2 id="toklens-title">Wikipedia, 15 languages</h2><p>Macro averages use the TokLens intrinsic metric definitions and Wikipedia 20231101 recipe. Samples are comparable, not translations.</p></div><Badge variant="outline">15 languages</Badge></div>
      <div className="benchmark-table-shell" role="region" aria-labelledby="toklens-title" tabIndex={0}>
        <table className="benchmark-table suite-benchmark-table">
          <caption>TokLens-compatible intrinsic metrics. Direction arrows do not form a combined score.</caption>
          <thead><tr><th scope="col">Tokenizer</th><BenchmarkHeading label="fertility" direction="lower" /><BenchmarkHeading label="chars / token" direction="higher" /><BenchmarkHeading label="bytes / token" direction="higher" /><BenchmarkHeading label="STRR" direction="higher" /><BenchmarkHeading label="NSL" direction="lower" /><th scope="col">parity range</th><BenchmarkHeading label="edge round trip" direction="higher" /><BenchmarkHeading label="encode MB/s" direction="higher" /></tr></thead>
          <tbody>{systems.map((system) => <tr key={system.lab}>
            <th scope="row"><LabMark lab={system.lab as LabId} compact />{benchmarkSystemLabel(system)}</th>
            <BenchmarkCell value={system.toklens.macro.fertility.toFixed(2)} isBest={isBestMetric(system.toklens.macro.fertility, systems.map((candidate) => candidate.toklens.macro.fertility), "lower", roundTo(2))} />
            <BenchmarkCell value={system.toklens.macro.charactersPerToken.toFixed(2)} isBest={isBestMetric(system.toklens.macro.charactersPerToken, systems.map((candidate) => candidate.toklens.macro.charactersPerToken), "higher", roundTo(2))} />
            <BenchmarkCell value={system.toklens.macro.compressionRatio.toFixed(2)} isBest={isBestMetric(system.toklens.macro.compressionRatio, systems.map((candidate) => candidate.toklens.macro.compressionRatio), "higher", roundTo(2))} />
            <BenchmarkCell value={formatPercent(system.toklens.macro.singleTokenRetentionRate)} isBest={isBestMetric(system.toklens.macro.singleTokenRetentionRate, systems.map((candidate) => candidate.toklens.macro.singleTokenRetentionRate), "higher", roundTo(2))} />
            <BenchmarkCell value={system.toklens.macro.normalizedSequenceLength.toFixed(3)} isBest={isBestMetric(system.toklens.macro.normalizedSequenceLength, systems.map((candidate) => candidate.toklens.macro.normalizedSequenceLength), "lower", roundTo(3))} />
            <td>{system.toklens.macro.parityRange[0].toFixed(2)}–{system.toklens.macro.parityRange[1].toFixed(2)}</td>
            <BenchmarkCell value={`${system.robustness.roundTrip.exact} / ${system.robustness.roundTrip.cases}`} isBest={isBestMetric(system.robustness.roundTrip.exact / system.robustness.roundTrip.cases, systems.map((candidate) => candidate.robustness.roundTrip.exact / candidate.robustness.roundTrip.cases), "higher")} />
            <BenchmarkCell value={formatThroughput(system.throughput.megabytesPerSecond)} isBest={isBestMetric(system.throughput.megabytesPerSecond, systems.map((candidate) => candidate.throughput.megabytesPerSecond), "higher", normalizeThroughput)} />
          </tr>)}</tbody>
        </table>
      </div>
      <p className="benchmark-footnote">Throughput is encode-only on the recorded {BENCHMARK_REPORT.environment.cpu} / {BENCHMARK_REPORT.environment.node} run. It is implementation- and machine-specific; it is not a tokenizer-quality score.</p>
    </section>

    <Separator className="lab-rule" />

    <section className="evidence-section" aria-labelledby="evidence-title">
      <div className="section-label"><span>05</span> Validation scope</div>
      <div className="benchmark-heading"><div><h2 id="evidence-title">Methods and external evidence</h2></div></div>
      <div className="evidence-grid">
        <article><span>Executed</span><h3>TokenizerBench 0.2.0</h3><p>All 84 language groups, 17 code groups, 237 math/science cases, and 292 edge cases were encoded from the verified published wheel.</p><a href={BENCHMARK_REPORT.externalEvidence.tokenizerBench.sourceUrl} target="_blank" rel="noreferrer">Pinned source ↗</a></article>
        <article><span>Metrics reproduced</span><h3>TokLens · ACL 2026</h3><p>The six intrinsic definitions were run across its 15-language Wikipedia recipe. Its downstream correlation analysis was not rerun.</p><a href={BENCHMARK_REPORT.externalEvidence.tokLens.sourceUrl} target="_blank" rel="noreferrer">Paper ↗</a></article>
        <article><span>External evidence only</span><h3>TokenMonster · 16 models</h3><p>The author’s matched pretraining experiment is relevant precedent, but it does not include a model trained with Connor’s Tokenizer. A comparable downstream claim still requires matched language-model training.</p><a href={BENCHMARK_REPORT.externalEvidence.tokenMonster.sourceUrl} target="_blank" rel="noreferrer">Original report ↗</a></article>
      </div>
    </section>

    <MeasurementDisclosure sectionNumber="06" benchmarkView />
  </div>
}

function CorpusRuler({ systems }: { systems: BenchmarkSystem[] }) {
  const smallest = systems[0]?.overall.tokens ?? 0
  const largest = systems.at(-1)?.overall.tokens ?? 1
  return <div className="ruler" role="list" aria-label="Unique-corpus token counts ranked from smallest to largest">
    {systems.map((system, index) => {
      const manifest = manifestByLab[system.lab as LabId]
      const width = Math.max(12, (system.overall.tokens / largest) * 100)
      return <div className="ruler-row" role="listitem" key={system.lab}>
        <span className="ruler-rank">{String(index + 1).padStart(2, "0")}</span>
        <span className="ruler-name">{benchmarkSystemLabel(system)}</span>
        <div className="ruler-track"><span style={{ width: `${width}%`, backgroundColor: manifest.accent }} /></div>
        <span className="ruler-score" data-best={system.overall.tokens === smallest ? "true" : undefined}>{system.overall.tokens.toLocaleString()}</span>
        <span className="ruler-delta">{index === 0 ? "base" : `+${relativeDifference(system.overall.tokens, smallest).toFixed(0)}%`}</span>
      </div>
    })}
  </div>
}

function RankedRuler({ ranked, loading, label }: { ranked: ReturnType<typeof rankedResults>; loading: boolean; label: string }) {
  if (ranked.length === 0) return loading ? <RulerSkeleton /> : <div className="empty-ruler">Measurements are unavailable.</div>
  const smallest = ranked[0]?.tokenCount ?? 0
  const largest = ranked.at(-1)?.tokenCount ?? 1
  return <div className="ruler" role="list" aria-label={label}>
    {ranked.map((result, index) => {
      const manifest = manifestByLab[result.lab]
      const width = Math.max(12, (result.tokenCount / largest) * 100)
      return <div className="ruler-row" role="listitem" key={result.lab}>
        <span className="ruler-rank">{String(index + 1).padStart(2, "0")}</span>
        <span className="ruler-name">{manifest.shortName}</span>
        <div className="ruler-track"><span style={{ width: `${width}%`, backgroundColor: manifest.accent }} /></div>
        <span className="ruler-score" data-best={result.tokenCount === smallest ? "true" : undefined}>{result.tokenCount.toLocaleString()}</span>
        <span className="ruler-delta">{index === 0 ? "base" : `+${relativeDifference(result.tokenCount, smallest).toFixed(0)}%`}</span>
      </div>
    })}
  </div>
}

function benchmarkSystemLabel(system: BenchmarkSystem) {
  return system.lab === "atlas" ? manifestByLab.atlas.shortName : system.label
}

function BenchmarkHeading({ label, direction }: { label: string; direction: "higher" | "lower" }) {
  return <th scope="col">{label} <span className="benchmark-direction" aria-hidden="true">{direction === "higher" ? "↑" : "↓"}</span><span className="sr-only">, {direction} is better</span></th>
}

function BenchmarkValue({ value, isBest }: { value: string | undefined; isBest: boolean }) {
  if (!isBest) return value
  return <strong className="benchmark-best" data-best="true">{value}<span className="sr-only">, best score</span></strong>
}

function BenchmarkCell({ value, isBest, isOwnerColumn = false }: { value: string | undefined; isBest: boolean; isOwnerColumn?: boolean }) {
  return <td data-best={isBest ? "true" : undefined} data-owner-column={isOwnerColumn ? "true" : undefined}>
    <BenchmarkValue value={value} isBest={isBest} />
  </td>
}

function isBestMetric(
  value: number | undefined,
  values: Array<number | undefined>,
  direction: "higher" | "lower",
  normalize: (metric: number) => number = (metric) => metric,
) {
  if (value === undefined) return false
  const normalizedValues = values.filter((candidate): candidate is number => candidate !== undefined).map(normalize)
  if (normalizedValues.length === 0) return false
  const best = direction === "higher" ? Math.max(...normalizedValues) : Math.min(...normalizedValues)
  return normalize(value) === best
}

function roundTo(precision: number) {
  return (value: number) => Number(value.toFixed(precision))
}

function normalizeThroughput(value: number) {
  return Number(formatThroughput(value))
}

function formatPercent(value?: number) {
  return value === undefined ? undefined : `${(value * 100).toFixed(0)}%`
}

function formatThroughput(value?: number) {
  return value === undefined ? undefined : value.toFixed(value >= 100 ? 0 : 1)
}

function ResultPanel({ index, manifest, result, loading }: { index: number; manifest: TokenizerManifestEntry; result?: TokenizerResult; loading: boolean }) {
  const [piecesOpen, setPiecesOpen] = useState(false)
  const [pieceMode, setPieceMode] = useState<"text" | "ids">("text")
  const pieces = result?.pieces ?? []
  const visiblePieces = piecesOpen ? pieces.slice(0, 200) : pieces.slice(0, 64)
  const status = result?.status

  return <article className="result-article">
    <Card variant="outline" className="result-panel" style={{ "--lab-accent": manifest.accent } as React.CSSProperties}>
      <div className="panel-main">
      <header className="panel-header">
        <div className="panel-identity">
          <span className="panel-index" aria-hidden="true">{String(index).padStart(2, "0")}</span>
          <div><div className="lab-title"><LabMark lab={manifest.lab} /><h3>{manifest.labName}</h3></div><p className="model-id">{result?.modelId ?? manifest.modelId}</p></div>
        </div>
        <StatusBadge status={status} loading={loading} mode={manifest.mode} />
      </header>

      {loading ? <PanelSkeleton /> : !result && !status ? <div className="panel-message"><strong>No input</strong><span>Enter text to run this tokenizer.</span></div> : result?.status !== "ok" ? <div className="panel-message"><strong>Measurement unavailable</strong><span>{result?.note ?? "This tokenizer is unavailable."}</span></div> : <>
        <div className="measurement-grid">
          <Metric label="tokens" value={result.tokenCount?.toLocaleString() ?? "—"} primary />
          <Metric label="chars / token" value={result.charactersPerToken?.toFixed(2) ?? "—"} />
          <Metric label="bytes / token" value={result.benchmarks?.currentBytesPerToken.toFixed(2) ?? "—"} />
          <Metric label="tokens / word" value={result.benchmarks?.currentTokensPerWord.toFixed(2) ?? "—"} />
        </div>
        {pieces.length > 0 ? <div className="pieces-block">
          <div className="pieces-heading"><span>Tokens <em>{pieces.length}{result.tokenCount && result.tokenCount > 200 ? "+" : ""}</em></span></div>
          <div className="token-specimen">
            <div className={`token-stream ${pieceMode === "ids" ? "is-ids" : ""}`} aria-label={`${manifest.labName} token ${pieceMode === "ids" ? "IDs" : "pieces"}`}>
              {visiblePieces.map((piece, pieceIndex) => <TokenSegment key={`${piece.tokenId}-${pieceIndex}`} piece={piece} index={pieceIndex} mode={pieceMode} />)}
            </div>
            <div className="token-toolbar">
              <div className="token-mode" role="group" aria-label={`${manifest.labName} token display`}>
                <Button size="xs" variant="ghost" className={pieceMode === "text" ? "is-active" : ""} aria-pressed={pieceMode === "text"} onClick={() => setPieceMode("text")}>Text</Button>
                <Button size="xs" variant="ghost" className={pieceMode === "ids" ? "is-active" : ""} aria-pressed={pieceMode === "ids"} onClick={() => setPieceMode("ids")}>Token IDs</Button>
              </div>
              {pieces.length > 64 ? <Button size="xs" variant="ghost" className="pieces-toggle" aria-expanded={piecesOpen} onClick={() => setPiecesOpen((current) => !current)}>{piecesOpen ? "Show fewer" : "Show more"}</Button> : null}
            </div>
          </div>
          {result.tokenCount && result.tokenCount > 200 ? <p className="piece-cap">Rendering is capped at the first 200 pieces.</p> : null}
        </div> : <p className="no-pieces">This provider reports a count but does not expose token pieces.</p>}
      </>}

      <footer className="panel-footer">
        <span><b>Method</b> {fidelityLabel(result?.fidelity ?? manifest.fidelity)}</span>
        <span><b>Tokenizer</b> {result?.tokenizerId ?? manifest.tokenizerId}</span>
        {manifest.revision ? <span><b>Pin</b> {manifest.revision}</span> : null}
        <a href={result?.sourceUrl ?? manifest.sourceUrl} target="_blank" rel="noreferrer">Source <span aria-hidden="true">↗</span></a>
      </footer>
      {result?.note && result.status === "ok" ? <p className="panel-note">{result.note}</p> : null}
      </div>
    </Card>
  </article>
}

function TokenSegment({ piece, index, mode }: { piece: NonNullable<TokenizerResult["pieces"]>[number]; index: number; mode: "text" | "ids" }) {
  const value = mode === "ids" ? String(piece.tokenId) : piece.rawValue || piece.displayValue
  return <Tooltip><TooltipTrigger render={<span className={`token-segment token-tone-${index % 6} ${mode === "ids" ? "is-id" : ""}`} tabIndex={0}>{value}</span>} /><TooltipContent>Token {piece.tokenId}{piece.bytes?.length ? ` · ${piece.bytes.length} byte${piece.bytes.length === 1 ? "" : "s"}` : ""}</TooltipContent></Tooltip>
}

function Metric({ label, value, primary = false }: { label: string; value: string; primary?: boolean }) {
  return <div className={primary ? "metric metric-primary" : "metric"}><span>{label}</span><strong>{value}</strong></div>
}

function StatusBadge({ status, loading, mode }: { status?: TokenizerResult["status"]; loading: boolean; mode: TokenizerManifestEntry["mode"] }) {
  if (loading) return <Badge variant="outline"><span className="status-pulse" /> loading</Badge>
  if (status === "ok") return <Badge variant="success">ready · {mode === "hybrid" ? "local proxy" : "local"}</Badge>
  if (status === "error") return <Badge variant="error">unavailable</Badge>
  return <Badge variant="outline">idle</Badge>
}

function fidelityLabel(fidelity: TokenizerResult["fidelity"]) {
  if (fidelity === "official_tokenizer") return "official tokenizer"
  if (fidelity === "research_candidate") return "research candidate"
  return fidelity
}

function PanelSkeleton() {
  return <div className="panel-skeleton" aria-label="Tokenizer loading"><Skeleton className="h-14 w-full" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-6 w-1/2" /></div>
}

function RulerSkeleton() {
  return <div className="ruler-skeleton" aria-label="Measurements loading">{[72, 88, 56].map((width) => <Skeleton key={width} className="h-7" style={{ width: `${width}%` }} />)}</div>
}

function MeasurementDisclosure({ sectionNumber, benchmarkView = false }: { sectionNumber: string; benchmarkView?: boolean }) {
  const [open, setOpen] = useState(false)
  return <Collapsible open={open} onOpenChange={setOpen} className="method-disclosure">
    <CollapsibleTrigger className="method-trigger"><span><span className="section-label inline-label"><span>{sectionNumber}</span> Methodology</span> Measurement details</span><span aria-hidden="true">{open ? "−" : "+"}</span></CollapsibleTrigger>
    <CollapsiblePanel><div className="method-copy">
      {benchmarkView ? <>
        <p><strong>Corpus:</strong> the checked-in manifest and lock define 2,116 record hashes, revisions, licenses, and the corpus SHA-256. Aggregate counts deduplicate repeated content hashes.</p>
        <p><strong>Compression:</strong> each B/T value divides the joined UTF-8 bytes in a dataset by its raw token count. The same two-newline record separators are included for every tokenizer.</p>
        <p><strong>TokenizerBench:</strong> all fixtures are loaded from four data modules in the hash-verified 0.2.0 wheel because its package-level imports are broken.</p>
        <p><strong>TokLens:</strong> the six intrinsic metrics follow the pinned source definitions. Published downstream correlations are external evidence and are not reported as results for Connor’s Tokenizer.</p>
      </> : <>
        <p><strong>Input:</strong> local results count the entered text without role markers, system prompts, beginning-of-sequence tokens, or generation prompts.</p>
        <p><strong>Metrics:</strong> bytes and JavaScript string characters are divided by the token count. Tokens per word uses whitespace-delimited word units.</p>
      </>}
      <p><strong>Throughput:</strong> corpus throughput is the median of three warm Node.js encode-only passes over a 512,000-byte prefix on the recorded machine. It is implementation- and machine-specific.</p>
      <p><strong>Out of scope:</strong> bits per byte, language-model loss, and downstream task quality require matched trained language models and cannot be derived from token IDs.</p>
      <p><strong>Tokenizer versions:</strong> Connor’s Tokenizer is an experimental Unigram candidate. Google uses Gemma 4, Kimi uses K2.6, and Anthropic and xAI use older open tokenizers as labeled proxies.</p>
    </div></CollapsiblePanel>
  </Collapsible>
}
