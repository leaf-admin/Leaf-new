# Leaf Integration Notes

This service is intended to be called by the Node.js backend only. The mobile app should not call it directly.

## Environment for Node.js

```bash
BIOMETRIC_FACE_SERVICE_URL=https://biometric.leaf.example
BIOMETRIC_FACE_SERVICE_API_KEY=replace-with-the-same-secret-from-FACE_API_KEYS
BIOMETRIC_FACE_SERVICE_API_KEY_HEADER=X-Leaf-Biometric-Key
BIOMETRIC_FACE_SERVICE_TIMEOUT_MS=90000
BIOMETRIC_FACE_APPROVE_THRESHOLD=0.61
BIOMETRIC_FACE_REVIEW_THRESHOLD=0.40
BIOMETRIC_SERVER_SIDE_MAX_CONCURRENCY=4
BIOMETRIC_SERVER_SIDE_MAX_QUEUE=250
KYC_VPS_PROVIDER=auto
ENABLE_CNH_FACE_BIOMETRICS=true
CNH_FACE_BIOMETRICS_BLOCKING=false

# Optional legacy/device-first surface. Canary production uses server-side selfie
# comparison after AWS liveness, not ArcFace running inside the app.
MOBILE_FACE_EMBEDDING_ENABLED=true
MOBILE_FACE_EMBEDDING_ALLOWED_MODES=mobile_arcface_w600k_r50_v1,device_embedding_v1
MOBILE_FACE_EMBEDDING_FORMAT=float32-l2-normalized-512
MOBILE_FACE_EMBEDDING_DIMENSION=512
MOBILE_FACE_EMBEDDING_NORM_MIN=0.95
MOBILE_FACE_EMBEDDING_NORM_MAX=1.05
MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK=true

# CNH Digital photo crop ratios. These must be calibrated with real CNH-e PDFs.
CNH_DIGITAL_PHOTO_CROP_LEFT=0.200044
CNH_DIGITAL_PHOTO_CROP_TOP=0.404421
CNH_DIGITAL_PHOTO_CROP_WIDTH=0.219841
CNH_DIGITAL_PHOTO_CROP_HEIGHT=0.396786
```

On the current shared Contabo host, use the Docker-network URL:

```bash
BIOMETRIC_FACE_SERVICE_URL=http://leaf-face-compare-service:8008
```

When moving the service to a dedicated VPS, keep the same backend code and change only:

```bash
BIOMETRIC_FACE_SERVICE_URL=https://biometric.leaf.example
BIOMETRIC_FACE_SERVICE_API_KEY=<rotated-or-same-secret>
```

## Backend building blocks added

- `leaf-websocket-backend/services/biometric-face-client.js`
  - Calls `/health`, `/generate-embedding`, and `/compare`.
  - Adds API key.
  - Avoids image/base64 logging.

- `leaf-websocket-backend/services/cnh-face-biometric-service.js`
  - Converts a CNH Digital PDF to an image using the current OCR service helper.
  - Crops the expected CNH photo region by relative layout.
  - Falls back to full-page face detection if the crop fails.
  - Generates `cnhFaceEmbedding` through the Python service.

- `leaf-websocket-backend/services/kyc-vps-client.js`
  - Uses the biometric FastAPI service when `BIOMETRIC_FACE_SERVICE_URL` and API key are configured.
  - Keeps the legacy VPS API fallback when the biometric env is absent.

- `leaf-websocket-backend/services/driver-document-analysis-queue.js`
  - In shadow mode, can generate and store the CNH face embedding after CNH Digital analysis.
  - Controlled by `ENABLE_CNH_FACE_BIOMETRICS=true`.
  - Does not block approval unless `CNH_FACE_BIOMETRICS_BLOCKING=true`.

- `leaf-websocket-backend/services/device-face-embedding-verification-service.js`
  - Accepts only the configured mobile embedding mode/format/dimension.
  - Reads `users/{driverId}/biometrics/cnhFace.embedding`.
  - Compares the mobile selfie embedding against the stored CNH embedding.
  - Does not store the selfie embedding.

- `mobile-app/src/services/DeviceFaceEmbeddingService.js`
  - Calls the optional native `LeafFaceEmbedding.generateEmbedding` module when present.
  - Falls back to the legacy device signature flow until the native ArcFace model is bundled in the app.

- `mobile-app/plugins/withLeafFaceEmbedding.js`
  - Recreates the optional native bridge during `expo prebuild`/EAS because `android/` and `ios/` are generated/ignored.
  - Copies model assets from `mobile-app/native/face-embedding/face_models`.
  - Keeps `available: false` until both the model and native inference runtime are intentionally enabled.

## Proposed write path

1. Driver uploads CNH Digital PDF.
2. Existing document analysis validates CPF/name/validity/EAR.
3. Backend generates `cnhFaceEmbedding`.
4. Backend stores:
   - `users/{driverId}/biometrics/cnhFace.embedding`
   - `users/{driverId}/biometrics/cnhFace.model`
   - `users/{driverId}/biometrics/cnhFace.version`
   - `users/{driverId}/biometrics/cnhFace.faceDetectionScore`
   - `users/{driverId}/biometrics/cnhFace.source = cnh_digital_pdf`
   - `users/{driverId}/biometrics/cnhFace.createdAt`
5. AWS Rekognition liveness remains mandatory before unlocking online.
6. App captures a quick selfie after AWS liveness and sends the image to the backend endpoint `/api/kyc/verify-driver/server-side-selfie`.
7. Backend generates the live selfie embedding in this microservice and compares it against `users/{driverId}/biometrics/cnhFace.embedding`.
8. Backend stores score/decision/thresholds for calibration, not the selfie image.

The mobile ArcFace/device embedding path is optional legacy/experimental surface. The production path for canary is server-side after AWS liveness, because the app currently does not bundle the native ArcFace runtime/model.

For riskier operations such as withdrawals, keep using a server-side verification path and step-up controls.

## Production rollout

1. Shadow mode: compute and store scores, do not block.
2. Review mode: high score auto-approves, low score goes to review.
3. Auto-reject only after enough confirmed fraud/non-fraud samples.
