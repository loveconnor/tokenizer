# Tokenizer Lab

Tokenizer Lab is an interactive, browser-based showcase for Connor Love's byte-lossless Unigram tokenizer. It compares the tokenizer's token counts, boundaries, corpus compression, multilingual metrics, robustness, and throughput with nine established tokenizer baselines.

The comparison uses pinned tokenizer definitions from nine AI labs alongside Connor's experimental research candidate. All interactive tokenization runs locally in a Web Worker; entered text is not sent to a provider.

> Token counts and intrinsic metrics do not establish language-model quality. Claims about training cost, model loss, or downstream performance require matched model-training experiments.

## What is included

- An editable side-by-side tokenizer comparison.
- A locked 2,116-record benchmark with source revisions, licenses, hashes, and aggregate results.
- Reproducible scripts for tokenizer assets, corpora, protected pieces, training, and benchmarks.
- Unit, component, Python trainer, and browser end-to-end tests.
- Three generations of the original tokenizer artifacts retained for comparison and rollback research.

## Run locally

You need Node.js 20.9 or newer. Python 3.9 or newer is required only for the corpus, training, and Python verification tools.

```bash
git clone https://github.com/connorlove/tokenizer.git
cd tokenizer
npm ci
npm run tokenizers:sync
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `tokenizers:sync` downloads only pinned tokenizer definitions, not model weights.

## Verify a change

Run the fast project checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:trainer
npm run build
```

Run the browser suite after installing Chromium:

```bash
npx playwright install chromium
npm run test:e2e
```

## Research pipelines

Install the pinned Python dependencies before rebuilding corpora or Atlas artifacts:

```bash
python3 -m pip install -r scripts/tokenizer-requirements.txt
```

| Goal | Command |
| --- | --- |
| Download pinned third-party tokenizer definitions | `npm run tokenizers:sync` |
| Rebuild the Atlas training corpus | `npm run tokenizer:corpus` |
| Rebuild protected emoji, URL, and prose pieces | `npm run tokenizer:emoji`, `npm run tokenizer:urls`, `npm run tokenizer:prose` |
| Train the Atlas candidate | `npm run tokenizer:train` |
| Rebuild the locked evaluation corpus | `npm run tokenizer:benchmark:build` |
| Run the ten-tokenizer benchmark | `npm run tokenizer:benchmark:run` |

Downloaded corpora, intermediate models, and third-party tokenizer files are intentionally ignored by Git. The tracked manifests and lock files pin their sources and revisions.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/` | Next.js entry point and global presentation |
| `components/` | Workbench and reusable interface components |
| `workers/` | Browser-local tokenizer execution |
| `lib/tokenizers/` | Tokenizer contracts, Atlas runtime, calculations, and manifests |
| `benchmarks/` | Locked aggregate benchmark evidence and verification |
| `scripts/` | Asset sync, corpus construction, training, and research tooling |
| `public/tokenizers/` | Tracked Atlas artifacts plus locally downloaded vendor artifacts |
| `docs/` | Architecture, reproducibility, and scientific background |
| `e2e/` | Playwright browser journeys |

See [Architecture](docs/architecture.md), [Reproducibility](docs/reproducibility.md), and [Research background](docs/better-tokenizer-research.md) for more detail.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report security problems through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## Licensing

Original project code and Atlas artifacts are licensed under [GNU AGPL v3.0 only](LICENSE). Modified versions used over a network must offer their corresponding source to users under the same license.

Downloaded vendor tokenizer files, corpus sources, research fixtures, names, and trademarks remain subject to their own terms and are not relicensed by this project. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing generated or downloaded artifacts.
