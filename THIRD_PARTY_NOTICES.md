# Third-party notices

Connor's Tokenizer combines original work with dependencies, downloaded tokenizer definitions, public research fixtures, and source corpora. The project license does not replace the terms attached to third-party material.

This inventory is provided to make provenance review possible. It is not a legal opinion or a substitute for reading the linked terms before redistribution.

## Tokenizer definitions

`npm run tokenizers:sync` downloads pinned tokenizer files into `public/tokenizers/`. These vendor directories are ignored by Git and are not distributed as part of this repository.

| Local directory | Pinned source | Declared terms at review time |
| --- | --- | --- |
| `anthropic-legacy` | [`@anthropic-ai/tokenizer` 0.0.4](https://github.com/anthropics/anthropic-tokenizer-typescript) | MIT |
| `gemma-4` | [`google/gemma-4-12B`](https://huggingface.co/google/gemma-4-12B) | Apache-2.0 |
| `kimi-k2.6` | [`moonshotai/Kimi-K2.6`](https://huggingface.co/moonshotai/Kimi-K2.6) | Modified MIT; review the upstream license and notices |
| `deepseek-v3.2` | [`deepseek-ai/DeepSeek-V3.2`](https://huggingface.co/deepseek-ai/DeepSeek-V3.2) | MIT |
| `grok-1` | [`Xenova/grok-1-tokenizer`](https://huggingface.co/Xenova/grok-1-tokenizer) | Apache-2.0 |
| `llama-3.1` | [`Xenova/llama3-tokenizer`](https://huggingface.co/Xenova/llama3-tokenizer) | The conversion repository declares no license; upstream Llama 3.1 uses the Meta Llama 3.1 Community License. Do not redistribute this directory without reviewing both sources. |
| `mistral-small-4` | [`mistralai/Mistral-Small-4-119B-2603`](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603) | Apache-2.0 |
| `qwen3` | [`Qwen/Qwen3-8B`](https://huggingface.co/Qwen/Qwen3-8B) | Apache-2.0 |

OpenAI `o200k_base` is loaded through the `js-tiktoken` package rather than a checked-in vendor artifact. JavaScript dependency versions are recorded in `package-lock.json` and retain their package licenses.

The `atlas-unigram-v1`, `atlas-unigram-v2`, and `atlas-unigram-v3` directories are original generated project artifacts covered by the project license. Their training inputs remain subject to the source terms recorded in `scripts/tokenizer-corpus-sources.json`.

## Corpora and benchmark material

Raw training and evaluation corpora are ignored by Git. The repository keeps manifests, source URLs, revisions, licenses, content hashes, and aggregate reports so results can be audited without redistributing the complete source text.

Material referenced by those manifests includes FineWeb and Common Crawl terms, permissively licensed source repositories, Wikipedia and Stack Overflow Creative Commons content, Project Gutenberg texts, Wikinews, Europe PMC open-access articles, TokenizerBench, and TokLens. Read the exact source inventory before rebuilding or redistributing a corpus:

- `scripts/tokenizer-corpus-sources.json`
- `benchmarks/atlas-corpus-v3.sources.json`
- `benchmarks/atlas-corpus-v3.lock.json`

`scripts/tokenizer-protected-pieces.json` is derived from the Unicode 17.0 emoji test data and records the Unicode-3.0 license and source hash in the file itself. Unicode terms are available from the [Unicode license page](https://www.unicode.org/license.txt).

## Names and marks

Company, model, and product names identify the compared tokenizer sources. They remain the property of their respective owners. Connor's Tokenizer is not endorsed by those organizations.

The monochrome lab SVGs in `public/lab-marks/` are derived from
[`@lobehub/icons-static-svg` 1.94.0](https://github.com/lobehub/lobe-icons),
which is distributed under the MIT License. The license covers the icon package;
the depicted names and marks remain subject to their respective owners’ rights.
