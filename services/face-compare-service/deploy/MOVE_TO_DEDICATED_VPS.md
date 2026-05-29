# Move to Dedicated VPS

This service is designed so the Leaf backend depends only on an HTTP URL and API key.

## Current shared Contabo mode

```bash
BIOMETRIC_FACE_SERVICE_URL=http://leaf-face-compare-service:8008
BIOMETRIC_FACE_SERVICE_API_KEY=<secret>
BIOMETRIC_FACE_SERVICE_API_KEY_HEADER=X-Leaf-Biometric-Key
```

The FastAPI container is connected to the Leaf Docker network with alias `leaf-face-compare-service` and is not publicly exposed.

## Dedicated VPS mode

1. Copy this directory to the new VPS, for example:

```bash
/opt/leaf-face-compare-service
```

2. Create `.env` from `.env.example` and set:

```bash
FACE_PUBLIC_DOMAIN=biometric.leaf.example
FACE_API_KEYS=<new-or-rotated-secret>
FACE_LOAD_MODEL_ON_STARTUP=true
FACE_CONTAINER_CPUS=3
FACE_CONTAINER_MEMORY=4g
```

3. Point DNS to the dedicated VPS.

4. Start HTTPS profile:

```bash
cd /opt/leaf-face-compare-service
docker compose -f deploy/docker-compose.vps.yml up -d --build
```

5. Smoke test from the Leaf VPS:

```bash
BASE_URL=https://biometric.leaf.example FACE_API_KEY="$FACE_API_KEYS" ./scripts/smoke.sh
```

6. Change only the Leaf backend env:

```bash
BIOMETRIC_FACE_SERVICE_URL=https://biometric.leaf.example
BIOMETRIC_FACE_SERVICE_API_KEY=<same-secret-as-FACE_API_KEYS>
```

7. Restart only the Leaf backend container that uses KYC routes.

## Optional model cache

The model cache lives in Docker volume `deploy_insightface-cache`. Copying it avoids the first-start download, but it is not required; the service downloads `buffalo_l` on first real face request.

## Rollback

Set the Leaf backend URL back to shared mode:

```bash
BIOMETRIC_FACE_SERVICE_URL=http://leaf-face-compare-service:8008
```

Then restart the Leaf backend container.
