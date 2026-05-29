# Face Compare Service Runbook

## 1. Local validation

```bash
cd services/face-compare-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
export FACE_API_KEYS="$(openssl rand -hex 32)"
uvicorn app.main:app --host 0.0.0.0 --port 8008
```

Smoke:

```bash
FACE_API_KEY="$FACE_API_KEYS" ./scripts/smoke.sh
python scripts/benchmark.py --api-key "$FACE_API_KEYS" --iterations 50
```

With sample images:

```bash
python scripts/benchmark.py --api-key "$FACE_API_KEYS" --image /path/to/selfie.jpg --iterations 20
curl -X POST "http://localhost:8008/generate-embedding" \
  -H "X-Leaf-Biometric-Key: $FACE_API_KEYS" \
  -F "image=@/path/to/cnh-face-crop.jpg"
```

## 2. VPS staging

1. Point DNS to the VPS.
2. Copy the service directory.
3. Create `.env` from `.env.example`.
4. Set:

```bash
FACE_PUBLIC_DOMAIN=biometric-staging.leaf.example
FACE_API_KEYS=<openssl-rand-hex-32>
FACE_APPROVE_THRESHOLD=0.61
FACE_REVIEW_THRESHOLD=0.40
FACE_LOAD_MODEL_ON_STARTUP=true
```

Start:

```bash
docker compose -f deploy/docker-compose.vps.yml up -d --build
```

Smoke:

```bash
BASE_URL=https://biometric-staging.leaf.example FACE_API_KEY="$FACE_API_KEYS" ./scripts/smoke.sh
```

## 3. Node.js backend env

```bash
BIOMETRIC_FACE_SERVICE_URL=https://biometric-staging.leaf.example
BIOMETRIC_FACE_SERVICE_API_KEY=<same-secret>
BIOMETRIC_FACE_SERVICE_API_KEY_HEADER=X-Leaf-Biometric-Key
BIOMETRIC_FACE_SERVICE_TIMEOUT_MS=15000
```

For CNH Digital crop calibration:

```bash
CNH_DIGITAL_PHOTO_CROP_LEFT=0.200044
CNH_DIGITAL_PHOTO_CROP_TOP=0.404421
CNH_DIGITAL_PHOTO_CROP_WIDTH=0.219841
CNH_DIGITAL_PHOTO_CROP_HEIGHT=0.396786
```

## 4. First tests

Use consented CNH Digital PDFs and matching selfies.

Minimum dataset:

- 30 positive pairs: CNH owner vs own selfie.
- 30 negative pairs: CNH owner vs another person's selfie.
- 10 edge cases: old CNH photo, low-light selfie, glasses, beard change, different camera quality.

Measure:

- CNH photo crop success rate.
- Face detection success rate on the crop.
- CNH embedding latency p50/p95.
- Selfie embedding latency p50/p95.
- Compare latency p50/p95.
- Positive score distribution.
- Negative score distribution.

## 5. Rollout

1. Shadow mode: compute score and store it, do not block.
2. Review mode: high score approves, middle/low score enters manual review.
3. Auto-reject only after confirmed calibration with internal dataset.

Initial conservative thresholds:

```text
>= 0.61   approve
0.40-<0.61 review
< 0.40    reject candidate
```

## 6. Production controls

- HTTPS only.
- API key rotation procedure.
- Backend-only access; no direct mobile access.
- Firewall blocks direct port `8008`.
- Logs never include image bytes/base64.
- Embeddings encrypted at rest.
- Metrics and alerts for latency, error rate, no-face rate, and review rate.
- Model version stored with every embedding and comparison.

## 7. Shared VPS limits

On a VPS that already hosts Leaf API/socket/workers, start with `deploy/docker-compose.internal.yml`. It binds only to `127.0.0.1:8008` and keeps the pilot contained:

- `FACE_CONTAINER_CPUS=1.25`
- `FACE_CONTAINER_MEMORY=3g`
- `FACE_OMP_NUM_THREADS=1`
- `FACE_OPENBLAS_NUM_THREADS=1`
- `FACE_MKL_NUM_THREADS=1`
- `FACE_NUMEXPR_NUM_THREADS=1`

If concurrency grows, prefer a dedicated VPS or a second biometric worker before increasing threads on the shared production host.
