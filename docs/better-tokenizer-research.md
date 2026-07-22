# Tokenizer design for outperforming nine comparison baselines

## Research report

| Field | Value |
| --- | --- |
| Research mode | Rapid evidence review, repository audit, preliminary diagnostic experiment, and preregisterable R&D plan |
| Review date | 2026-07-21 |
| Decision owner | Connor's Tokenizer project owner |
| Primary question | Which tokenizer design is the strongest candidate for outperforming all nine pinned comparison baselines under matched model-training conditions? |
| Scope | General-purpose tokenization for a decoder-only language model covering multilingual text, code, numbers, structured data, and noisy user input |
| Comparison set | Nine pinned systems in `lib/tokenizers/manifest.ts` |
| Current evidence status | Candidate hypothesis; superiority has not been demonstrated |
| Required confirmation | Matched language-model training and all preregistered gates in this report |

### How to read this report

The report distinguishes four kinds of statements:

- **Observed result:** evidence produced by the repository audit or preliminary diagnostic.
- **Literature finding:** a conclusion bounded by the cited external studies.
- **Research hypothesis:** a proposed design that still requires direct testing.
- **Decision criterion:** a requirement or gate to define before confirmatory experiments.

## 1. Abstract

Do **not** optimize only for the smallest token count. The strongest controlled evidence shows that token count, fertility, parity, and even information-theoretic efficiency can fail to predict downstream model quality. A tokenizer is part of the model architecture: it changes sequence length, embedding and softmax size, training examples per byte, context coverage, morphology, robustness, and the distribution of learning targets.

The most promising fixed-vocabulary research hypothesis is a **lossless byte-fallback, parity-aware, regularized Unigram tokenizer whose candidate vocabulary is initialized with BPE-style substring mining**. It should:

1. Preserve every input byte and expose exact byte offsets. Never require an unknown token.
2. Learn from a language- and domain-stratified corpus, rather than raw-frequency sampling.
3. Allocate vocabulary with a max-min or parity-aware objective so high-resource English and code cannot consume nearly all useful pieces.
4. Use a broad BPE-derived candidate pool, then Unigram/Viterbi selection and pruning. This combines BPE's useful candidate discovery with Unigram's non-greedy segmentation.
5. Sample alternative valid segmentations during model training, while using deterministic Viterbi segmentation at inference.
6. Treat pre-tokenization, digit grouping, whitespace, code identifiers, URLs, and emoji as ablations—not inherited regex folklore.
7. Select vocabulary size jointly with model size and compute. The serious sweep is approximately 128K, 192K, and 256K, not a reflexive 32K vocabulary.
8. Keep control tokens outside ordinary text tokenization so a user string cannot silently become a privileged instruction token.
9. Be evaluated first with cheap intrinsic tests, then with matched 100M–300M proxy models, and finally with at least one larger confirmation run.

The higher-risk alternative is to remove the fixed tokenizer and use a byte/patch architecture such as BLT, MEGABYTE, Charformer, or MambaByte. Those systems address brittleness and vocabulary lock-in more directly, but they are model-architecture projects rather than drop-in tokenizers.

**Decision implication:** build the evaluator first, then test the proposed tokenizer family against reproducible BPE and Unigram controls. Do not make a superiority claim until the matched-model, fixed-compute, multilingual, downstream, robustness, and statistical gates all pass.

## 2. Research question and success criteria

There is no scientifically meaningful universal ordering of tokenizers without a target model, data distribution, and outcome. This review operationalizes “better” as follows.

### 2.1 Required properties

- **Lossless:** decoding the ordinary-text token sequence reproduces the original UTF-8 bytes exactly.
- **Total:** every byte string accepted by the product is encodable; ordinary text never becomes `<unk>`.
- **Deterministic at inference:** the same version, input bytes, and options always produce the same IDs and offsets.
- **Safe control channel:** ordinary input cannot produce control-token semantics unless the caller explicitly inserts a typed control token.
- **Auditable:** training data mixture, normalization policy, trainer version, vocabulary, scores/merge rules, checksums, and evaluation corpus are versioned.

### 2.2 Primary performance endpoints

A final “better than all nine” claim should require all of these under a preregistered, matched experiment:

1. **Compute-normalized language modeling:** lower held-out bits per original UTF-8 byte than every baseline, with the upper bound of a paired 95% confidence interval below zero for each comparison.
2. **Downstream utility:** higher macro-average across predeclared multilingual, code, numerical, long-context, and robustness task families than every baseline; no critical language or safety slice may regress beyond its non-inferiority margin.
3. **Efficiency:** lower end-to-end training FLOPs to reach a fixed validation bits-per-byte target, or better validation bits per byte at fixed FLOPs. Report embedding/softmax cost separately from transformer cost.
4. **Cross-language equity:** lower worst-language token premium and lower Gini coefficient on meaning-aligned parallel text than every baseline, or a predeclared non-inferiority margin paired with a material downstream gain.
5. **Correctness and robustness:** zero unknowns, exact round trips, bounded token-sequence amplification under one-character edits, and no privileged special-token injection through ordinary text.

### 2.3 Secondary endpoints

- tokenization and detokenization throughput, median and p95 latency, peak memory, artifact size, startup time, and streaming behavior;
- bytes per token and tokens per normalized unit by language and domain;
- context-window bytes or semantic units before truncation;
- vocabulary utilization and tail-token training counts;
- morpheme-boundary precision/recall/F1 where reliable annotations exist;
- sensitivity to Unicode normalization, casing, diacritics, spelling variation, whitespace, and homoglyphs;
- arithmetic, identifier copying, spelling, and phonological tasks.

No weighted composite score should be invented after results are visible. If a composite is wanted, its weights and minimum slice-level constraints must be fixed before training.

## 3. Baseline audit and preliminary results

