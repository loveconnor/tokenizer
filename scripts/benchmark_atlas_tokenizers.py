#!/usr/bin/env python3
"""Compare Connor's Tokenizer artifacts on the checked-in improvement regression suite."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Mapping, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASELINE = ROOT / "public" / "tokenizers" / "atlas-unigram-v2" / "tokenizer.json"
DEFAULT_CANDIDATE = ROOT / "public" / "tokenizers" / "atlas-unigram-v3" / "tokenizer.json"
DEFAULT_CASES = ROOT / "scripts" / "atlas-benchmark-cases.json"
DEFAULT_REPORT = ROOT / "docs" / "atlas-v3-benchmark.md"
GATE_PROFILES = {
    "v1-to-v2": {
        "categories": {
            "prose": 0.95,
            "emoji_url": 0.75,
            "url": 0.95,
            "code": 1.00,
            "multilingual": 1.00,
            "boundary": 1.15,
        },
        "overall": 0.90,
        "perCase": 1.15,
    },
    "v2-to-v3": {
        "categories": {
            "prose": 0.90,
            "emoji_url": 1.00,
            "url": 1.00,
            "code": 1.00,
            "multilingual": 1.00,
            "boundary": 1.00,
        },
        "overall": 0.96,
        "perCase": 1.00,
    },
}


class ArtifactTokenizer:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.artifact = json.loads(path.read_text(encoding="utf-8"))
        self.tokenizer_id = str(self.artifact["tokenizerId"])
        self.max_piece_bytes = int(self.artifact["limits"]["maxPieceBytes"])
        self.root: Dict[object, object] = {}
        for piece in self.artifact["vocabulary"]:
            payload = base64.b64decode(piece["bytes"], validate=True)
            node = self.root
            for value in payload:
                child = node.get(value)
                if not isinstance(child, dict):
                    child = {}
                    node[value] = child
                node = child
            node[None] = (int(piece["id"]), float(piece["score"]))

    def count(self, text: str) -> int:
        payload = text.encode("utf-8")
        scores = [-math.inf] * (len(payload) + 1)
        token_counts = [2**31 - 1] * (len(payload) + 1)
        scores[0] = 0.0
        token_counts[0] = 0
        for start in range(len(payload)):
            if not math.isfinite(scores[start]):
                continue
            node = self.root
            for end in range(start, min(len(payload), start + self.max_piece_bytes)):
                child = node.get(payload[end])
                if not isinstance(child, dict):
                    break
                node = child
                terminal = node.get(None)
                if not isinstance(terminal, tuple):
                    continue
                token_id, piece_score = terminal
                candidate_score = scores[start] + piece_score
                candidate_count = token_counts[start] + 1
                score_difference = candidate_score - scores[end + 1]
                if score_difference > 1e-12 or (
                    abs(score_difference) <= 1e-12 and candidate_count < token_counts[end + 1]
                ):
                    scores[end + 1] = candidate_score
                    token_counts[end + 1] = candidate_count
        if not math.isfinite(scores[-1]):
            raise ValueError("Artifact cannot encode benchmark case")
        return token_counts[-1]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(
    baseline: ArtifactTokenizer,
    candidate: ArtifactTokenizer,
    cases: Sequence[Mapping[str, str]],
) -> Tuple[List[Dict[str, object]], Dict[str, Dict[str, float]], float]:
    results = []
    category_counts: Dict[str, List[int]] = defaultdict(lambda: [0, 0])
    for case in cases:
        baseline_count = baseline.count(case["text"])
        candidate_count = candidate.count(case["text"])
        ratio = candidate_count / baseline_count
        results.append(
            {
                "name": case["name"],
                "category": case["category"],
                "baseline": baseline_count,
                "candidate": candidate_count,
                "ratio": ratio,
            }
        )
        category_counts[case["category"]][0] += baseline_count
        category_counts[case["category"]][1] += candidate_count
    categories = {
        category: {
            "baseline": values[0],
            "candidate": values[1],
            "ratio": values[1] / values[0],
        }
        for category, values in sorted(category_counts.items())
    }
    baseline_total = sum(result["baseline"] for result in results)
    candidate_total = sum(result["candidate"] for result in results)
    return results, categories, candidate_total / baseline_total


def assert_gates(
    results: Sequence[Mapping[str, object]],
    categories: Mapping[str, Mapping[str, float]],
    overall_ratio: float,
    profile: Mapping[str, object],
) -> None:
    failures = []
    category_gates = profile["categories"]
    assert isinstance(category_gates, dict)
    for category, maximum_ratio in category_gates.items():
        actual_ratio = categories[category]["ratio"]
        if actual_ratio > maximum_ratio:
            failures.append("{} ratio {:.3f} exceeds {:.3f}".format(category, actual_ratio, maximum_ratio))
    overall_max_ratio = float(profile["overall"])
    per_case_max_ratio = float(profile["perCase"])
    if overall_ratio > overall_max_ratio:
        failures.append("overall ratio {:.3f} exceeds {:.3f}".format(overall_ratio, overall_max_ratio))
    for result in results:
        if result["ratio"] > per_case_max_ratio:
            failures.append("{} ratio {:.3f} exceeds {:.3f}".format(
                result["name"], result["ratio"], per_case_max_ratio
            ))
    if failures:
        raise AssertionError("; ".join(failures))


def render_report(
    baseline: ArtifactTokenizer,
    candidate: ArtifactTokenizer,
    results: Sequence[Mapping[str, object]],
    categories: Mapping[str, Mapping[str, float]],
    overall_ratio: float,
    profile: Mapping[str, object],
) -> str:
    category_gates = profile["categories"]
    assert isinstance(category_gates, dict)
    lines = [
        "# {} → {} regression report".format(baseline.tokenizer_id, candidate.tokenizer_id),
        "",
        "This is a targeted, checked-in regression suite for known tokenizer risks. It is not an independent or representative language-model benchmark.",
        "",
        "- Baseline SHA-256: `{}`".format(sha256_file(baseline.path)),
        "- Candidate SHA-256: `{}`".format(sha256_file(candidate.path)),
        "- Overall token ratio: `{:.3f}` ({:+.1f}%)".format(overall_ratio, (overall_ratio - 1) * 100),
        "",
        "## Category totals",
        "",
        "| Category | Baseline | Candidate | Change | Gate |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for category, metrics in categories.items():
        lines.append(
            "| {} | {} | {} | {:+.1f}% | ≤ {:.0f}% |".format(
                category,
                int(metrics["baseline"]),
                int(metrics["candidate"]),
                (metrics["ratio"] - 1) * 100,
                float(category_gates[category]) * 100,
            )
        )
    lines.extend(
        [
            "",
            "## Cases",
            "",
            "| Case | Category | Baseline | Candidate | Change |",
            "| --- | --- | ---: | ---: | ---: |",
        ]
    )
    for result in results:
        lines.append(
            "| {} | {} | {} | {} | {:+.1f}% |".format(
                result["name"],
                result["category"],
                result["baseline"],
                result["candidate"],
                (result["ratio"] - 1) * 100,
            )
        )
    lines.extend(["", "All configured category, overall, and per-case regression gates passed.", ""])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--candidate", type=Path, default=DEFAULT_CANDIDATE)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--profile", choices=sorted(GATE_PROFILES), default="v2-to-v3")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    baseline_tokenizer = ArtifactTokenizer(arguments.baseline.resolve())
    candidate_tokenizer = ArtifactTokenizer(arguments.candidate.resolve())
    benchmark_cases = json.loads(arguments.cases.read_text(encoding="utf-8"))
    case_results, category_results, total_ratio = compare(
        baseline_tokenizer, candidate_tokenizer, benchmark_cases
    )
    profile = GATE_PROFILES[arguments.profile]
    assert_gates(case_results, category_results, total_ratio, profile)
    report = render_report(
        baseline_tokenizer, candidate_tokenizer, case_results, category_results, total_ratio, profile
    )
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(report, encoding="utf-8")
    print(report)
