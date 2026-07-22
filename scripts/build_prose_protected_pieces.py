#!/usr/bin/env python3
"""Derive conservative English prose pieces from the locked production corpus."""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Counter, Iterable, List, Mapping, Sequence, Set, Tuple

if __package__:
    from scripts.train_atlas_tokenizer import iter_group_documents, load_verified_groups, sha256_file
else:
    from train_atlas_tokenizer import iter_group_documents, load_verified_groups, sha256_file


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS_LOCK = ROOT / "scripts" / "tokenizer-corpus.lock.json"
DEFAULT_OUTPUT = ROOT / "scripts" / "tokenizer-prose-protected-pieces.json"
ENGLISH_GROUP = "eng_Latn"
ENGLISH_MINIMUM_FREQUENCY = 6
GLOBAL_MINIMUM_FREQUENCY = 38
MIN_WORD_BYTES = 3
MAX_WORD_BYTES = 32
SCORE_MARGIN = 5.0
WORD_PATTERN = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")


def normalized_words(text: str) -> Iterable[str]:
    for match in WORD_PATTERN.finditer(text):
        yield match.group(0).lower().replace("’", "'")


def count_words(
    grouped_texts: Mapping[str, Iterable[str]],
) -> Tuple[Counter[str], Counter[str]]:
    english_counts: Counter[str] = collections.Counter()
    global_counts: Counter[str] = collections.Counter()
    for group in sorted(grouped_texts):
        for text in grouped_texts[group]:
            words = list(normalized_words(text))
            global_counts.update(words)
            if group == ENGLISH_GROUP:
                english_counts.update(words)
    return english_counts, global_counts


def build_piece_inventory(
    english_counts: Counter[str],
    global_counts: Counter[str],
    english_frequency: int = ENGLISH_MINIMUM_FREQUENCY,
    global_frequency: int = GLOBAL_MINIMUM_FREQUENCY,
) -> Tuple[List[str], List[str]]:
    selected_words = sorted(
        word
        for word, global_count in global_counts.items()
        if MIN_WORD_BYTES <= len(word.encode("utf-8")) <= MAX_WORD_BYTES
        and (english_counts[word] >= english_frequency or global_count >= global_frequency)
    )
    pieces: Set[str] = set()
    for word in selected_words:
        # Both forms are necessary. A preceding learned piece may already own the
        # separating space, while sentence-initial and ordinary words need the
        # bare and space-prefixed forms respectively.
        pieces.update((word, " " + word))
    return selected_words, sorted(pieces, key=lambda piece: (len(piece.encode("utf-8")), piece))


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
    english_counts: Counter[str] = collections.Counter()
    global_counts: Counter[str] = collections.Counter()
    for group in sorted(groups):
        for text, _ in iter_group_documents(groups[group]):
            words = list(normalized_words(text))
            global_counts.update(words)
            if group == ENGLISH_GROUP:
                english_counts.update(words)
    words, pieces = build_piece_inventory(english_counts, global_counts)
    write_json_atomic(
        output_path,
        {
            "schemaVersion": 1,
            "source": {
                "name": "lowercased ASCII word forms from locked tokenizer corpus",
                "corpusManifestSha256": sha256_file(corpus_lock),
            },
            "selection": {
                "englishGroup": ENGLISH_GROUP,
                "englishMinimumFrequency": ENGLISH_MINIMUM_FREQUENCY,
                "globalMinimumFrequency": GLOBAL_MINIMUM_FREQUENCY,
                "minimumWordBytes": MIN_WORD_BYTES,
                "maximumWordBytes": MAX_WORD_BYTES,
                "casePolicy": "lowercase",
                "forms": ["bare", "space-prefixed"],
                "rawDocumentsRetained": False,
                "countsRetained": False,
            },
            "scorePolicy": {"kind": "segmentation-margin", "margin": SCORE_MARGIN},
            "wordCount": len(words),
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