The repository compares model-family tokenizers, not permanent properties of companies. Four labels are explicit proxies: Gemma is not Gemini, Kimi K2.6 is not K3, Anthropic's local artifact predates Claude 3, and Grok-1 is not the current private Grok tokenizer. This report therefore limits its claims to the pinned artifacts rather than the companies' current private systems.

| Baseline | Pinned representation | Base vocabulary in the artifact/manifest | Important design detail | Main risk in a universal comparison |
| --- | --- | ---: | --- | --- |
| OpenAI | `o200k_base` | about 200K | byte-level BPE; case-aware letter regex; digits grouped in runs of 1–3 | strong modern baseline, but the vocabulary/data recipe is not fully reproducible here |
| Anthropic | official 2023 open tokenizer | 64,739 explicit IDs | BPE ranks; NFKC is applied by this app before encoding; unbounded digit runs | legacy proxy; compatibility normalization changes some original strings |
| Google | Gemma 4 | 262,144 | BPE artifact with byte fallback; spaces mapped through `▁` | not Gemini; very large embedding/softmax vocabulary must be charged to the model budget |
| Moonshot | Kimi K2.6 | 163,584 | byte-level BPE; Han-aware regex; digits grouped 1–3 | temporary K2.6 proxy for a changing family |
| DeepSeek | V3.2 | 128,000 | byte-level BPE; digits 1–3; CJK-specific split before a general regex | hard script boundaries can help compression but also constrain learned pieces |
| xAI | Grok-1 conversion | 131,072 | original SentencePiece family; checked-in conversion is a BPE graph with byte fallback | old open proxy is much weaker on this report's multilingual probe |
| Meta | Llama 3.1 family | 128,000 | byte-level BPE; digits 1–3; contraction-aware regex | browser asset is a pinned conversion, not Meta's original package |
| Mistral | Mistral Small 4 | 131,072 | Tekken BPE; single-digit split; case-aware letter runs | single digits improve compositional regularity but greatly increase numeric sequence length |
| Alibaba | Qwen3 | 151,643 | byte-level BPE; single-digit split; NFC normalization | canonical normalization is not byte-lossless |

### 3.1 Shared structural weakness

All seven Hugging Face `tokenizer.json` artifacts checked into this repository serialize a BPE model. OpenAI and the Anthropic legacy artifact also use BPE ranks. The nine-way comparison therefore has less algorithmic diversity than the nine lab names imply. A strong Unigram or learned byte/patch system tests a real blind spot.

### 3.2 Preliminary repository diagnostic

I ran the pinned local tokenizers on 30 hand-authored strings: three each for English prose, code, numbers, CJK, Arabic/Devanagari/Thai, European morphology, emoji/symbols, whitespace, Unicode variants, and identifiers/URLs. Counts exclude BOS/EOS and chat templates. `bytes/token` is total original UTF-8 bytes divided by tokens, so higher is shorter. The test ran against the repository revisions on 2026-07-21.

| Baseline | Total tokens | Bytes/token | Best category result(s) in this probe | Round-trip note |
| --- | ---: | ---: | --- | --- |
| OpenAI `o200k_base` | **528** | **3.553** | tied English, whitespace, identifiers/URLs | exact on all 30 |
| DeepSeek V3.2 | 557 | 3.368 | tied CJK | exact on all 30 |
| Llama 3.1 | 569 | 3.297 | code; tied whitespace and identifiers/URLs | exact on all 30 |
| Kimi K2.6 | 596 | 3.148 | tied English and whitespace | exact on all 30 |
| Gemma 4 | 621 | 3.021 | tied CJK; complex scripts; European morphology; emoji/symbols | exact on all 30 |
| Qwen3 | 657 | 2.855 | tied whitespace | changed 2 Unicode-variant fixtures through NFC normalization |
| Mistral Small 4 | 680 | 2.759 | none | exact on all 30 |
| Anthropic legacy | 736 | 2.549 | numbers; lowest count on Unicode variants after normalization | harness compared decode with the required NFKC-normalized source, not the original bytes |
| Grok-1 proxy | 1,013 | 1.852 | none | exact on all 30 |

Category token totals show why an overall rank is insufficient:

| Category | Lowest count | Highest count | Observed design signal |
| --- | ---: | ---: | --- |
| English prose | 39, OpenAI/Kimi | 41, Gemma/DeepSeek/Grok | mature tokenizers are nearly tied on ordinary English |
| Code | 71, Llama | 82, Gemma/Grok | identifiers and punctuation policy matter |
| Numbers | 76, Anthropic legacy | 157, Grok | single-digit policies produced 154 tokens for Gemma/Mistral/Qwen; compactness alone does not establish numeracy |
| CJK | 38, Gemma/DeepSeek | 91, Grok | corpus allocation and script handling dominate |
| Arabic/Devanagari/Thai | 44, Gemma | 261, Grok | the largest practical gap; raw English-weighted frequency is unacceptable |
| Emoji/symbols | 66, Gemma | 144, Grok | byte fallback guarantees coverage but not efficient coverage |
| Identifiers/URLs | 62, OpenAI/Llama | 97, Grok | pre-tokenization boundaries constrain reusable technical pieces |

#### 3.2.1 Interpretation limits

It supports code-path verification, reveals large edge-case differences, and supplies regression fixtures. It **cannot** estimate population performance: the sample is tiny, author-selected, not meaning-aligned across languages, and visible during candidate design. It must never become the test set used to claim superiority. A held-out registered corpus is required.

#### 3.2.2 Reproducibility details

