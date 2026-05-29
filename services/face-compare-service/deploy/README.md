# VPS Deploy

This deploy profile exposes the service through Caddy with automatic HTTPS and keeps the FastAPI container on an internal Docker network.

## Required DNS

Point a domain such as `biometric.leaf.example` to the VPS public IP.

## Environment

Create `services/face-compare-service/.env` from `.env.example` and set:

```bash
FACE_PUBLIC_DOMAIN=biometric.leaf.example
FACE_API_KEYS=replace-with-a-long-random-secret
FACE_APPROVE_THRESHOLD=0.61
FACE_REVIEW_THRESHOLD=0.40
```

Generate an API key:

```bash
openssl rand -hex 32
```

## Start

```bash
cd services/face-compare-service
docker compose -f deploy/docker-compose.vps.yml up -d --build
```

## Smoke Test

```bash
BASE_URL=https://biometric.leaf.example FACE_API_KEY="$FACE_API_KEYS" ./scripts/smoke.sh
```

## Firewall

Recommended production posture:

- Allow inbound `22/tcp` only from admin IPs.
- Allow inbound `80/tcp` and `443/tcp`.
- Block direct access to `8008/tcp`.
- Prefer backend IP allowlisting at the VPS firewall or Caddy layer when the backend has a stable egress IP.
