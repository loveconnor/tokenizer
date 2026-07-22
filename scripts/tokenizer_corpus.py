#!/usr/bin/env python3
"""Download bounded, reproducible tokenizer-training samples with provenance.

The downloader uses HTTP byte ranges so it never downloads the multi-terabyte
source datasets in full. It stores text only; URLs, repository names, and other
source metadata are deliberately excluded from the local corpus.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Set, Tuple

import pyarrow.parquet as parquet
import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = ROOT / "scripts" / "tokenizer-corpus-sources.json"
DEFAULT_PROVENANCE_LOCK = ROOT / "scripts" / "tokenizer-corpus.lock.json"
MAX_DOCUMENT_BYTES = 64 * 1024
MIN_DOCUMENT_BYTES = 128
HTTP_BUFFER_BYTES = 8 * 1024 * 1024

SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[opusr]_[A-Za-z0-9_]{30,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
)


class HttpRangeReader(io.RawIOBase):
    """Seekable HTTP reader backed by explicit Range requests."""

    def __init__(self, url: str, timeout_seconds: int = 120) -> None:
        self.url = url
        self.position = 0
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        response = self.session.head(url, allow_redirects=True, timeout=timeout_seconds)
        response.raise_for_status()
        content_length = response.headers.get("content-length")
        if content_length is None:
            raise ValueError("Corpus server did not report a content length")
        self.size = int(content_length)

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            next_position = offset
        elif whence == io.SEEK_CUR:
            next_position = self.position + offset
        elif whence == io.SEEK_END:
            next_position = self.size + offset
        else:
            raise ValueError("Unsupported seek mode")
        if next_position < 0:
            raise ValueError("Cannot seek before the beginning of the corpus file")
        self.position = next_position
        return self.position

    def readinto(self, buffer: bytearray) -> int:
        if self.position >= self.size:
            return 0
        end = min(self.size - 1, self.position + len(buffer) - 1)
        response = self.session.get(
            self.url,
            headers={"Range": "bytes={}-{}".format(self.position, end)},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        if response.status_code != 206:
            raise ValueError("Corpus server ignored the required byte-range request")
        payload = response.content
        expected_length = end - self.position + 1
        if len(payload) != expected_length:
            raise ValueError("Corpus server returned an incomplete byte range")
        buffer[: len(payload)] = payload
        self.position += len(payload)
        return len(payload)

    def close(self) -> None:
        self.session.close()
        super().close()


def hugging_face_url(dataset: str, revision: str, path: str) -> str:
    return "https://huggingface.co/datasets/{}/resolve/{}/{}?download=true".format(
        dataset, revision, path
    )


def deterministic_start(group: str, row_group_count: int) -> int:
    digest = hashlib.sha256(group.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % row_group_count


def row_group_order(group: str, row_group_count: int) -> Iterator[int]:
    start = deterministic_start(group, row_group_count)
    for offset in range(row_group_count):
        yield (start + offset) % row_group_count


def sanitize_document(raw: object, is_code: bool) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    text = raw.replace("\x00", "")
    encoded = text.encode("utf-8", errors="strict")
    if len(encoded) < MIN_DOCUMENT_BYTES:
        return None
    if is_code and any(pattern.search(text) for pattern in SECRET_PATTERNS):
        return None
    if len(encoded) > MAX_DOCUMENT_BYTES:
        encoded = encoded[:MAX_DOCUMENT_BYTES]
        while encoded:
            try:
                text = encoded.decode("utf-8", errors="strict")
                break
            except UnicodeDecodeError as error:
                encoded = encoded[: error.start]
        if not encoded:
            return None
    return text


def read_parquet_documents(
    url: str,
    group: str,
    text_column: str,
    target_bytes: int,
    seen_hashes: Set[str],
    license_column: Optional[str] = None,
    allowed_licenses: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, str]], List[int], int]:
    records: List[Dict[str, str]] = []
    selected_row_groups: List[int] = []
    accepted_bytes = 0
    raw_reader = HttpRangeReader(url)
    try:
        buffered_reader = io.BufferedReader(raw_reader, buffer_size=HTTP_BUFFER_BYTES)
        source = parquet.ParquetFile(buffered_reader)
        columns = [text_column]
        if license_column:
            columns.append(license_column)
        for row_group_index in row_group_order(group, source.metadata.num_row_groups):
            table = source.read_row_group(row_group_index, columns=columns)
            selected_row_groups.append(row_group_index)
            for row in table.to_pylist():
                license_name = str(row.get(license_column, "")).lower() if license_column else ""
                if allowed_licenses is not None and license_name not in allowed_licenses:
                    continue
                text = sanitize_document(row.get(text_column), is_code=group == "code")
                if text is None:
                    continue
                payload = text.encode("utf-8")
                digest = hashlib.sha256(payload).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                records.append(
                    {
                        "text": text,
                        "source_document_sha256": digest,
                        **({"upstream_license": license_name} if license_name else {}),
                    }
                )
                accepted_bytes += len(payload)
                if accepted_bytes >= target_bytes:
                    return records, selected_row_groups, accepted_bytes
        return records, selected_row_groups, accepted_bytes
    finally:
        raw_reader.close()


def write_jsonl_atomic(path: Path, records: Sequence[Dict[str, str]]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with tempfile.NamedTemporaryFile("wb", dir=str(path.parent), delete=False) as temporary:
        temporary_path = Path(temporary.name)
        for record in records:
            line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
                "utf-8"
            )
            temporary.write(line)
            digest.update(line)
    os.replace(str(temporary_path), str(path))
    return digest.hexdigest()


def write_text_atomic(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
        temporary_path = Path(output.name)
        output.write(payload)
    os.replace(temporary_path, path)
    path.chmod(0o644)


def expanded_jobs(configuration: Dict[str, object]) -> Iterator[Dict[str, object]]:
    for source in configuration["sources"]:
        kind = source["kind"]
        if kind == "fineweb2_languages":
            for group in source["groups"]:
                yield {
                    **source,
                    "group": group,
                    "path": source["path_template"].format(group=group),
                    "target_utf8_bytes": source["target_utf8_bytes_per_group"],
                }
        elif kind == "parquet_code_shards":
            per_shard_target = int(source["target_utf8_bytes"]) // len(source["shards"])
            for shard in source["shards"]:
                yield {
                    **source,
                    "job_id": "{}-{:05d}".format(source["id"], shard),
                    "path": source["path_template"].format(shard=shard),
                    "target_utf8_bytes": per_shard_target,
                }
        else:
            yield source


def download(
    configuration_path: Path,
    output_directory: Optional[Path] = None,
    provenance_lock_path: Path = DEFAULT_PROVENANCE_LOCK,
) -> Path:
    configuration = json.loads(configuration_path.read_text(encoding="utf-8"))
    output = output_directory or ROOT / str(configuration["output_directory"])
    output.mkdir(parents=True, exist_ok=True)
    seen_hashes: Set[str] = set()
    lock_jobs: List[Dict[str, object]] = []
    grouped_records: Dict[str, List[Dict[str, str]]] = {}

    for job in expanded_jobs(configuration):
        group = str(job["group"])
        path = str(job["path"])
        url = hugging_face_url(str(job["dataset"]), str(job["revision"]), path)
        records, row_groups, accepted_bytes = read_parquet_documents(
            url=url,
            group=group,
            text_column=str(job["text_column"]),
            target_bytes=int(job["target_utf8_bytes"]),
            seen_hashes=seen_hashes,
            license_column=str(job["license_column"]) if job.get("license_column") else None,
            allowed_licenses=set(job.get("allowed_licenses", [])) or None,
        )
        target_bytes = int(job["target_utf8_bytes"])
        if accepted_bytes < target_bytes:
            raise RuntimeError(
                "{} supplied only {:,} of {:,} required UTF-8 bytes".format(
                    job.get("job_id", job["id"]), accepted_bytes, target_bytes
                )
            )
        grouped_records.setdefault(group, []).extend(records)
        lock_jobs.append(
            {
                "id": job.get("job_id", job["id"]),
                "group": group,
                "dataset": job["dataset"],
                "revision": job["revision"],
                "path": path,
                "license": job["license"],
                "row_groups": row_groups,
                "documents": len(records),
                "utf8_bytes": accepted_bytes,
            }
        )
        print("{}: {:,} documents, {:,} UTF-8 bytes".format(group, len(records), accepted_bytes))

    group_outputs = []
    for group, records in sorted(grouped_records.items()):
        group_path = output / "groups" / "{}.jsonl".format(group)
        sha256 = write_jsonl_atomic(group_path, records)
        utf8_bytes = sum(len(record["text"].encode("utf-8")) for record in records)
        group_outputs.append(
            {
                "group": group,
                "path": str(group_path.relative_to(output)),
                "documents": len(records),
                "utf8_bytes": utf8_bytes,
                "sha256": sha256,
            }
        )

    source_manifest_sha256 = hashlib.sha256(configuration_path.read_bytes()).hexdigest()
    lock = {
        "schema_version": 1,
        "corpus_directory": (
            str(output.relative_to(ROOT)) if output.is_relative_to(ROOT) else str(output)
        ),
        "source_manifest": (
            str(configuration_path.relative_to(ROOT))
            if configuration_path.is_relative_to(ROOT)
            else str(configuration_path)
        ),
        "source_manifest_sha256": source_manifest_sha256,
        "privacy": {
            "stored_fields": ["text", "source_document_sha256", "upstream_license_for_code"],
            "excluded_metadata": ["url", "repository_name", "path", "author"],
            "code_secret_filter_patterns": len(SECRET_PATTERNS),
        },
        "jobs": lock_jobs,
        "groups": group_outputs,
    }
    lock_path = output / "manifest.lock.json"
    payload = json.dumps(lock, ensure_ascii=False, indent=2) + "\n"
    write_text_atomic(lock_path, payload)
    write_text_atomic(provenance_lock_path, payload)
    return provenance_lock_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--provenance-lock", type=Path, default=DEFAULT_PROVENANCE_LOCK)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    print(
        download(
            arguments.sources.resolve(),
            arguments.output.resolve() if arguments.output else None,
            arguments.provenance_lock.resolve(),
        )
    )
