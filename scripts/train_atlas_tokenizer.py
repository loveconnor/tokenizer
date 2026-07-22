#!/usr/bin/env python3
"""Train and export Connor's Tokenizer, a byte-lossless parity-aware Unigram tokenizer.

The native SentencePiece model is an intermediate candidate generator. The
browser artifact contains explicit byte strings and is decoded without Unicode
normalization, so every valid JavaScript string round-trips through UTF-8.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import statistics
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterator, List, Mapping, Sequence, Set, Tuple

import sentencepiece as sentencepiece


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "scripts" / "tokenizer-corpus.lock.json"
DEFAULT_BUILD = ROOT / "data" / "tokenizer-build" / "atlas-unigram-v3"
DEFAULT_OUTPUT = ROOT / "public" / "tokenizers" / "atlas-unigram-v3"
DEFAULT_PROTECTED_PIECES = (
    ROOT / "scripts" / "tokenizer-protected-pieces.json",
    ROOT / "scripts" / "tokenizer-url-protected-pieces.json",
    ROOT / "scripts" / "tokenizer-prose-protected-pieces.json",
)
BYTE_SYMBOL_BASE = 0xE000
BYTE_ALPHABET = "".join(chr(BYTE_SYMBOL_BASE + value) for value in range(256))
CONTROL_NAMES = ("bos", "eos", "system", "user", "assistant", "tool", "pad")
PARITY_EVALUATION_BYTES = 1_000_000
PROTECTED_PIECE_SCORE = 0.0
MAX_LEARNED_PIECE_SCORE = -1e-6


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bytes_to_symbols(payload: bytes) -> str:
    return "".join(chr(BYTE_SYMBOL_BASE + value) for value in payload)


def symbols_to_bytes(piece: str) -> bytes:
    values = []
    for character in piece:
        value = ord(character) - BYTE_SYMBOL_BASE
        if value < 0 or value > 255:
            raise ValueError("SentencePiece emitted a non-byte symbol")
        values.append(value)
    return bytes(values)


def load_verified_groups(lock_path: Path) -> Tuple[Dict[str, Path], Mapping[str, object]]:
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    if lock.get("schema_version") != 1:
        raise ValueError("Unsupported corpus lock schema")
    corpus_directory = lock.get("corpus_directory")
    group_root = (
        ROOT / str(corpus_directory)
        if corpus_directory and not Path(str(corpus_directory)).is_absolute()
        else Path(str(corpus_directory))
        if corpus_directory
        else lock_path.parent
    )
    groups: Dict[str, Path] = {}
    for entry in lock.get("groups", []):
        group = str(entry["group"])
        path = group_root / str(entry["path"])
        if not path.is_file():
            raise FileNotFoundError("Missing corpus group: {}".format(path))
        actual_hash = sha256_file(path)
        if actual_hash != entry["sha256"]:
            raise ValueError("Corpus hash mismatch for {}".format(group))
        groups[group] = path
    if "eng_Latn" not in groups or "code" not in groups or len(groups) < 3:
        raise ValueError("Corpus must include English, code, and multilingual groups")
    return groups, lock


def iter_group_documents(path: Path) -> Iterator[Tuple[str, str]]:
    with path.open("r", encoding="utf-8") as source:
        for line in source:
            record = json.loads(line)
            text = record.get("text")
            digest = record.get("source_document_sha256")
            if not isinstance(text, str) or not isinstance(digest, str):
                raise ValueError("Malformed corpus record in {}".format(path))
            yield text, digest


def include_fractional_copy(document_hash: str, round_index: int, fraction: float) -> bool:
    if fraction <= 0:
        return False
    key = "{}:{}".format(round_index, document_hash).encode("ascii")
    draw = int.from_bytes(hashlib.sha256(key).digest()[:8], "big") / float(2**64)
    return draw < fraction


def training_sentences(
    groups: Mapping[str, Path], multipliers: Mapping[str, float], round_index: int
) -> Iterator[str]:
    # required_chars guarantees coverage; this explicit sentence also gives every
    # byte a non-zero observation without pretending it came from the corpus.
    yield BYTE_ALPHABET
    for group in sorted(groups):
        multiplier = float(multipliers.get(group, 1.0))
        whole_copies = max(1, int(math.floor(multiplier)))
        fractional_copy = max(0.0, multiplier - whole_copies)
        for text, document_hash in iter_group_documents(groups[group]):
            encoded = bytes_to_symbols(text.encode("utf-8"))
            for _ in range(whole_copies):
                yield encoded
            if include_fractional_copy(document_hash, round_index, fractional_copy):
                yield encoded


def train_round(
    groups: Mapping[str, Path],
    multipliers: Mapping[str, float],
    round_index: int,
    model_prefix: Path,
    vocab_size: int,
) -> Path:
    model_prefix.parent.mkdir(parents=True, exist_ok=True)
    sentencepiece.SentencePieceTrainer.train(
        sentence_iterator=training_sentences(groups, multipliers, round_index),
        model_prefix=str(model_prefix),
        model_type="unigram",
        vocab_size=vocab_size + 1,  # SentencePiece retains one internal <unk> piece.
        normalization_rule_name="identity",
        add_dummy_prefix=False,
        remove_extra_whitespaces=False,
        split_by_unicode_script=False,
        split_by_whitespace=False,
        split_by_number=False,
        treat_whitespace_as_suffix=False,
        byte_fallback=False,
        character_coverage=1.0,
        required_chars=BYTE_ALPHABET,
        max_sentencepiece_length=48,
        # Each original byte becomes one private-use code point encoded as three
        # UTF-8 bytes inside SentencePiece, so this limit must cover 3 * 64 KiB.
        max_sentence_length=196_608,
        hard_vocab_limit=False,
        shuffle_input_sentence=False,
        train_extremely_large_corpus=True,
        bos_id=-1,
        eos_id=-1,
        pad_id=-1,
        unk_id=0,
        unk_piece="<unk>",
        num_threads=max(1, min(8, os.cpu_count() or 1)),
        minloglevel=1,
    )
    return model_prefix.with_suffix(".model")


def evaluate_group(
    processor: sentencepiece.SentencePieceProcessor, path: Path, byte_limit: int
) -> Dict[str, float]:
    byte_count = 0
    token_count = 0
    document_count = 0
    for text, _ in iter_group_documents(path):
        payload = text.encode("utf-8")
        if byte_count and byte_count + len(payload) > byte_limit:
            break
        ids = processor.encode(bytes_to_symbols(payload), out_type=int, add_bos=False, add_eos=False)
        byte_count += len(payload)
        token_count += len(ids)
        document_count += 1
        if byte_count >= byte_limit:
            break
    if byte_count == 0:
        raise ValueError("No evaluation bytes available in {}".format(path))
    return {
        "documents": document_count,
        "utf8Bytes": byte_count,
        "tokens": token_count,
        "tokensPerByte": token_count / byte_count,
        "bytesPerToken": byte_count / token_count if token_count else 0.0,
    }


def evaluate_groups(
    processor: sentencepiece.SentencePieceProcessor, groups: Mapping[str, Path]
) -> Dict[str, Dict[str, float]]:
    return {
        group: evaluate_group(processor, path, PARITY_EVALUATION_BYTES)
        for group, path in sorted(groups.items())
    }


def parity_multipliers(metrics: Mapping[str, Mapping[str, float]]) -> Dict[str, float]:
    language_costs = [
        float(values["tokensPerByte"])
        for group, values in metrics.items()
        if group != "code"
    ]
    target = statistics.median(language_costs)
    multipliers: Dict[str, float] = {}
    for group, values in metrics.items():
        if group == "code":
            multipliers[group] = 1.0
            continue
        ratio = float(values["tokensPerByte"]) / target
        multipliers[group] = round(min(2.5, max(1.0, ratio**1.5)), 4)
    return multipliers


def load_protected_pieces(
    paths: Sequence[Path],
) -> Tuple[List[Tuple[bytes, str, float]], List[Mapping[str, object]]]:
    pieces: List[Tuple[bytes, str, float]] = []
    summaries = []
    for path in paths:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("schemaVersion") != 1:
            raise ValueError("Unsupported protected-piece schema")
        raw_pieces = manifest.get("pieces")
        if not isinstance(raw_pieces, list) or not raw_pieces:
            raise ValueError("Protected-piece manifest is empty")
        raw_policy = manifest.get("scorePolicy", {"kind": "fixed", "score": PROTECTED_PIECE_SCORE})
        if not isinstance(raw_policy, dict):
            raise ValueError("Protected-piece score policy must be an object")
        policy_kind = raw_policy.get("kind")
        if policy_kind == "fixed":
            policy_value = float(raw_policy.get("score", PROTECTED_PIECE_SCORE))
        elif policy_kind == "segmentation-margin":
            policy_value = float(raw_policy.get("margin", 0.0))
            if policy_value <= 0 or policy_value > 20:
                raise ValueError("Segmentation margin must be between 0 and 20")
        else:
            raise ValueError("Unsupported protected-piece score policy")
        for raw_piece in raw_pieces:
            if not isinstance(raw_piece, str):
                raise ValueError("Protected piece must be text")
            payload = raw_piece.encode("utf-8", errors="strict")
            if len(payload) < 2 or len(payload) > 48:
                raise ValueError("Protected piece exceeds tokenizer bounds")
            pieces.append((payload, str(policy_kind), policy_value))
        summaries.append(
            {
                "manifest": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
                "manifestSha256": sha256_file(path),
                "source": manifest["source"],
                "pieceCount": len(raw_pieces),
                "scorePolicy": raw_policy,
            }
        )
    payloads = [payload for payload, _, _ in pieces]
    if len(set(payloads)) != len(payloads):
        raise ValueError("Protected-piece manifests contain duplicate pieces")
    return pieces, summaries


def build_score_trie(candidates: Mapping[bytes, float]) -> Dict[object, object]:
    root: Dict[object, object] = {}
    for payload, score in candidates.items():
        node = root
        for value in payload:
            child = node.get(value)
            if not isinstance(child, dict):
                child = {}
                node[value] = child
            node = child
        node[None] = score
    return root


def best_segmentation_score(payload: bytes, root: Mapping[object, object]) -> float:
    scores = [-math.inf] * (len(payload) + 1)
    scores[0] = 0.0
    for start in range(len(payload)):
        if not math.isfinite(scores[start]):
            continue
        node: Mapping[object, object] = root
        for end in range(start, len(payload)):
            child = node.get(payload[end])
            if not isinstance(child, dict):
                break
            node = child
            piece_score = node.get(None)
            if isinstance(piece_score, (int, float)):
                scores[end + 1] = max(scores[end + 1], scores[start] + float(piece_score))
    return scores[-1]


def augment_protected_candidates(
    candidates: Dict[bytes, float], protected_pieces: Sequence[bytes]
) -> Tuple[Set[bytes], int]:
    protected_set = set(protected_pieces)
    if max(candidates.values()) >= PROTECTED_PIECE_SCORE:
        raise ValueError("Learned piece scores must remain below protected-piece score")
    injected_count = 0
    for payload in protected_set:
        if payload not in candidates:
            injected_count += 1
        candidates[payload] = PROTECTED_PIECE_SCORE
    return protected_set, injected_count


def augment_scored_protected_candidates(
    candidates: Dict[bytes, float], protected_pieces: Sequence[Tuple[bytes, str, float]]
) -> Tuple[Set[bytes], int]:
    protected_set = {payload for payload, _, _ in protected_pieces}
    injected_count = 0
    fixed_pieces = [piece for piece in protected_pieces if piece[1] == "fixed"]
    margin_pieces = [piece for piece in protected_pieces if piece[1] == "segmentation-margin"]
    for payload, _, score in fixed_pieces:
        if payload not in candidates:
            injected_count += 1
        candidates[payload] = score
    score_trie = build_score_trie(candidates)
    for payload, _, margin in margin_pieces:
        if payload in candidates:
            continue
        baseline_score = best_segmentation_score(payload, score_trie)
        if not math.isfinite(baseline_score):
            raise ValueError("Protected piece cannot be segmented into byte candidates")
        candidates[payload] = min(MAX_LEARNED_PIECE_SCORE, baseline_score + margin)
        injected_count += 1
    return protected_set, injected_count


def select_candidate_payloads(
    candidates: Mapping[bytes, float], target_size: int, protected_set: Set[bytes]
) -> List[bytes]:
    available_learned_slots = target_size - 256 - len(protected_set)
    if available_learned_slots < 0:
        raise ValueError("Protected pieces exceed the requested vocabulary")
    ordered = [bytes([value]) for value in range(256)]
    learned_multi_byte_pieces = sorted(
        (payload for payload in candidates if len(payload) > 1 and payload not in protected_set),
        key=lambda payload: (-candidates[payload], len(payload), payload),
    )
    selected_multi_byte_pieces = list(protected_set)
    selected_multi_byte_pieces.extend(learned_multi_byte_pieces[:available_learned_slots])
    selected_multi_byte_pieces.sort(key=lambda payload: (-candidates[payload], len(payload), payload))
    ordered.extend(selected_multi_byte_pieces)
    return ordered


def export_vocabulary(
    processor: sentencepiece.SentencePieceProcessor,
    native_target_size: int,
    output_target_size: int,
    protected_pieces: Sequence[Tuple[bytes, str, float]],
) -> Tuple[List[Dict[str, object]], List[int], int]:
    candidates: Dict[bytes, float] = {}
    for piece_id in range(processor.get_piece_size()):
        if processor.is_unknown(piece_id) or processor.is_control(piece_id) or processor.is_unused(piece_id):
            continue
        payload = symbols_to_bytes(processor.id_to_piece(piece_id))
        if not payload:
            continue
        score = float(processor.get_score(piece_id))
        candidates[payload] = max(score, candidates.get(payload, -math.inf))

    missing = [value for value in range(256) if bytes([value]) not in candidates]
    if missing:
        fallback_score = min(candidates.values()) - 10.0
        for value in missing:
            candidates[bytes([value])] = fallback_score

    fixed_pieces = [piece for piece in protected_pieces if piece[1] == "fixed"]
    margin_pieces = [piece for piece in protected_pieces if piece[1] == "segmentation-margin"]
    fixed_set, fixed_injected_count = augment_scored_protected_candidates(candidates, fixed_pieces)

    # First reproduce the bounded native/fixed vocabulary. Margin-scored prose
    # then extends that complete baseline, so adding prose cannot evict a v2
    # multilingual, code, emoji, or URL piece.
    baseline_ordered = select_candidate_payloads(candidates, native_target_size, fixed_set)
    candidates = {payload: candidates[payload] for payload in baseline_ordered}
    margin_set, margin_injected_count = augment_scored_protected_candidates(candidates, margin_pieces)
    protected_set = fixed_set | margin_set
    ordered = select_candidate_payloads(candidates, output_target_size, protected_set)
    vocabulary = [
        {
            "id": piece_id,
            "bytes": base64.b64encode(payload).decode("ascii"),
            "score": candidates[payload],
            **({"protected": True} if payload in protected_set else {}),
        }
        for piece_id, payload in enumerate(ordered)
    ]
    return vocabulary, missing, fixed_injected_count + margin_injected_count


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
        temporary_path = Path(output.name)
        json.dump(value, output, ensure_ascii=False, separators=(",", ":"))
        output.write("\n")
    os.replace(temporary_path, path)
    path.chmod(0o644)


def train(
    corpus_lock: Path,
    build_directory: Path,
    output_directory: Path,
    vocab_size: int,
    output_vocab_size: int,
    rounds: int,
    tokenizer_id: str,
    protected_pieces_paths: Sequence[Path],
    reuse_existing_rounds: bool = False,
) -> Path:
    if vocab_size < 1_024 or output_vocab_size < vocab_size:
        raise ValueError("Output vocabulary must be at least as large as the native vocabulary")
    if rounds < 1 or rounds > 3:
        raise ValueError("Parity rounds must be between 1 and 3")
    groups, lock = load_verified_groups(corpus_lock)
    protected_pieces, protected_sources = load_protected_pieces(protected_pieces_paths)
    corpus_lock_hash = sha256_file(corpus_lock)
    multipliers = {group: 1.0 for group in groups}
    history: List[Dict[str, object]] = []
    model_path: Path | None = None

    for round_index in range(rounds):
        model_prefix = build_directory / "round-{}".format(round_index + 1) / "atlas"
        existing_model = model_prefix.with_suffix(".model")
        model_path = existing_model if reuse_existing_rounds and existing_model.is_file() else train_round(
            groups, multipliers, round_index, model_prefix, vocab_size
        )
        processor = sentencepiece.SentencePieceProcessor(model_file=str(model_path))
        metrics = evaluate_groups(processor, groups)
        history.append(
            {
                "round": round_index + 1,
                "trainingMultipliers": multipliers,
                "evaluation": metrics,
            }
        )
        if round_index + 1 < rounds:
            multipliers = parity_multipliers(metrics)

    assert model_path is not None
    processor = sentencepiece.SentencePieceProcessor(model_file=str(model_path))
    vocabulary, synthetic_fallback_bytes, injected_protected_count = export_vocabulary(
        processor, vocab_size, output_vocab_size, protected_pieces
    )
    controls = {
        name: {"id": len(vocabulary) + index, "surface": "<|atlas_{}|>".format(name)}
        for index, name in enumerate(CONTROL_NAMES)
    }
    artifact = {
        "schemaVersion": 1,
        "tokenizerId": tokenizer_id,
        "modelType": "byte-unigram",
        "normalization": "identity",
        "vocabulary": vocabulary,
        "controlTokens": controls,
        "limits": {"maxInputBytes": 1_000_000, "maxPieceBytes": 48},
        "training": {
            "algorithm": "SentencePiece Unigram candidate discovery with deterministic parity reweighting",
            "requestedVocabularySize": vocab_size,
            "requestedOutputVocabularySize": output_vocab_size,
            "actualTextVocabularySize": len(vocabulary),
            "syntheticByteFallbackValues": synthetic_fallback_bytes,
            "protectedPieces": {
                "count": len(protected_pieces),
                "injectedCount": injected_protected_count,
                "sources": protected_sources,
            },
            "parityRounds": rounds,
            "corpusManifestSha256": corpus_lock_hash,
            "corpusGroups": lock["groups"],
            "history": history,
        },
    }
    artifact_path = output_directory / "tokenizer.json"
    write_json_atomic(artifact_path, artifact)
    artifact_hash = sha256_file(artifact_path)
    revision = {
        "schemaVersion": 1,
        "tokenizerId": tokenizer_id,
        "license": "AGPL-3.0-only",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "tokenizerSha256": artifact_hash,
        "corpusManifestSha256": corpus_lock_hash,
        "textVocabularySize": len(vocabulary),
        "controlTokenCount": len(controls),
        "trainingImplementation": "scripts/train_atlas_tokenizer.py",
        "protectedPieceManifests": [
            {"path": source["manifest"], "sha256": source["manifestSha256"]}
            for source in protected_sources
        ],
    }
    write_json_atomic(output_directory / "revision.json", revision)
    return artifact_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-lock", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--build-directory", type=Path, default=DEFAULT_BUILD)
    parser.add_argument("--output-directory", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--vocab-size", type=int, default=131_072)
    parser.add_argument("--output-vocab-size", type=int, default=196_608)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--tokenizer-id", default="atlas-unigram-v3")
    parser.add_argument("--protected-pieces", type=Path, action="append")
    parser.add_argument(
        "--reuse-existing-rounds",
        action="store_true",
        help="Reuse already trained round models after verifying the corpus; evaluation and export still rerun.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    result = train(
        arguments.corpus_lock.resolve(),
        arguments.build_directory.resolve(),
        arguments.output_directory.resolve(),
        arguments.vocab_size,
        arguments.output_vocab_size,
        arguments.rounds,
        arguments.tokenizer_id,
        [path.resolve() for path in (arguments.protected_pieces or DEFAULT_PROTECTED_PIECES)],
        arguments.reuse_existing_rounds,
    )
    print(result)
