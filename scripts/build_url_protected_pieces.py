#!/usr/bin/env python3
"""Derive privacy-minimized URL syntax pieces from the locked training corpus."""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import tempfile
import urllib.parse
from pathlib import Path
from typing import Counter, Dict, Iterable, List, Mapping, Set

if __package__:
    from scripts.train_atlas_tokenizer import iter_group_documents, load_verified_groups, sha256_file
else:
    from train_atlas_tokenizer import iter_group_documents, load_verified_groups, sha256_file


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS_LOCK = ROOT / "scripts" / "tokenizer-corpus.lock.json"
DEFAULT_OUTPUT = ROOT / "scripts" / "tokenizer-url-protected-pieces.json"
URL_PATTERN = re.compile(r"https?://[^\s<>\"']{8,512}")
SAFE_COMPONENT = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,31}")
SAFE_HOST = re.compile(r"[a-z0-9.-]{3,47}")
TRAILING_PUNCTUATION = ".,);]}"
MIN_SUFFIX_FREQUENCY = 10
MIN_PARAMETER_FREQUENCY = 5
MIN_PATH_FREQUENCY = 10
MAX_PIECE_BYTES = 48


def extract_url_feature_counts(texts: Iterable[str]) -> Dict[str, Counter[str]]:
    suffixes: Counter[str] = collections.Counter()
    parameters: Counter[str] = collections.Counter()
    paths: Counter[str] = collections.Counter()
    for text in texts:
        for raw_url in URL_PATTERN.findall(text):
            candidate = raw_url.rstrip(TRAILING_PUNCTUATION)
            try:
                parsed = urllib.parse.urlsplit(candidate)
            except ValueError:
                continue
            hostname = (parsed.hostname or "").lower()
            if SAFE_HOST.fullmatch(hostname):
                labels = hostname.split(".")
                for label_count in (2, 3):
                    if len(labels) >= label_count:
                        suffixes["." + ".".join(labels[-label_count:])] += 1
            try:
                query_pairs = urllib.parse.parse_qsl(
                    parsed.query, keep_blank_values=True, max_num_fields=64
                )
            except ValueError:
                query_pairs = []
            for key, _ in query_pairs:
                if SAFE_COMPONENT.fullmatch(key):
                    parameters[key] += 1
            for raw_segment in parsed.path.split("/"):
                segment = urllib.parse.unquote(raw_segment)
                if SAFE_COMPONENT.fullmatch(segment):
                    paths[segment] += 1
    return {"suffixes": suffixes, "parameters": parameters, "paths": paths}


def build_piece_inventory(
    counts: Mapping[str, Counter[str]],
    suffix_frequency: int = MIN_SUFFIX_FREQUENCY,
    parameter_frequency: int = MIN_PARAMETER_FREQUENCY,
    path_frequency: int = MIN_PATH_FREQUENCY,
) -> List[str]:
    pieces: Set[str] = {"http://", "https://", "ws://", "wss://", "://", "www."}
    hexadecimal = "0123456789ABCDEFabcdef"
    pieces.update("%{}{}".format(first, second) for first in hexadecimal for second in hexadecimal)
    for suffix, frequency in counts["suffixes"].items():
        if frequency >= suffix_frequency:
            pieces.add(suffix)
    for parameter, frequency in counts["parameters"].items():
        if frequency >= parameter_frequency:
            pieces.update(("?{}=".format(parameter), "&{}=".format(parameter)))
    for segment, frequency in counts["paths"].items():
        if frequency >= path_frequency:
            pieces.update(("/{}".format(segment), "/{}/".format(segment)))
    bounded = [piece for piece in pieces if 2 <= len(piece.encode("utf-8")) <= MAX_PIECE_BYTES]
    return sorted(bounded, key=lambda piece: (len(piece.encode("utf-8")), piece))


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
        temporary_path = Path(output.name)
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")
    os.replace(temporary_path, path)
    path.chmod(0o644)


def build(corpus_lock: Path, output_path: Path) -> Path:
    groups, _ = load_verified_groups(corpus_lock)
    texts = (
        text
        for group in sorted(groups)
        for text, _ in iter_group_documents(groups[group])
    )
    counts = extract_url_feature_counts(texts)
    pieces = build_piece_inventory(counts)
    write_json_atomic(
        output_path,
        {
            "schemaVersion": 1,
            "source": {
                "name": "privacy-minimized URL features from locked tokenizer corpus",
                "corpusManifestSha256": sha256_file(corpus_lock),
            },
            "selection": {
                "suffixMinimumFrequency": MIN_SUFFIX_FREQUENCY,
                "parameterMinimumFrequency": MIN_PARAMETER_FREQUENCY,
                "pathMinimumFrequency": MIN_PATH_FREQUENCY,
                "rawUrlsRetained": False,
                "queryValuesRetained": False,
            },
            "featureCounts": {
                "suffixes": len(counts["suffixes"]),
                "parameters": len(counts["parameters"]),
                "paths": len(counts["paths"]),
            },
            "pieces": pieces,
        },
    )
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-lock", type=Path, default=DEFAULT_CORPUS_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    print(build(arguments.corpus_lock.resolve(), arguments.output.resolve()))
