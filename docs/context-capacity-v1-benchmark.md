# Context capacity benchmark v1

Generated 2026-09-24T22:39:26.627Z from locked corpus `2dbf6ba9ce27a151446b91506cc9290d0540734bb17e5b1a6a21f667be7bae0f`.

This measures how much original trailing text fits after a fixed token budget trims older context. It does not test a language model's recall or reasoning.

## Retained UTF-8 bytes

| Source | Budget | Original bytes | Connor's Tokenizer | OpenAI | Anthropic | Google | Kimi | DeepSeek | Grok | Meta | Mistral | Qwen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Wikipedia | 32,768 | 1,941,193 | 154,350 (8.0%) | 140,676 (7.2%) | 84,918 (4.4%) | 147,126 (7.6%) | 100,750 (5.2%) | 118,944 (6.1%) | 87,514 (4.5%) | 129,136 (6.7%) | 137,222 (7.1%) | 124,381 (6.4%) |
| Wikipedia | 131,072 | 1,941,193 | 663,530 (34.2%) | 656,687 (33.8%) | 371,421 (19.1%) | 640,815 (33.0%) | 439,033 (22.6%) | 556,176 (28.7%) | 388,328 (20.0%) | 566,072 (29.2%) | 616,810 (31.8%) | 524,485 (27.0%) |
| GitHub repositories | 32,768 | 511,605 | 153,680 (30.0%) | 126,638 (24.8%) | 115,368 (22.6%) | 108,892 (21.3%) | 128,010 (25.0%) | 120,412 (23.5%) | 109,722 (21.4%) | 128,006 (25.0%) | 120,505 (23.6%) | 125,467 (24.5%) |
| GitHub repositories | 131,072 | 511,605 | 511,605 (100.0%) | 488,301 (95.4%) | 469,785 (91.8%) | 444,056 (86.8%) | 489,575 (95.7%) | 474,309 (92.7%) | 442,776 (86.5%) | 490,777 (95.9%) | 467,103 (91.3%) | 472,321 (92.3%) |
| Books | 32,768 | 234,972 | 154,402 (65.7%) | 135,219 (57.5%) | 127,023 (54.1%) | 133,268 (56.7%) | 132,631 (56.4%) | 133,385 (56.8%) | 134,106 (57.1%) | 134,617 (57.3%) | 132,776 (56.5%) | 134,480 (57.2%) |
| Books | 131,072 | 234,972 | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) | 234,972 (100.0%) |

## Method and limits

- Each source is the full locked track in its recorded order, with two newlines between records. Every tokenizer receives identical original text.
- For each budget, the runner locates a fitting original Unicode-code-point-aligned suffix by binary search, then checks adjacent boundaries. This models an application retaining the newest text after trimming older input.
- Budgets exclude chat templates, role markers, tool messages, output reservations, and model-specific context limits. They are hypothetical shared budgets, not claims about any product's actual window. Some applications reject overlong input rather than trimming it.
- The Anthropic legacy proxy applies NFKC normalization before counting; Qwen applies NFC. Gemma and Grok are open or legacy proxies, not current proprietary Gemini or Grok tokenizers.
- Token counts can change slightly at a changed text boundary. The search checks adjacent code points, but the binary search assumes that suffix token count generally falls as older code points are removed.
- Retained text measures capacity only. Testing whether information can be found or used requires matched language models trained with these tokenizers.
