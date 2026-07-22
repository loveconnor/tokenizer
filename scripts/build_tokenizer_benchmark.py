#!/usr/bin/env python3
"""Build the pinned Connor's Tokenizer corpus benchmark without redistributing source text.

The generated corpus is ignored by git. A compact lock file records every
source, revision, content hash, byte count, and public attribution needed to
reproduce or audit the checked-in result report.
"""

from __future__ import annotations

import argparse
import hashlib
import html
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import runpy
import tempfile
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Sequence
import urllib.parse
import zipfile

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = ROOT / "benchmarks" / "atlas-corpus-v3.sources.json"
DEFAULT_OUTPUT = ROOT / "data" / "tokenizer-benchmark"
DEFAULT_LOCK = ROOT / "benchmarks" / "atlas-corpus-v3.lock.json"
USER_AGENT = "ConnorsTokenizerBenchmark/3.0 (+https://github.com/loveconnor/tokenizer)"
TIMEOUT_SECONDS = 120
MAX_SOURCE_BYTES = 24 * 1024 * 1024

TRACK_LABELS = {
    "wikipedia": "Wikipedia",
    "common-crawl": "Common Crawl",
    "github-repositories": "GitHub repositories",
    "stack-overflow": "Stack Overflow",
    "books": "Books",
    "news": "News articles",
    "scientific-papers": "Scientific papers",
    "html": "HTML",
    "json": "JSON",
    "markdown": "Markdown",
    "python": "Python",
    "typescript": "TypeScript",
    "rust": "Rust",
    "cpp": "C++",
    "java": "Java",
    "tokenizerbench-languages": "TokenizerBench · 84 languages",
    "tokenizerbench-code": "TokenizerBench · 17 code languages",
    "tokenizerbench-math": "TokenizerBench · math and science",
    "tokenizerbench-edge": "TokenizerBench · robustness",
}


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: List[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "svg", "noscript"}:
            self.hidden_depth += 1
        elif tag in {"p", "div", "li", "pre", "code", "h1", "h2", "h3", "br"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "svg", "noscript"} and self.hidden_depth:
            self.hidden_depth -= 1
        elif tag in {"p", "div", "li", "pre", "code", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)

    def text(self) -> str:
        payload = html.unescape("".join(self.parts))
        payload = re.sub(r"[ \t]+", " ", payload)
        return re.sub(r"\n{3,}", "\n\n", payload).strip()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def utf8_prefix(text: str, maximum_bytes: int) -> str:
    payload = text.encode("utf-8")
    if len(payload) <= maximum_bytes:
        return text
    payload = payload[:maximum_bytes]
    while payload:
        try:
            return payload.decode("utf-8")
        except UnicodeDecodeError as error:
            payload = payload[: error.start]
    return ""


def normalize_text(text: str) -> str:
    return text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n").strip()


