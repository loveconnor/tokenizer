#!/usr/bin/env python3
"""Build a deterministic list of protected RGI emoji pieces from Unicode data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import List

import requests


ROOT = Path(__file__).resolve().parents[1]
UNICODE_VERSION = "17.0"
SOURCE_URL = "https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt"
SOURCE_SHA256 = "1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda"
DEFAULT_OUTPUT = ROOT / "scripts" / "tokenizer-protected-pieces.json"
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_PIECE_BYTES = 48


def parse_fully_qualified_emoji(source_text: str, expected_count: int = 3_944) -> List[str]:
    if "# Version: {}".format(UNICODE_VERSION) not in source_text:
        raise ValueError("Unexpected Unicode emoji data version")
    pieces = []
    for line in source_text.splitlines():
        if "; fully-qualified" not in line:
            continue
        code_points = line.split(";", 1)[0].strip().split()
        piece = "".join(chr(int(value, 16)) for value in code_points)
        if not piece or len(piece.encode("utf-8")) > MAX_PIECE_BYTES:
            raise ValueError("Unicode emoji sequence exceeds the tokenizer piece limit")
        pieces.append(piece)
    if len(pieces) != expected_count or len(set(pieces)) != len(pieces):
        raise ValueError("Unexpected fully-qualified emoji sequence inventory")
    return pieces


def download_source() -> bytes:
    response = requests.get(SOURCE_URL, timeout=60)
    response.raise_for_status()
    payload = response.content
    if len(payload) > MAX_SOURCE_BYTES:
        raise ValueError("Unicode emoji data exceeds the download limit")
    if hashlib.sha256(payload).hexdigest() != SOURCE_SHA256:
        raise ValueError("Unicode emoji data hash mismatch")
    return payload


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
        temporary_path = Path(output.name)
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")
    os.replace(temporary_path, path)
    path.chmod(0o644)


def build(output_path: Path, source_payload: bytes | None = None) -> Path:
    payload = source_payload if source_payload is not None else download_source()
    if hashlib.sha256(payload).hexdigest() != SOURCE_SHA256:
        raise ValueError("Unicode emoji data hash mismatch")
    pieces = parse_fully_qualified_emoji(payload.decode("utf-8", errors="strict"))
    write_json_atomic(
        output_path,
        {
            "schemaVersion": 1,
            "source": {
                "name": "Unicode Emoji Keyboard/Display Test Data",
                "version": UNICODE_VERSION,
                "url": SOURCE_URL,
                "sha256": SOURCE_SHA256,
                "license": "Unicode-3.0",
            },
            "selection": "fully-qualified entries only",
            "pieces": pieces,
        },
    )
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source-file", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    source = arguments.source_file.read_bytes() if arguments.source_file else None
    print(build(arguments.output.resolve(), source))
