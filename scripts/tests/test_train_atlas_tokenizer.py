import unittest

from scripts.tokenizer_corpus import deterministic_start, sanitize_document
from scripts.build_emoji_protected_pieces import parse_fully_qualified_emoji
from scripts.build_url_protected_pieces import build_piece_inventory, extract_url_feature_counts
from scripts.build_prose_protected_pieces import (
    build_piece_inventory as build_prose_piece_inventory,
    count_words,
)
from scripts.train_atlas_tokenizer import (
    augment_scored_protected_candidates,
    augment_protected_candidates,
    bytes_to_symbols,
    include_fractional_copy,
    parity_multipliers,
    symbols_to_bytes,
)


class CorpusPreparationTests(unittest.TestCase):
    def test_row_group_selection_is_stable(self):
        self.assertEqual(deterministic_start("spa_Latn", 37), deterministic_start("spa_Latn", 37))
        self.assertNotEqual(deterministic_start("spa_Latn", 37), deterministic_start("jpn_Jpan", 37))

    def test_rejects_small_and_secret_bearing_code(self):
        self.assertIsNone(sanitize_document("short", is_code=False))
        secret = "const key = '" + "AKIA" + "1234567890123456';\n" + ("x" * 200)
        self.assertIsNone(sanitize_document(secret, is_code=True))

    def test_truncates_only_at_a_utf8_boundary(self):
        text = "界" * 30000
        result = sanitize_document(text, is_code=False)
        self.assertIsNotNone(result)
        self.assertLessEqual(len(result.encode("utf-8")), 64 * 1024)
        result.encode("utf-8", errors="strict")


class ConnorsTokenizerTrainerTests(unittest.TestCase):
    def test_byte_symbol_mapping_round_trips_every_byte(self):
        payload = bytes(range(256))
        self.assertEqual(symbols_to_bytes(bytes_to_symbols(payload)), payload)

    def test_fractional_reweighting_is_deterministic(self):
        first = include_fractional_copy("a" * 64, 1, 0.5)
        self.assertEqual(first, include_fractional_copy("a" * 64, 1, 0.5))
        self.assertFalse(include_fractional_copy("a" * 64, 1, 0.0))

    def test_parity_reweighting_only_upsamples_high_cost_languages(self):
        metrics = {
            "eng_Latn": {"tokensPerByte": 0.20},
            "jpn_Jpan": {"tokensPerByte": 0.40},
            "spa_Latn": {"tokensPerByte": 0.20},
            "code": {"tokensPerByte": 0.30},
        }
        weights = parity_multipliers(metrics)
        self.assertEqual(weights["code"], 1.0)
        self.assertEqual(weights["eng_Latn"], 1.0)
        self.assertGreater(weights["jpn_Jpan"], 1.0)

    def test_protected_piece_outscores_its_previous_segmentation(self):
        candidates = {bytes([value]): -10.0 for value in range(256)}
        candidates[b"ab"] = -5.0
        protected, injected = augment_protected_candidates(candidates, [b"abc"])
        self.assertEqual(protected, {b"abc"})
        self.assertEqual(injected, 1)
        self.assertEqual(candidates[b"abc"], 0.0)

    def test_margin_piece_beats_segmentation_without_overwriting_learned_piece(self):
        candidates = {bytes([value]): -10.0 for value in range(256)}
        candidates[b"ab"] = -5.0
        protected, injected = augment_scored_protected_candidates(
            candidates,
            [(b"abc", "segmentation-margin", 4.0), (b"ab", "segmentation-margin", 4.0)],
        )
        self.assertEqual(protected, {b"ab", b"abc"})
        self.assertEqual(injected, 1)
        self.assertEqual(candidates[b"abc"], -11.0)
        self.assertEqual(candidates[b"ab"], -5.0)

    def test_prose_inventory_requires_repeated_corpus_evidence_and_pairs_forms(self):
        english_counts, global_counts = count_words(
            {
                "eng_Latn": ["Countable countable countable countable countable countable."],
                "code": ["Tokenizer tokenizer tokenizer tokenizer tokenizer tokenizer."],
            }
        )
        words, pieces = build_prose_piece_inventory(
            english_counts, global_counts, english_frequency=6, global_frequency=6
        )
        self.assertEqual(words, ["countable", "tokenizer"])
        self.assertIn("countable", pieces)
        self.assertIn(" countable", pieces)
        self.assertIn("tokenizer", pieces)
        self.assertIn(" tokenizer", pieces)

    def test_parses_only_fully_qualified_unicode_emoji(self):
        source = """# Version: 17.0
1F600 ; fully-qualified # 😀 grinning face
263A ; unqualified # ☺ smiling face
"""
        self.assertEqual(parse_fully_qualified_emoji(source, expected_count=1), ["😀"])

    def test_url_features_discard_query_values_and_raw_urls(self):
        counts = extract_url_feature_counts(
            ["See https://docs.example.com/api/users?q=secret-value&id=123 for details."]
        )
        pieces = build_piece_inventory(
            counts, suffix_frequency=1, parameter_frequency=1, path_frequency=1
        )
        self.assertIn(".example.com", pieces)
        self.assertIn("?q=", pieces)
        self.assertNotIn("secret-value", pieces)
        self.assertFalse(any("123" in piece for piece in pieces))


if __name__ == "__main__":
    unittest.main()
