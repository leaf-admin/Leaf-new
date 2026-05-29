# Leaf Face Embedding Models

Place the mobile ArcFace ONNX model here when enabling on-device inference:

```text
arcface_w600k_r50.onnx
```

The backend CNH embedding model and the mobile selfie embedding model must stay compatible. Until the model and native runtime are intentionally configured, `LeafFaceEmbedding.getStatus()` returns `available: false` and the app keeps the existing fallback path.