def fetch(session: requests.Session, url: str) -> bytes:
    response = session.get(url, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    if len(response.content) > MAX_SOURCE_BYTES:
        raise ValueError("Source exceeds bounded download limit: {}".format(url))
    return response.content


def add_record(
    tracks: MutableMapping[str, List[Dict[str, Any]]],
    track: str,
    text: str,
    *,
    record_id: str,
    title: str,
    source_url: str,
    license_name: str,
    subgroup: str | None = None,
    revision: str | None = None,
    preserve_exact_text: bool = False,
) -> None:
    clean = (
        text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
        if preserve_exact_text
        else normalize_text(text)
    )
    if not clean:
        raise ValueError("Empty benchmark record: {}".format(record_id))
    payload = clean.encode("utf-8")
    tracks.setdefault(track, []).append(
        {
            "id": record_id,
            "title": title,
            "text": clean,
            "utf8Bytes": len(payload),
            "sha256": sha256_bytes(payload),
            "sourceUrl": source_url,
            "license": license_name,
            **({"subgroup": subgroup} if subgroup else {}),
            **({"revision": revision} if revision else {}),
        }
    )


def training_hashes() -> set[str]:
    hashes: set[str] = set()
    for path in sorted((ROOT / "data" / "tokenizer-corpus" / "groups").glob("*.jsonl")):
        with path.open(encoding="utf-8") as source:
            for line in source:
                try:
                    digest = json.loads(line).get("source_document_sha256")
                except json.JSONDecodeError:
                    continue
                if isinstance(digest, str):
                    hashes.add(digest)
    return hashes


def build_tokenizerbench(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
    wheel_override: Path | None,
) -> None:
    wheel_payload = wheel_override.read_bytes() if wheel_override else fetch(session, source["wheelUrl"])
    actual_hash = sha256_bytes(wheel_payload)
    if actual_hash != source["sha256"]:
        raise ValueError("TokenizerBench wheel SHA-256 mismatch: {}".format(actual_hash))
    with tempfile.TemporaryDirectory(prefix="atlas-tokenizerbench-") as temporary:
        with zipfile.ZipFile(io.BytesIO(wheel_payload)) as archive:
            archive.extractall(temporary)
        data_directory = Path(temporary) / "tokenizerbench" / "data"
        datasets = [
            ("tokenizerbench-languages", "human_languages.py", "human_languages_full"),
            ("tokenizerbench-code", "programming_languages.py", "programming_languages_full"),
            ("tokenizerbench-math", "scientific_formulas.py", "scientific_formulas_full"),
            ("tokenizerbench-edge", "edge_cases.py", "edge_cases"),
        ]
        for track, filename, variable in datasets:
            # The verified 0.2.0 wheel has broken package-level imports. Loading
            # the named data module is the smallest faithful way to use its
            # exact published full fixtures.
            namespace = runpy.run_path(str(data_directory / filename))
            groups = namespace.get(variable)
            if not isinstance(groups, dict):
                raise ValueError("TokenizerBench dataset missing: {}".format(variable))
            for group, cases in groups.items():
                if not isinstance(cases, list):
                    raise ValueError("TokenizerBench group is not a list: {}".format(group))
                for index, case in enumerate(cases):
                    if not isinstance(case, str):
                        raise ValueError("TokenizerBench case is not text: {}".format(group))
                    add_record(
                        tracks,
                        track,
                        case,
                        record_id="{}-{}-{:03d}".format(track, group, index + 1),
                        title="{} · case {}".format(group, index + 1),
                        subgroup=group,
                        source_url=source["sourceUrl"],
                        license_name=source["license"],
                        revision="{} · {}".format(source["version"], source["sha256"][:12]),
                        preserve_exact_text=True,
                    )


def build_wikipedia(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    snapshot = source["wikipediaSnapshot"]
    maximum = int(source["maxCharactersPerLanguage"])
    for language in source["languages"]:
        url = (
            "https://datasets-server.huggingface.co/rows?dataset=wikimedia%2Fwikipedia"
            "&config={}.{}&split=train&offset=0&length=100".format(snapshot, language)
        )
        payload = json.loads(fetch(session, url))
        total_characters = 0
        accepted = 0
        for item in payload.get("rows", []):
            row = item.get("row", {})
            text = str(row.get("text", "")).strip()
            if len(text) <= 100 or total_characters >= maximum:
                continue
            title = str(row.get("title", "Untitled Wikipedia article"))
            add_record(
                tracks,
                "wikipedia",
                text,
                record_id="wikipedia-{}-{}".format(language, row.get("id", item.get("row_idx"))),
                title=title,
                subgroup=language,
                source_url=str(row.get("url") or source["sourceUrl"]),
                license_name=source["license"],
                revision="{}.{}".format(snapshot, language),
            )
            total_characters += len(text)
            accepted += 1
        if not accepted or total_characters < maximum:
            raise RuntimeError(
                "Wikipedia first-row response did not reach the TokLens character budget for {}: {:,}".format(
                    language, total_characters
                )
            )


def build_common_crawl(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    payload = json.loads(fetch(session, source["firstRowsUrl"]))
    excluded = training_hashes()
    accepted_bytes = 0
    maximum = int(source["maxUtf8Bytes"])
    for index, item in enumerate(payload.get("rows", [])):
        row = item.get("row", {})
        text = normalize_text(str(row.get("text", "")))
        digest = sha256_bytes(text.encode("utf-8"))
        if not text or digest in excluded:
            continue
        remaining = maximum - accepted_bytes
        if remaining <= 0:
            break
        text = utf8_prefix(text, remaining)
        add_record(
            tracks,
            "common-crawl",
            text,
            record_id="fineweb-{}".format(row.get("id", index)),
            title="FineWeb document {}".format(index + 1),
            source_url=str(row.get("url") or source["sourceUrl"]),
            license_name=source["license"],
            revision=source["datasetRevision"],
        )
        accepted_bytes += len(text.encode("utf-8"))
    if accepted_bytes < maximum:
        raise RuntimeError("FineWeb supplied only {:,} of {:,} bytes".format(accepted_bytes, maximum))


def stackprinter_url(question_id: int) -> str:
    query = urllib.parse.urlencode(
        {
            "question": question_id,
            "service": "stackoverflow",
            "language": "en",
            "hideAnswers": "false",
            "showAll": "true",
            "width": 640,
        }
    )
    return "https://stackprinter.appspot.com/export?{}".format(query)


def build_stack_overflow(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    for question in source["questions"]:
        question_id = int(question["id"])
        url = stackprinter_url(question_id)
        raw_html = fetch(session, url).decode("utf-8", errors="strict")
        add_record(
            tracks,
            "html",
            utf8_prefix(raw_html, 100_000),
            record_id="stackoverflow-html-{}".format(question_id),
            title="StackPrinter HTML · {}".format(question["title"]),
            source_url="https://stackoverflow.com/questions/{}".format(question_id),
            license_name=source["license"],
            revision="StackPrinter export",
        )
        parser = VisibleTextParser()
        parser.feed(raw_html)
        add_record(
            tracks,
            "stack-overflow",
            utf8_prefix(parser.text(), 100_000),
            record_id="stackoverflow-text-{}".format(question_id),
            title=question["title"],
            source_url="https://stackoverflow.com/questions/{}".format(question_id),
            license_name=source["license"],
            revision="StackPrinter export",
        )


def strip_gutenberg_boilerplate(text: str) -> str:
    start = re.search(r"\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*", text, re.I)
    end = re.search(r"\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*", text, re.I)
    begin = start.end() if start else 0
    finish = end.start() if end and end.start() > begin else len(text)
    return text[begin:finish].strip()


def build_books(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    for item in source["items"]:
        text = fetch(session, item["url"]).decode("utf-8-sig", errors="strict")
        text = utf8_prefix(strip_gutenberg_boilerplate(text), int(item["maxUtf8Bytes"]))
        add_record(
            tracks,
            "books",
            text,
            record_id=item["id"],
            title=item["title"],
            source_url=item["url"],
            license_name=source["license"],
            revision="Project Gutenberg ebook {}".format(item["id"].removeprefix("pg")),
        )


def build_news(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    revision_ids = [str(value) for value in source["revisionIds"]]
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "revids": "|".join(revision_ids),
            "prop": "revisions",
            "rvprop": "ids|timestamp|content",
            "rvslots": "main",
            "format": "json",
            "formatversion": "2",
            "origin": "*",
        }
    )
    url = "https://en.wikinews.org/w/api.php?{}".format(params)
    payload = json.loads(fetch(session, url))
    pages = payload.get("query", {}).get("pages", [])
    if len(pages) != len(revision_ids):
        raise RuntimeError("Wikinews did not return every pinned revision")
    for page in pages:
        revision = page["revisions"][0]
        content = revision["slots"]["main"]["content"]
        add_record(
            tracks,
            "news",
            content,
            record_id="wikinews-{}".format(revision["revid"]),
            title=page["title"],
            source_url="https://en.wikinews.org/?curid={}".format(page["pageid"]),
            license_name=source["license"],
            revision=str(revision["revid"]),
        )


def xml_text(element: Any) -> str:
    return " ".join(part.strip() for part in element.itertext() if part.strip())


def build_scientific_papers(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    import xml.etree.ElementTree as element_tree

    for pmcid in source["pmcids"]:
        url = "https://www.ebi.ac.uk/europepmc/webservices/rest/{}/fullTextXML".format(pmcid)
        payload = fetch(session, url)
        root = element_tree.fromstring(payload)
        title_node = root.find(".//article-title")
        body = root.find(".//body")
        if title_node is None or body is None:
            raise RuntimeError("Europe PMC full text is incomplete: {}".format(pmcid))
        title = xml_text(title_node)
        text = utf8_prefix(xml_text(body), int(source["maxUtf8BytesPerPaper"]))
        add_record(
            tracks,
            "scientific-papers",
            text,
            record_id=pmcid.lower(),
            title=title,
            source_url="https://europepmc.org/articles/{}".format(pmcid),
            license_name=source["license"],
            revision=pmcid,
        )


def raw_github_url(item: Mapping[str, Any]) -> str:
    return "https://raw.githubusercontent.com/{}/{}/{}".format(
        item["repository"], item["revision"], item["path"]
    )


def build_github(
    session: requests.Session,
    source: Mapping[str, Any],
    tracks: MutableMapping[str, List[Dict[str, Any]]],
) -> None:
    for item in source["files"]:
        url = raw_github_url(item)
        text = fetch(session, url).decode("utf-8", errors="strict")
        text = utf8_prefix(text, 160_000)
        public_url = "https://github.com/{}/blob/{}/{}".format(
            item["repository"], item["revision"], item["path"]
        )
        add_record(
            tracks,
            item["track"],
            text,
            record_id=item["id"],
            title="{} · {}".format(item["repository"], item["path"]),
            source_url=public_url,
            license_name=item["license"],
            revision=item["revision"],
        )
        add_record(
            tracks,
            "github-repositories",
            text,
            record_id="github-{}".format(item["id"]),
            title="{} · {}".format(item["repository"], item["path"]),
            source_url=public_url,
            license_name=item["license"],
            revision=item["revision"],
        )


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    os.replace(temporary, path)


def write_outputs(
    tracks: Mapping[str, Sequence[Mapping[str, Any]]],
    sources_path: Path,
    output_directory: Path,
    lock_path: Path,
) -> None:
    summaries = []
    corpus_digest = hashlib.sha256()
    for track in TRACK_LABELS:
        records = tracks.get(track, [])
        if not records:
            raise RuntimeError("Required benchmark track is empty: {}".format(track))
        lines = []
        groups: Dict[str, int] = {}
        for record in records:
            serialized = {
                "id": record["id"],
                "text": record["text"],
                "sha256": record["sha256"],
                **({"subgroup": record["subgroup"]} if record.get("subgroup") else {}),
            }
            line = (json.dumps(serialized, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            lines.append(line)
            corpus_digest.update(track.encode("utf-8") + b"\0" + line)
            if record.get("subgroup"):
                group = str(record["subgroup"])
                groups[group] = groups.get(group, 0) + 1
        payload = b"".join(lines)
        relative_path = "tracks/{}.jsonl".format(track)
        atomic_write(output_directory / relative_path, payload)
        summaries.append(
            {
                "id": track,
                "label": TRACK_LABELS[track],
                "path": relative_path,
                "records": len(records),
                "utf8Bytes": sum(int(record["utf8Bytes"]) for record in records),
                "jsonlSha256": sha256_bytes(payload),
                "groups": groups,
                "samples": [
                    {
                        key: record[key]
                        for key in ("id", "title", "sourceUrl", "license", "revision", "utf8Bytes", "sha256")
                        if record.get(key) is not None
                    }
                    for record in (
                        records[:20] if track.startswith("tokenizerbench-") else records
                    )
                ],
            }
        )
    source_payload = sources_path.read_bytes()
    lock = {
        "schemaVersion": 1,
        "protocolId": "atlas-corpus-v3",
        "builtAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "sourceManifest": str(sources_path.relative_to(ROOT)),
        "sourceManifestSha256": sha256_bytes(source_payload),
        "corpusSha256": corpus_digest.hexdigest(),
        "corpusDirectory": str(output_directory.relative_to(ROOT)),
        "tracks": summaries,
        "privacy": {
            "rawTextTrackedByGit": False,
            "storedPublicMetadata": ["title", "source URL", "license", "revision", "content hash"],
            "notes": "The ignored local corpus contains public source text only. The checked-in lock contains hashes and attribution, not source bodies."
        },
    }
    lock_payload = (json.dumps(lock, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    atomic_write(output_directory / "manifest.lock.json", lock_payload)
    atomic_write(lock_path, lock_payload)


def build(
    sources_path: Path,
    output_directory: Path,
    lock_path: Path,
    wheel_override: Path | None,
) -> None:
    configuration = json.loads(sources_path.read_text(encoding="utf-8"))
    tracks: Dict[str, List[Dict[str, Any]]] = {}
    with requests.Session() as session:
        session.headers["User-Agent"] = USER_AGENT
        build_tokenizerbench(session, configuration["tokenizerBench"], tracks, wheel_override)
        build_wikipedia(session, configuration["tokLens"], tracks)
        build_common_crawl(session, configuration["commonCrawl"], tracks)
        build_stack_overflow(session, configuration["stackOverflow"], tracks)
        build_books(session, configuration["books"], tracks)
        build_news(session, configuration["news"], tracks)
        build_scientific_papers(session, configuration["scientificPapers"], tracks)
        build_github(session, configuration["github"], tracks)
    write_outputs(tracks, sources_path, output_directory, lock_path)
    for track in TRACK_LABELS:
        records = tracks[track]
        print("{}: {:,} records, {:,} UTF-8 bytes".format(
            track, len(records), sum(int(record["utf8Bytes"]) for record in records)
        ))
    print(lock_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--tokenizerbench-wheel", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    build(
        arguments.sources.resolve(),
        arguments.output.resolve(),
        arguments.lock.resolve(),
        arguments.tokenizerbench_wheel.resolve() if arguments.tokenizerbench_wheel else None,
    )
