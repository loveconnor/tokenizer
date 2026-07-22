# Contributing to Tokenizer Lab

Tokenizer Lab welcomes focused fixes, tests, documentation, reproducibility improvements, and well-supported tokenizer research.

## Before you start

Search existing issues before beginning a large change. Open an issue first when a proposal changes the benchmark protocol, tracked artifacts, public terminology, dependencies, or tokenizer behavior; those changes need agreement on evidence and compatibility before implementation.

Do not include credentials, private data, proprietary corpora, or material you do not have permission to redistribute.

## Development setup

```bash
npm ci
npm run tokenizers:sync
npm run dev
```

Node.js 20.9 or newer is required. Python 3.9 or newer and the packages in `scripts/tokenizer-requirements.txt` are required for corpus and training work.

## Project checks

Run these before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run test:trainer
npm run build
```

Changes to rendered behavior should also pass:

```bash
npx playwright install chromium
npm run test:e2e
```

Add or update the lowest-level test that proves the behavior you changed. A green test suite does not replace manual review of claims, generated artifacts, accessibility, or benchmark provenance.

## Generated and downloaded files

- Do not commit `data/`, `.next/`, `test-results/`, or downloaded vendor tokenizer directories.
- Commit Atlas tokenizer artifacts only when the generating inputs, commands, hashes, and benchmark evidence are part of the same change.
- Keep source revisions and SHA-256 values pinned. Do not replace a pin with a moving branch or `latest` tag.
- Record the source, license, selection method, and privacy treatment for new corpus material.
- Review large JSON changes deliberately; files marked as generated in `.gitattributes` still require provenance and reproducibility evidence.

## Pull requests

Keep each pull request focused. Explain:

1. The observable problem and intended outcome.
2. What changed and what did not.
3. The checks you ran and their actual results.
4. Any remaining uncertainty, compatibility effect, or research limitation.
5. Provenance and licensing for new data, artifacts, marks, or copied material.

Screenshots help reviewers assess visual changes, but do not replace keyboard, zoom, and responsive checks.

## License for contributions

By submitting a contribution, you agree that your contribution may be distributed under the repository's [GNU AGPL v3.0-only license](LICENSE). You must have the right to submit the work. Third-party material must keep its original license and attribution.
