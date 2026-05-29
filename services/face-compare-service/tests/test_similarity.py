import math
import unittest

from app.services.similarity import (
    SimilarityError,
    classify_similarity,
    cosine_similarity,
    euclidean_distance,
    normalize_vector,
)


class SimilarityTests(unittest.TestCase):
    def test_cosine_similarity_for_same_embedding_is_one(self):
        self.assertAlmostEqual(cosine_similarity([1, 0, 0], [1, 0, 0]), 1.0)

    def test_cosine_similarity_for_orthogonal_embeddings_is_zero(self):
        self.assertAlmostEqual(cosine_similarity([1, 0], [0, 1]), 0.0)

    def test_euclidean_distance(self):
        self.assertAlmostEqual(euclidean_distance([1, 0], [0, 1]), math.sqrt(2))

    def test_classification_thresholds(self):
        self.assertEqual(classify_similarity(0.93, 0.92, 0.82), "approve")
        self.assertEqual(classify_similarity(0.88, 0.92, 0.82), "review")
        self.assertEqual(classify_similarity(0.70, 0.92, 0.82), "reject")

    def test_leaf_pilot_thresholds_approve_positive_cnh_selfie_score(self):
        self.assertEqual(classify_similarity(0.6958239685747076, 0.61, 0.40), "approve")
        self.assertEqual(classify_similarity(0.6100000000000000, 0.61, 0.40), "approve")
        self.assertEqual(classify_similarity(0.4000000000000000, 0.61, 0.40), "review")
        self.assertEqual(classify_similarity(0.23474668231996762, 0.61, 0.40), "reject")

    def test_rejects_dimension_mismatch(self):
        with self.assertRaises(SimilarityError):
            cosine_similarity([1, 2], [1])

    def test_normalize_vector(self):
        self.assertEqual(normalize_vector([3, 4]), [0.6, 0.8])


if __name__ == "__main__":
    unittest.main()
