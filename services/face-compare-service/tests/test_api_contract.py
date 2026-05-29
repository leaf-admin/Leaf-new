import os
import unittest


os.environ.setdefault("FACE_API_KEYS", "test-key")


try:
    from fastapi.testclient import TestClient

    from app.main import app
except ModuleNotFoundError:
    TestClient = None
    app = None


@unittest.skipIf(TestClient is None, "FastAPI test dependencies are not installed")
class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_does_not_load_model(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertFalse(body["model_loaded"])
        self.assertEqual(body["model"]["detector"], "SCRFD")
        self.assertEqual(body["model"]["recognizer"], "ArcFace")

    def test_openapi_docs_are_closed_by_default(self):
        response = self.client.get("/openapi.json")

        self.assertEqual(response.status_code, 404)

    def test_compare_accepts_camel_case_embeddings(self):
        response = self.client.post(
            "/compare",
            headers={"X-Leaf-Biometric-Key": "test-key"},
            json={"embeddingA": [1, 0, 0], "embeddingB": [1, 0, 0]},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["decision"], "approve")
        self.assertAlmostEqual(body["cosine_similarity"], 1.0)

    def test_compare_rejects_missing_api_key(self):
        response = self.client.post(
            "/compare",
            json={"embeddingA": [1, 0, 0], "embeddingB": [1, 0, 0]},
        )

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
