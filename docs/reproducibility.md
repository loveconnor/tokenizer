# Reproducibility

Connor's Tokenizer separates source-controlled evidence from downloaded or generated working data.

## Tracked inputs and evidence

- tokenizer source revisions in `scripts/sync-tokenizers.mjs`;
- training source definitions in `scripts/tokenizer-corpus-sources.json`;
- corpus lock files and protected-piece manifests in `scripts/`;
- benchmark sources, hashes, and aggregate results in `benchmarks/`;
- Connor's Tokenizer browser artifacts and their revision metadata in `public/tokenizers/atlas-*`;
- exact JavaScript and Python dependency versions in `package-lock.json` and `scripts/tokenizer-requirements.txt`.

## Local-only outputs

The following paths are intentionally ignored:

- `data/tokenizer-corpus/` — reconstructed training corpus;
- `data/tokenizer-build/` — intermediate SentencePiece models and vocabularies;
- `data/tokenizer-benchmark/` — reconstructed evaluation tracks;
- third-party directories under `public/tokenizers/` — downloaded vendor definitions;
- `.next/`, `coverage/`, and `test-results/` — build and test output.

## Dependency security overrides

`package.json` overrides `adm-zip`, `postcss`, and `sharp` to patched releases because the current pinned versions of ONNX Runtime, Next.js, and Transformers otherwise resolve to older vulnerable transitive versions. Keep the overrides until those upstream packages adopt patched ranges. Any override change must pass the production build, browser suite, and `npm audit` before merge.

## Reproduce the browser comparison

```bash
npm ci
npm run tokenizers:sync
npm run dev
```

The sync command records each downloaded source and revision in a local `revision.json` file. It downloads tokenizer definitions only, not model weights.

Vercel deployments use `npm run build:vercel` so the same sync runs before the production build. Deploying with plain `next build` omits the ignored vendor directories and leaves those comparisons unavailable.

## Rebuild Connor's Tokenizer

Install the pinned Python dependencies first:

```bash
python3 -m pip install -r scripts/tokenizer-requirements.txt
```

Then rebuild the protected inputs, corpus, and tokenizer in order:

```bash
npm run tokenizer:emoji
npm run tokenizer:urls
npm run tokenizer:prose
npm run tokenizer:corpus
npm run tokenizer:train
```

Review the resulting artifact hashes and benchmark changes before replacing a tracked Connor's Tokenizer version. A successful build alone does not justify a new candidate.

## Rebuild the evaluation report

```bash
npm run tokenizer:benchmark:build
npm run tokenizer:benchmark:run
npm run tokenizer:benchmark:context
npm test
```

The builder downloads bounded source samples, verifies the pinned TokenizerBench wheel, reconstructs the evaluation corpus, and writes local tracks. The runner checks the lock before producing aggregate results. The Vitest integrity test verifies the corpus hash, required tracks, and complete ten-system measurements.

The context-capacity runner uses three locked tracks and the same ten tokenizer definitions. It reports the original trailing UTF-8 bytes retained under 32,768- and 131,072-token budgets in `benchmarks/context-capacity-v1.report.json` and `docs/context-capacity-v1-benchmark.md`. These are hypothetical raw-text budgets; the result does not measure model recall.

## Known limits

- External sources can disappear even when a revision is pinned.
- Some source licenses impose attribution or redistribution conditions beyond this repository's license.
- Throughput depends on the recorded implementation, runtime, and machine.
- Reproducing intrinsic metrics does not reproduce language-model training or downstream evaluations.
