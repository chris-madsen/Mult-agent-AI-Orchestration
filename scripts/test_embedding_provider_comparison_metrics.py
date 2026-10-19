from __future__ import annotations

import importlib.util
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "embedding-provider-comparison.py"
SPEC = importlib.util.spec_from_file_location("embedding_provider_comparison", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load embedding comparison module")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EmbeddingRankingMetricsTest(unittest.TestCase):
    def test_metrics_use_exact_relevant_ranks(self) -> None:
        metrics = MODULE.ranking_metrics([1, 3, 6])
        self.assertAlmostEqual(metrics["recall_at_1"], 1 / 3)
        self.assertAlmostEqual(metrics["recall_at_3"], 2 / 3)
        self.assertAlmostEqual(metrics["recall_at_5"], 2 / 3)
        self.assertAlmostEqual(metrics["mrr"], 0.5)
        expected_ndcg = (1.0 + (1.0 / math.log2(4)) + 0.0) / 3
        self.assertAlmostEqual(metrics["ndcg_at_5"], expected_ndcg)

    def test_invalid_rank_input_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.ranking_metrics([])
        with self.assertRaises(ValueError):
            MODULE.ranking_metrics([1, 0])


if __name__ == "__main__":
    unittest.main()