| Baseline | Revision |
| --- | --- |
| OpenAI | `js-tiktoken@1.0.21`, `o200k_base` ranks bundled by the package |
| Anthropic | `@anthropic-ai/tokenizer@0.0.4` |
| Gemma 4 | `023679ed352de9bb66cc873c9009ce3482585c08` |
| Kimi K2.6 | `81bcaaa7947338ce2641983d98947bca0cc1a4d4` |
| DeepSeek V3.2 | `c69397e` in the manifest; pinned asset revision file records the same prefix |
| Grok-1 conversion | `40ee9ae4aed428f623d105e0d85afbbb7985c4b6` |
| Llama 3.1 conversion | `72bff9ee09897a16b3b4b2b9995fecb0bfa7dbe6` |
| Mistral Small 4 | `233ef01d21386af67064b8f3a56d3f477ca52ce8` |
| Qwen3 | `b968826d9c46dd6066d109eabc6255188de91218` |

<details>
<summary>Exact diagnostic fixtures</summary>

The exact diagnostic strings were:

```text
English prose
1. A tokenizer should preserve meaning while using compute efficiently.
2. The quick brown fox jumps over the lazy dog; then it turns around.
3. We don't know whether fewer tokens will improve accuracy without training the model.

Code
4. const total = items.reduce((sum, item) => sum + item.price, 0);
5. def fibonacci(n: int) -> int:\n    return n if n < 2 else fibonacci(n-1) + fibonacci(n-2)
6. {"user_id":"usr_01J9X2","enabled":true,"tags":["alpha","βeta"]}

Numbers
7. 3.141592653589793 + 2,000,000 = 2,000,003.141592653589793
8. 2026-07-21T23:59:59-04:00 | $1,234.56 | 98.7% | 6.02214076e23
9. 12345678901234567890 × 98765432109876543210

CJK
10. 今天天气很好，我们一起去公园散步吧。
11. トークナイザーの公平性を慎重に評価します。
12. 토크나이저는 여러 언어에서 공정해야 합니다.

Complex scripts
13. يجب أن يعمل المُجزِّئ بكفاءة عبر اللغات المختلفة.
14. टोकनाइज़र को विभिन्न भाषाओं में समान रूप से काम करना चाहिए।
15. ตัวแบ่งโทเค็นควรทำงานได้ดีกับทุกภาษา

European morphology
16. Çekoslovakyalılaştıramadıklarımızdanmışsınız.
17. L’anticonstitutionnellement n’est pas un mot très fréquent.
18. ¿Cuántos tokens cuesta esta oración en español?

Emoji and symbols
19. 👩🏽‍💻🧑‍🚀👨‍👩‍👧‍👦 🇺🇳 ❤️‍🔥
20. α→β ∀x∈ℝ: x²≥0; ∑ᵢ₌₁ⁿ i = n(n+1)/2
21. ♞︎ ⚙️ © ™ ₹ € ¥ — … “quotes”

Whitespace (escape notation is literal documentation of control characters)
22. line one\r\n\tindented\n\nline four␠␠
23. a␠␠␠␠␠b\t\t\tc\n\n\n\nd
24. ␠leading and trailing␠

Unicode variants
25. é e◌́ Å A◌̊ Å ﬃ ＡＢＣ
26. раypal pаypal paypal<ZWSP>pay<ZWJ>pal
27. mañana man◌̃ana क़ क़्

Identifiers and URLs
28. https://api.example.com/v1/users?include=profile%2Cpermissions&limit=100
29. HTTPRequestHandler get_user_by_id snake_case kebab-case camelCase PascalCase
30. 550e8400-e29b-41d4-a716-446655440000 user@example.co.uk /usr/local/bin/node
```

In the executable fixture, combining marks are actual code points, `<ZWSP>` is U+200B, `<ZWJ>` is U+200D, and the visible `␠` markers above stand for literal spaces. The diagnostic did not test malformed UTF-8 or lone UTF-16 surrogates; those belong in the raw-byte conformance suite.

</details>

## 4. Literature synthesis

### 4.1 Compression is valuable, but it is not the objective

