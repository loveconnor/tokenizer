# Tokenizer artifacts

This directory contains two different classes of files.

## Tracked Atlas artifacts

`atlas-unigram-v1`, `atlas-unigram-v2`, and `atlas-unigram-v3` are generated project artifacts. V3 is the active research candidate; v1 and v2 remain as comparison and rollback evidence.

Rebuild the candidate from the repository root:

```bash
python3 -m pip install -r scripts/tokenizer-requirements.txt
npm run tokenizer:emoji
npm run tokenizer:urls
npm run tokenizer:prose
npm run tokenizer:corpus
npm run tokenizer:train
```

The corpus and intermediate model files are written under `data/` and are not tracked.

## Local vendor artifacts

The other tokenizer directories are downloaded locally and ignored by Git:

```bash
npm run tokenizers:sync
```

The sync script pins every source revision and writes a `revision.json` beside the downloaded files. It downloads tokenizer definitions only, not model weights. A missing directory produces a visible unavailable state in the app instead of a runtime download.

Do not commit or redistribute downloaded vendor files without reviewing their terms. See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) and [`docs/reproducibility.md`](../../docs/reproducibility.md).
