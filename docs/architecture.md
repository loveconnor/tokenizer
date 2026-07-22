# Architecture

Connor's Tokenizer is a Next.js application whose comparison path runs in the browser. It has no application database, account system, or server-side tokenizer proxy.

## Runtime flow

1. `app/page.tsx` renders the `TokenizerWorkbench` client component.
2. The workbench sends the current text to two Web Workers.
3. `workers/openai.worker.ts` runs the local `o200k_base` implementation.
4. `workers/tokenizer.worker.ts` loads pinned tokenizer definitions from `public/tokenizers/` and runs the remaining local adapters.
5. Workers return token counts, pieces, identifiers, status, and measurement metadata to the interface.
6. `benchmarks/atlas-corpus-v3.report.json` supplies the fixed benchmark view; the browser does not rebuild or download the corpus.

Missing vendor assets fail independently and appear as unavailable measurements. Runtime model downloads are disabled, so a missing pin cannot silently resolve to a newer tokenizer.

Vercel runs `npm run build:vercel` through the checked-in `vercel.json`. That command downloads the pinned vendor definitions before `next build`, making the generated files part of the deployment without committing third-party artifacts to Git.

## Ownership boundaries

- `components/` owns rendered behavior and interaction state.
- `lib/tokenizers/` owns tokenizer contracts, Connor's Tokenizer encoding/decoding, manifest metadata, and metric calculations.
- `workers/` owns browser execution and artifact loading.
- `scripts/` owns network downloads, corpus construction, training, and benchmark generation.
- `benchmarks/` owns locked aggregate evidence and its integrity test.
- `public/tokenizers/atlas-*` contains original Connor's Tokenizer artifacts under their legacy artifact slugs. Other tokenizer directories are local downloads and are excluded from Git.

## Data and trust boundaries

Entered comparison text stays in the browser and is passed only to same-origin Web Workers. Corpus-building and synchronization scripts cross a network trust boundary: they use pinned revisions, size limits or hashes where implemented, and must be reviewed when sources change.

Raw corpora and intermediate models remain local under `data/`. The tracked benchmark report contains aggregate measurements and source metadata rather than the reconstructed raw corpus.

## Intentional constraints

- Tokenizers are compared without chat templates, role markers, or generation prompts.
- Intrinsic metrics are evidence about segmentation, not model quality.
- The interface remains usable when one tokenizer fails to load.
- Large generated artifacts are kept out of ordinary source modules and marked for generated-diff treatment.