Shorter sequences usually reduce attention and per-token transformer work and fit more source text inside a fixed token window. Yet Schmidt et al. trained 64 models from 350M to 2.4B parameters and found that a tokenizer designed to minimize token count did not produce the best downstream performance. Their stronger conclusion is that pre-tokenization, vocabulary construction, and segmentation must be studied separately ([Tokenization Is More Than Compression](https://aclanthology.org/2024.emnlp-main.40/)).

Ali et al. trained 24 models at 2.6B parameters and found tokenizer choice affected downstream quality and training cost, while fertility and parity were not consistently predictive ([Tokenizer Choice for LLM Training](https://aclanthology.org/2024.findings-naacl.247/)). Cognetta et al. constructed tokenizers that arbitrarily improve Rényi efficiency while harming downstream performance, disproving its use as a sufficient oracle ([Two Counterexamples to Tokenization and the Noiseless Channel](https://aclanthology.org/2024.lrec-main.1469/)).

**Research implication:** use intrinsic metrics to reject obviously bad candidates, not to crown a winner. Final selection requires matched model training.

### 4.2 Unigram is the strongest low-risk algorithmic departure from the nine

BPE greedily adds frequent pairs and usually produces one canonical merge path. Unigram starts with a candidate vocabulary, assigns piece probabilities, uses dynamic programming to evaluate segmentations, and iteratively prunes pieces that least damage likelihood. That permits globally scored segmentation and natural subword sampling.

Kudo's original work found probabilistically sampled alternative segmentations improved low-resource and out-of-domain translation and introduced the Unigram LM tokenizer ([Subword Regularization](https://aclanthology.org/P18-1007/)). In controlled English and Japanese masked-LM experiments, Bostrom and Durrett found Unigram matched or outperformed BPE and aligned more closely with morphology ([BPE Is Suboptimal](https://aclanthology.org/2020.findings-emnlp.414/)). BPE-dropout independently showed that segmentation regularization can improve translation quality and robustness without changing the inference vocabulary ([BPE-Dropout](https://aclanthology.org/2020.acl-main.170/)).

The evidence does **not** prove Unigram always wins. Some later task- and language-specific studies favor BPE variants. The appropriate conclusion is to make algorithm and sampling an ablation, with Unigram as the lead candidate.

### 4.3 BPE remains useful for candidate discovery

The failure of shortest-path segmentation does not imply that frequent-substring discovery is useless. Schmidt et al. found benefits from BPE initialization. A practical hybrid can mine a generous BPE candidate pool, add byte and linguistically justified candidates, then let a Unigram objective select and score the final vocabulary. This is an inference from the combined evidence, not a directly established best recipe.

### 4.4 Multilingual corpus allocation is a first-class optimization problem

Rust et al. controlled training data and showed that specialized monolingual tokenizers improved nearly every tested language/task combination over a shared multilingual tokenizer when the shared vocabulary underrepresented that language ([How Good Is Your Tokenizer?](https://aclanthology.org/2021.acl-long.243/)). Ali et al. found that five-language European tokenizers needed roughly three times the vocabulary of English-only tokenizers in their setup and that English-centric tokenizers could add up to 68% training cost.

Pricing studies also document a user-facing token premium across languages ([Do All Languages Cost the Same?](https://aclanthology.org/2023.emnlp-main.614/); [Language Model Tokenizers Introduce Unfairness](https://arxiv.org/abs/2305.15425)). The 2026 parity-aware BPE study changes the optimizer itself: each merge prioritizes the worst-compressed language. It reports up to an 89% reduction in its token-cost Gini coefficient with negligible global compression change and no systematic downstream degradation in its experiments ([Parity-Aware BPE](https://aclanthology.org/2026.acl-long.342/)).

**Research implication:** test capped or temperature sampling **and** an explicit worst-group term. Balanced input alone cannot guarantee balanced vocabulary utility.

### 4.5 Vocabulary size must scale with the model and language coverage

A larger vocabulary shortens sequences but enlarges input embeddings and the output projection/softmax. Comparisons that give one tokenizer 262K embeddings and another 64K without charging those parameters or FLOPs are not causal.

Tao et al. trained 33M–3B parameter models on up to 500B characters and found compute-optimal vocabulary size increased with compute. Their predicted optimum for Llama-2 70B was at least 216K rather than 32K; in a reported fixed-FLOP 3B experiment, raising vocabulary from 32K to 43K improved ARC-Challenge from 29.1 to 32.0 ([Scaling Laws with Vocabulary](https://arxiv.org/abs/2407.13623)). This result is strong motivation for a sweep, not proof that 216K is right for this project's data and architecture.

**Research implication:** begin with a 128K/192K/256K sweep. Match either total parameters and FLOPs or report two experiments: fixed transformer trunk and fixed total model budget. Consider tied embeddings and factorized/adaptive output layers, but count their runtime honestly.

### 4.6 Morphology matters most where raw frequency is weakest

Frequency-only merges can split related word forms inconsistently, especially in agglutinative and morphologically rich languages. Morphology-aware metrics do not universally predict general downstream quality, but recent controlled experiments show meaningful gains in relevant languages and tasks. MorphBPE constrained merges at morpheme boundaries and reported lower LM cross-entropy plus reading-comprehension gains for Russian and Arabic without materially shorter sequences ([MorphBPE](https://aclanthology.org/2026.findings-acl.2068/)).

Hard-coded language analyzers for every input would create brittle operational complexity. A safer first design is soft: include morpheme-boundary quality in candidate evaluation for languages with reliable resources, audit consistency, and let bytes guarantee fallback. Cluster- or script-aware vocabulary allocation can prevent one analyzer's conventions from controlling the whole system.

### 4.7 Normalization trades compression for fidelity and security

NFC and NFKC can reduce redundant forms, but compatibility normalization can change meaning-bearing typography, identifiers, source code, and forensic evidence. The repo confirms the issue: Qwen3 changed two Unicode fixtures through NFC; Anthropic's legacy path normalizes with NFKC before encoding. Invisible characters, homoglyphs, and unusual Unicode can also degrade NLP systems and safeguards ([Bad Characters](https://arxiv.org/abs/2106.09898)).

**Research implication:** ordinary tokenization should be tested with byte-lossless identity normalization as the lead condition. If canonicalization helps a model, provide the original byte stream plus a reversible canonical feature or augmentation, or normalize only in a clearly separate API whose lossy behavior is explicit. Never let normalization collapse ordinary input into a privileged control symbol.

### 4.8 Alternative segmentations are also a safety issue

Geh et al. show that semantically equivalent alternative tokenizations can be used as an adversarial axis against aligned LLMs ([Adversarial Tokenization](https://aclanthology.org/2025.acl-long.1012/)). Regularized segmentation during pretraining may reduce dependence on one arbitrary split, but this safety benefit is a hypothesis until tested on the complete post-training stack.

**Research implication:** test sampled valid segmentations, include adversarial alternative-tokenization tests, and run safety tuning and evaluation with the same segmentation distribution. Keep deterministic public inference unless a controlled ensemble is proven safe and affordable.

### 4.9 Token-free models are now credible, but not a drop-in answer

Byte models remove unknown tokens and fixed-vocabulary lock-in, but raw byte sequences are long. CANINE uses downsampling and outperformed comparable mBERT on TyDi QA with fewer parameters in its encoder setting ([CANINE](https://arxiv.org/abs/2103.06874)). ByT5 reported stronger noise robustness and spelling-sensitive performance ([ByT5](https://arxiv.org/abs/2105.13626)). Charformer learns latent byte blocks end to end ([Charformer](https://arxiv.org/abs/2106.12672)); MEGABYTE uses local and global patch models ([MEGABYTE](https://arxiv.org/abs/2305.07185)); MambaByte uses a state-space model plus speculative decoding ([MambaByte](https://arxiv.org/abs/2401.13660)).

BLT is the most relevant scaled evidence: it dynamically forms patches at high next-byte entropy and reports FLOP-controlled experiments up to 8B parameters and 4T training bytes, matching tokenized models while improving scaling, inference efficiency, robustness, and long-tail generalization in its setup ([Byte Latent Transformer](https://arxiv.org/abs/2412.09871)).

**Research implication:** run the fixed-vocabulary candidate first for compatibility. Maintain BLT-style dynamic patches as a separate architecture track only if changing the model is in scope.

### 4.10 Runtime quality is part of tokenizer quality

Tokenizer speed can bottleneck high-throughput serving. Song et al. gave WordPiece a strict linear-time implementation and reported large speedups over the libraries tested ([Fast WordPiece Tokenization](https://aclanthology.org/2021.emnlp-main.160/)). This does not make WordPiece the preferred segmentation model; it shows implementation and abstract tokenizer quality must be measured separately.

**Research implication:** build a reference implementation first, freeze semantics with conformance vectors, then optimize using tries or automata, batched native code, and streaming state. Any faster implementation must return identical IDs and offsets.

## 5. Proposed tokenizer hypothesis

This section defines the candidate to test. It is a synthesis-driven proposal, not an observed result.

### 5.1 Input contract

- Canonical input is a byte string. UTF-8 text APIs reject or explicitly replace invalid scalar sequences before tokenization; a raw-byte API accepts arbitrary bytes.
- Token IDs `0..255` represent literal bytes or an equivalent reserved byte alphabet.
- `decode(encode(x)) == x` for every accepted ordinary input.
- The encoder returns token ID, byte start, byte end, and whether the piece was vocabulary- or byte-backed.
- Empty input encodes to an empty ordinary sequence. BOS/EOS are caller policy, not implicit text tokens.

### 5.2 Control-token contract

- Reserve a disjoint ID range for BOS, EOS, roles, tool delimiters, padding, and future protocol markers.
- The text encoder escapes or treats their printable spellings as ordinary bytes.
- Only a typed API such as `encodeSegments([{type: "control", id: ...}, {type: "text", bytes: ...}])` can create control semantics.
- Publish test vectors for literal strings that resemble every control token.
- Version chat templates separately from the base tokenizer.

### 5.3 Training mixture

Create a manifest with licenses, provenance, collection date, language/script, domain, quality filters, deduplication policy, and exclusion rationale. The tokenizer corpus should be sampled from the intended **model** corpus but not merely mirror its raw counts.

Required strata include:

- language families and scripts, including no-space scripts and combining-mark-heavy orthographies;
- code languages, markup, JSON/YAML/CSV, shell, SQL, regular expressions, and diffs;
- mathematics, scientific notation, dates, times, currencies, units, and tables;
- URLs, paths, email-like strings, UUIDs, hashes, identifiers, and logs;
- emoji sequences, variation selectors, zero-width joiners, symbols, and bidirectional text;
- conversational text, formal prose, short UI strings, and noisy/OCR/social text.

Use document-level deduplication before sampling. Cap any single source. Sample language/domain groups with a temperature or square-root schedule, then tune weights against held-out worst-group compression and proxy-model loss. Keep the evaluation split source-disjoint and hidden from tokenizer training.

### 5.4 Candidate vocabulary generation

1. Insert the required byte/control pieces.
2. Mine substrings in each language/domain stratum independently with BPE or suffix-array counts.
3. Retain candidates that pass minimum document frequency—not only occurrence frequency—to resist boilerplate and memorized secrets.
4. Merge candidate pools with per-stratum quotas and a global pool.
5. Remove pieces containing sensitive strings, malformed protocol markers, excessive whitespace-only runs, or source-specific identifiers unless a documented domain benefit justifies them.
6. Add optional morphology-respecting candidates where annotations are reliable; do not remove the byte fallback.
7. Score candidates with a Unigram model and iterative pruning under the parity-aware objective below.

### 5.5 Multi-objective vocabulary optimization

For candidate vocabulary (V), define held-out groups (g \in G):

- (L_g(V)): mean encoded tokens per original byte or aligned semantic unit;
- (P_g(V)): proxy-model bits per byte;
- (U_g(V)): effective vocabulary utilization penalty;
- (M_g(V)): morphological inconsistency where annotations exist;
- (C(V)): embedding/softmax parameters and measured compute.

A useful research objective is:

\[
J(V) = \alpha \sum_g w_g P_g(V)
+ \beta \max_g \frac{L_g(V)}{L_g(V_{ref})}
+ \gamma\,Gini(\{L_g(V)\})
+ \delta \sum_g w_g U_g(V)
+ \epsilon \sum_g w_g M_g(V)
+ \zeta C(V)
\]

The actual coefficients must be preregistered or selected on a development split, never on the final test. Because proxy-model loss is expensive, train first with compression/utilization surrogates, then use successive halving: only the strongest candidates receive model training.

### 5.6 Pre-tokenization ablations

Do not copy one competitor's regex unchanged. Test at least:

- no hard boundaries beyond optional control separation;
- Unicode-script and whitespace boundaries;
- an `o200k_base`-style case/contraction regex;
- identifier-aware boundaries for snake, camel, and digit transitions;
- phrase/superword candidates that may cross ordinary word boundaries.

Measure both quality and runtime. Hard boundaries speed training and avoid pathological phrase tokens, but they also make some useful pieces impossible.

### 5.7 Number policy ablations

The repository exposes three live choices: unlimited digit runs (legacy Anthropic), groups of 1–3 digits (OpenAI/Kimi/DeepSeek/Llama), and single digits (Mistral/Qwen, plus Gemma's observed behavior). Test:

- single digits;
- fixed triplets aligned from the left and from the right;
- unrestricted Unigram pieces with a maximum length;
- typed numeric side features while preserving textual bytes.

Evaluate copying, comparison, addition, multiplication, scientific notation, decimals, locale-specific separators, dates, IDs, and unseen digit lengths. Token compactness is secondary to extrapolation and correctness.

### 5.8 Training-time segmentation

- Inference: deterministic Viterbi minimum negative log-probability with a stable tie-breaker.
- Pretraining: sample from the n-best lattice or apply controlled piece dropout.
- Record the random seed and sampling temperature.
- Anneal or tune the sampling rate; too much fragmentation increases training cost.
- Run an ablation with deterministic-only training to establish whether regularization earns its cost.

## 6. Preregistered evaluation protocol

### 6.1 Phase A: intrinsic screening

Evaluate the candidate and all nine pinned artifacts on a held-out, source-disjoint corpus. Report every metric by language, script, domain, and content-length decile; macro-average groups rather than letting English web volume dominate.

| Dimension | Metric | Why it is needed |
| --- | --- | --- |
| Correctness | byte round-trip rate; unknown rate; offset accuracy | non-negotiable encoding contract |
| Compression | bytes/token; tokens/Unicode scalar; tokens/aligned segment | separates storage units from script-specific word segmentation |
| Equity | max/min cost ratio; worst-language premium; Gini | averages hide under-served groups |
| Context | original bytes and aligned semantic units before truncation | direct user consequence of fragmentation |
| Vocabulary | type utilization; token-frequency entropy; tail types below count thresholds | detects wasted embeddings and under-trained rows |
| Morphology | boundary precision/recall/F1; consistency | diagnostic for morphologically rich languages |
| Stability | token edit distance per one-byte/one-grapheme edit | measures brittle retokenization cascades |
| Unicode | NFC/NFD/NFKC sensitivity; homoglyph and invisible-character behavior | fidelity and security |
| Runtime | MB/s, strings/s, p50/p95 latency, memory, artifact/startup size | deployment cost |

For parallel corpora, compare meaning-aligned segments. Words are not a universal normalization unit, so always report byte- and segment-based results alongside fertility.

### 6.2 Phase B: matched proxy-model experiment

Train the same decoder-only architecture and data in separate conditions:

- the proposed tokenizer;
- each of the nine pinned tokenizers as shipped;
- retrained BPE and Unigram controls at matched vocabulary sizes;
- ablations for parity objective, segmentation sampling, pre-tokenizer, normalization, number policy, and morphology term.

Use at least three seeds for finalists. Hold model architecture, optimizer, batch definition, sequence packing, data order, and raw training bytes constant where possible. Because tokenizers change token counts, publish **two** controlled views:

1. **Fixed raw bytes and total training FLOPs:** measures end-to-end compute efficiency.
2. **Fixed token count and architecture:** diagnoses what the model learns per token, while acknowledging unequal raw-data exposure.

Token-level perplexity is not comparable across tokenizers. Primary validation loss is bits per original byte:

\[
BPB = -\frac{1}{N_{bytes}}\sum_i \log_2 p(t_i \mid t_{<i})
\]

Also report total parameters, embedding parameters, output-layer parameters, achieved FLOPs, wall-clock time, hardware, utilization, and original bytes seen.

### 6.3 Phase C: downstream and stress evaluation

Predeclare task families rather than selecting benchmarks after results:

- multilingual knowledge and reading comprehension across represented and unseen languages;
- translation or cross-lingual transfer;
- code completion, repository-level infilling, syntax validity, and identifier copying;
- spelling, transliteration, OCR noise, typos, casing, and dialect/orthographic variation;
- numerical retrieval, comparison, arithmetic, units, dates, and tables;
- long-context retrieval measured by original bytes and semantic units, not token position alone;
- emoji, grapheme manipulation, rhyme/phonology, and character-counting tasks;
- safety tests involving homoglyphs, invisible characters, alternate valid tokenizations, and control-marker lookalikes.

Report task-specific metrics and a macro-average per family. Do not let many similar English benchmarks outvote a small number of critical multilingual or safety tests.

### 6.4 Statistical plan

- Make the document or aligned segment the paired unit for intrinsic comparisons.
- Use stratified bootstrap confidence intervals across documents, preserving language/domain strata.
- For model results, report seed-level values, mean differences, confidence intervals, and effect sizes.
- Use hierarchical or mixed-effects models for language/task variation when assumptions are checked.
- Correct confirmatory multiple comparisons, for example with Holm's procedure.
- Define non-inferiority margins before seeing test results.
- Test interactions: tokenizer × language, tokenizer × domain, tokenizer × model size.
- Publish all planned conditions, failures, and stopped runs. A missing unstable condition is a result, not permission to omit it.

### 6.5 Stage gates and stopping rules

1. **Gate 0 — contract:** reject any candidate with a round-trip, unknown-token, offset, determinism, or special-token isolation failure.
2. **Gate 1 — intrinsic:** advance only candidates not dominated on held-out compression, parity, utilization, stability, and runtime. A candidate can survive a small average compression loss only if it materially improves a predeclared critical slice.
3. **Gate 2 — small LM:** stop any candidate whose compute-normalized BPB is worse than strong BPE and Unigram controls across two independent seeds.
4. **Gate 3 — medium LM:** require the full primary endpoint set against all nine. Confirm that rankings are stable across scale.
5. **Gate 4 — release:** require conformance tests in every supported runtime, red-team special tokens and Unicode, freeze artifact checksums, and publish a model/tokenizer compatibility matrix.

## 7. Experimental matrix

Use successive halving rather than training every combination at scale.

### 7.1 Round 1: tokenizer-only search

- algorithms: BPE, Unigram, BPE-seeded Unigram;
- vocabulary: 128K, 192K, 256K;
- allocation: corpus-frequency, temperature-balanced, parity-aware;
- pre-tokenization: none/minimal, script-aware, `o200k`-like, identifier-aware;
- number policy: digit, triplet, unrestricted;
- normalization: identity only for final candidates; NFC/NFKC retained as diagnostic controls;
- sampling: deterministic, low, medium.

This full factorial is too large. Use fractional-factorial coverage followed by Bayesian optimization or successive halving on the development set. Preserve enough orthogonal controls to estimate main effects and key interactions.

### 7.2 Round 2: 100M–300M proxy models

Advance approximately 4–6 candidate configurations plus BPE, Unigram, and the strongest shipped baseline. Train matched models on enough raw bytes for stable validation ranking. Lotz et al. provide evidence that smaller models can predict meaningful tokenizer differences at larger scales, especially for multilingual settings ([Beyond Text Compression](https://aclanthology.org/2025.acl-long.1546/)); verify that ranking in this corpus rather than assuming transfer.

### 7.3 Round 3: medium-scale confirmation

Train the proposed winner and 2–3 strongest controls at the largest affordable scale with at least three seeds for the decisive comparison. If the rank reverses, do not average the scales; analyze the interaction and revise the vocabulary/model-size choice.

## 8. Threats to validity and failure modes

- **Benchmark memorization:** vocabulary contains held-out benchmark phrases because source deduplication failed.
- **Compression gaming:** long boilerplate, URLs, or entire phrases become tokens and win average counts while wasting embeddings.
- **English masking:** micro-averages hide 5–20× premiums in a smaller language.
- **Vocabulary under-training:** many attractive long pieces receive too few gradient updates.
- **Normalization loss:** identifiers, code, diacritics, or forensic text cannot be reconstructed.
- **Special-token collision:** user text gains protocol semantics.
- **Retokenization cascade:** a one-character edit changes most later tokens, damaging caching and robustness.
- **Unfair model budget:** a large vocabulary wins sequence length but quietly receives more parameters/FLOPs.
- **Perplexity misuse:** token-level perplexities are compared despite different sample spaces.
- **Tokenizer/model mismatch:** an existing model is evaluated with a replacement tokenizer without retraining or principled embedding transfer.
- **Proxy overclaim:** a legacy/open tokenizer is described as the current private tokenizer for a lab.
- **Runtime regression:** a theoretically better lattice tokenizer is too slow or memory-heavy in production.
- **Secret leakage:** emails, API keys, UUIDs, or copyrighted boilerplate become memorable single tokens due to raw frequency.
- **Post-hoc scoring:** weights or benchmark subsets change after the favored candidate loses.

## 9. Recommended research sequence

1. **Freeze the evaluation contract.** Define target model, languages, domains, hardware budget, task families, minimum slices, non-inferiority margins, and final claim wording.
2. **Build the evaluator before the tokenizer.** Add corpus manifests, parallel-text grouping, exact offsets, Unicode/byte fixtures, per-group metrics, bootstrap intervals, and artifact checksums.
3. **Train simple controls.** Reproduce byte-fallback BPE and Unigram at 128K/192K/256K on the exact mixture. If controls are not reproducible, a complex optimizer will not be interpretable.
4. **Add one innovation at a time.** BPE-seeded candidates, parity objective, then segmentation sampling; keep pre-tokenization and number policies as explicit ablations.
5. **Run proxy models and prune aggressively.** Intrinsic winners that do not improve BPB or downstream critical slices stop here.
6. **Confirm at scale and publish negative results.** Only then name or market the tokenizer as superior.

## 10. Confidence and unresolved questions

### 10.1 High confidence

- A raw token-count leaderboard is insufficient to select a tokenizer.
- Lossless byte fallback, zero unknowns, explicit offsets, and isolated control tokens are sound engineering requirements.
- Multilingual and domain allocation materially affect both cost and downstream performance.
- Vocabulary size must be selected jointly with model scale and charged to the parameter/compute budget.
- Token-level perplexity cannot be compared directly across different tokenizations.

### 10.2 Moderate confidence

- BPE-seeded, parity-aware Unigram with segmentation regularization is the best fixed-vocabulary research direction for this comparison set. Each component has supporting evidence, but the exact combination has not been established by a single controlled study.
- Small proxy models can eliminate weak candidates before expensive scaling; rank stability must still be checked.
- Identity normalization plus training augmentation will preserve fidelity without sacrificing most robustness gains; this needs direct testing.

### 10.3 Unresolved questions

- The best vocabulary size for the intended full model and corpus.
- Whether digit, triplet, or learned number pieces give the best compute-normalized numeracy.
- How much morphology-aware structure helps general-purpose decoder LMs versus task-specific encoders.
- Whether a fixed tokenizer can ultimately beat dynamic byte patches once architecture changes are allowed.
- The current private Claude, Gemini, and Grok tokenization internals; provider counts do not reveal their training recipes.
- The exact final language/domain mix. Changing it can change the optimal tokenizer.

## 11. Method and provenance

This is a **rapid evidence review**, not a systematic review. It prioritized primary papers, ACL Anthology records, arXiv manuscripts for architecture work, official tokenizer repositories, and the pinned local artifacts. Searches were run on 2026-07-21 for tokenizer downstream performance, multilingual fairness, vocabulary scaling, BPE versus Unigram, subword regularization, morphology, robustness, byte/patch models, and runtime algorithms. Backward/forward concept chaining was used around the controlled 2020–2026 tokenizer studies. Vendor blog comparisons and unsourced leaderboard claims were excluded from the scientific synthesis.

The local audit read:

- `lib/tokenizers/manifest.ts` and `lib/tokenizers/types.ts`;
- `workers/openai.worker.ts` and `workers/tokenizer.worker.ts`;
- every checked-in `tokenizer.json`, `tokenizer_config.json`, and `revision.json`;
- the Anthropic legacy `claude.json` ranks.

The 30-case diagnostic used `js-tiktoken` and `@huggingface/transformers` from the repository lockfile, disabled remote model loading, added no special tokens, and used the exact pinned asset directories. It is a convenience sample and is separated from the literature findings and proposed confirmatory experiment.

## 12. Source ledger

| ID | Source | Evidence role | Important limitation |
| --- | --- | --- | --- |
| S1 | [Sennrich et al. 2016, BPE for rare words](https://aclanthology.org/P16-1162/) | foundational subword BPE evidence | neural machine translation, not modern decoder LMs |
| S2 | [Kudo 2018, Subword Regularization](https://aclanthology.org/P18-1007/) | Unigram LM and sampled segmentation | translation settings |
| S3 | [Kudo & Richardson 2018, SentencePiece](https://aclanthology.org/D18-2012/) | raw-text Unigram/BPE implementation | system paper, not universal performance proof |
| S4 | [Bostrom & Durrett 2020](https://aclanthology.org/2020.findings-emnlp.414/) | controlled Unigram vs BPE LM evidence | English/Japanese masked LMs |
| S5 | [Provilkov et al. 2020](https://aclanthology.org/2020.acl-main.170/) | BPE-dropout robustness/quality | translation; reported maximum gains are setup-specific |
| S6 | [Rust et al. 2021](https://aclanthology.org/2021.acl-long.243/) | controlled vocabulary coverage and monolingual performance | encoder models and nine languages |
| S7 | [Song et al. 2021](https://aclanthology.org/2021.emnlp-main.160/) | linear-time tokenizer implementation | WordPiece runtime, not segmentation quality |
| S8 | [Ahia et al. 2023](https://aclanthology.org/2023.emnlp-main.614/) | commercial multilingual token-cost disparity | provider/model snapshot from 2023 |
| S9 | [Petrov et al. 2023](https://arxiv.org/abs/2305.15425) | cross-language encoding inequality | intrinsic length does not prove causal downstream effect |
| S10 | [Ali et al. 2024](https://aclanthology.org/2024.findings-naacl.247/) | 24 controlled 2.6B tokenizer ablations | five frequent European languages in key multilingual study |
| S11 | [Schmidt et al. 2024](https://aclanthology.org/2024.emnlp-main.40/) | disproves minimum token count as sufficient | specific architectures/data and candidate designs |
| S12 | [Cognetta et al. 2024](https://aclanthology.org/2024.lrec-main.1469/) | counterexamples to single intrinsic metric | constructive counterexamples, not a replacement metric |
| S13 | [Tao et al. 2024](https://arxiv.org/abs/2407.13623) | vocabulary/model scaling evidence | arXiv; extrapolated optima depend on fitted regime |
| S14 | [Chai et al. 2024](https://aclanthology.org/2024.findings-emnlp.86/) | typo and formatting brittleness | evaluated existing LLMs, with training-data confounds |
| S15 | [Lotz et al. 2025](https://aclanthology.org/2025.acl-long.1546/) | multi-metric evaluation and proxy-scale consistency | English effects often negligible; transfer must be verified |
| S16 | [Geh et al. 2025](https://aclanthology.org/2025.acl-long.1012/) | adversarial alternate-tokenization risk | three evaluated models; mitigations need separate evidence |
| S17 | [Foroutan et al. 2026](https://aclanthology.org/2026.acl-long.342/) | parity-aware merge objective | BPE-specific experiments; “up to” result is not universal |
| S18 | [Chiu 2026, TokLens](https://aclanthology.org/2026.acl-srw.18/) | multilingual metrics and correlation | correlational and partly confounded by training composition |
| S19 | [Asgari et al. 2026, MorphBPE](https://aclanthology.org/2026.findings-acl.2068/) | morphology-aware controlled decoder experiments | four languages and selected tasks |
| S20 | [Xue et al. 2021, ByT5](https://arxiv.org/abs/2105.13626) | byte-level robustness | encoder-decoder architecture |
| S21 | [Clark et al. 2021, CANINE](https://arxiv.org/abs/2103.06874) | token-free character encoder | not autoregressive decoder evidence |
| S22 | [Tay et al. 2021, Charformer](https://arxiv.org/abs/2106.12672) | learned latent byte blocks | architecture-specific results |
| S23 | [Yu et al. 2023, MEGABYTE](https://arxiv.org/abs/2305.07185) | multiscale byte patches | broad modalities; not a drop-in tokenizer |
| S24 | [Wang et al. 2024, MambaByte](https://arxiv.org/abs/2401.13660) | token-free state-space decoder | architecture and speculative-decoding assumptions |
| S25 | [Pagnoni et al. 2024, BLT](https://arxiv.org/abs/2412.09871) | scaled dynamic-byte-patch evidence | changes the model architecture; arXiv manuscript |
| S26 | [Boucher et al. 2021, Bad Characters](https://arxiv.org/abs/2106.09898) | Unicode attack surface | broader NLP security, not tokenizer-only causality |

## 13. Conclusion and next review

Build the evaluator first, then test a **128K/192K/256K BPE-seeded, parity-aware Unigram family with byte fallback and sampled training segmentations**. Preserve raw bytes, separate control tokens from text, and treat normalization, regex boundaries, morphology, and number grouping as ablations. Use intrinsic metrics only for screening. The claim that it beats OpenAI, Anthropic, Google, Moonshot, DeepSeek, xAI, Meta, Mistral, and Qwen becomes scientifically supportable only after the matched-model, fixed-compute, multilingual, downstream, robustness, and statistical gates above all pass.

**Refresh triggers:** a tokenizer revision changes in `public/tokenizers`; Kimi K3 or another currently private tokenizer becomes reproducible; new controlled studies reverse the algorithm/vocabulary conclusions; the target model size or training mixture changes; or a byte/patch architecture becomes the actual product direction.
