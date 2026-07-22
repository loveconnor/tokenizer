#!/usr/bin/env python3
"""Compare Connor's Tokenizer artifacts on deterministic slices of every locked corpus group."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Mapping

if __package__:
    from scripts.benchmark_atlas_tokenizers import ArtifactTokenizer, sha256_file
    from scripts.train_atlas_tokenizer import iter_group_documents, load_verified_groups
else:
    from benchmark_atlas_tokenizers import ArtifactTokenizer, sha256_file
    from train_atlas_tokenizer import iter_group_documents, load_verified_groups


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "scripts" / "tokenizer-corpus.lock.json"
DEFAULT_BASELINE = ROOT / "public" / "tokenizers" / "atlas-unigram-v2" / "tokenizer.json"
DEFAULT_CANDIDATE = ROOT / "public" / "tokenizers" / "atlas-unigram-v3" / "tokenizer.json"
DEFAULT_REPORT = ROOT / "docs" / "atlas-v3-corpus-benchmark.md"
DEFAULT_BYTE_LIMIT = 250_000


def evaluate_group(
    baseline: ArtifactTokenizer,
    candidate: ArtifactTokenizer,
    path: Path,
    byte_limit: int,
) -> Dict[str, int | float]:
    utf8_bytes = 0
    documents = 0
    baseline_tokens = 0
    candidate_tokens = 0
    for text, _ in iter_group_documents(path):
        payload_size = len(text.encode("utf-8"))
        if documents and utf8_bytes + payload_size > byte_limit:
            break
        baseline_tokens += baseline.count(text)
        candidate_tokens += candidate.count(text)
        utf8_bytes += payload_size
        documents += 1
        if utf8_bytes >= byte_limit:
            break
    if not documents:
        raise ValueError("Corpus group has no benchmark documents: {}".format(path))
    return {
        "documents": documents,
        "utf8Bytes": utf8_bytes,
        "baselineTokens": baseline_tokens,
        "candidateTokens": candidate_tokens,
        "ratio": candidate_tokens / baseline_tokens,
    }


def render_report(
    baseline: ArtifactTokenizer,
    candidate: ArtifactTokenizer,
    results: Mapping[str, Mapping[str, int | float]],
    byte_limit: int,
) -> str:
    baseline_total = sum(int(values["baselineTokens"]) for values in results.values())
    candidate_total = sum(int(values["candidateTokens"]) for values in results.values())
    byte_total = sum(int(values["utf8Bytes"]) for values in results.values())
    lines = [
        "# {} → {} locked-corpus audit".format(baseline.tokenizer_id, candidate.tokenizer_id),
        "",
        "This deterministic audit measures up to {:,} UTF-8 bytes from each locked production-corpus group. The same corpus informed training and prose-piece selection, so these are in-sample engineering measurements, not independent generalization evidence.".format(byte_limit),
        "",
        "- Baseline SHA-256: `{}`".format(sha256_file(baseline.path)),
        "- Candidate SHA-256: `{}`".format(sha256_file(candidate.path)),
        "- Measured UTF-8 bytes: `{:,}`".format(byte_total),
        "- Overall token ratio: `{:.4f}` ({:+.2f}%)".format(
            candidate_total / baseline_total, (candidate_total / baseline_total - 1) * 100
        ),
        "",
        "| Group | Documents | UTF-8 bytes | Baseline | Candidate | Change |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for group, values in sorted(results.items()):
        lines.append(
            "| {} | {} | {} | {} | {} | {:+.2f}% |".format(
                group,
                int(values["documents"]),
                int(values["utf8Bytes"]),
                int(values["baselineTokens"]),
                int(values["candidateTokens"]),
                (float(values["ratio"]) - 1) * 100,
            )
        )
    lines.extend(["", "Every measured corpus group passed the no-regression gate.", ""])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-lock", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--candidate", type=Path, default=DEFAULT_CANDIDATE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--byte-limit", type=int, default=DEFAULT_BYTE_LIMIT)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    if arguments.byte_limit < 1_000:
        raise ValueError("Byte limit must be at least 1,000")
    groups, _ = load_verified_groups(arguments.corpus_lock.resolve())
    baseline_tokenizer = ArtifactTokenizer(arguments.baseline.resolve())
    candidate_tokenizer = ArtifactTokenizer(arguments.candidate.resolve())
    group_results = {
        group: evaluate_group(
            baseline_tokenizer,
            candidate_tokenizer,
            path,
            arguments.byte_limit,
        )
        for group, path in sorted(groups.items())
    }
    regressions = [
        group for group, values in group_results.items() if float(values["ratio"]) > 1.0
    ]
    if regressions:
        raise AssertionError("Locked-corpus groups regressed: {}".format(", ".join(regressions)))
    report = render_report(
        baseline_tokenizer, candidate_tokenizer, group_results, arguments.byte_limit
    )
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(report, encoding="utf-8")
    print(report)
