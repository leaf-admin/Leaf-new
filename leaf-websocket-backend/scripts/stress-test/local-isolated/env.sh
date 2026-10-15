#!/usr/bin/env bash
# Source this file (". env.sh") before starting the local backend or a load
# test. Everything stays on this machine: Redis on 6390 and the Firebase
# emulators of project demo-leaf-load (start them with
#   npx --yes firebase-tools@14.22.0 emulators:start --project demo-leaf-load \
#     --config config/firebase/firebase.json --only auth,firestore,database,storage
# from the repository root, with Java 21 on PATH).
#
# LEAF_LOADTEST_SA must point at a throwaway service-account JSON for
# demo-leaf-load (any RSA key; the emulators never verify it). Never use a
# real credential here.
: "${LEAF_LOADTEST_SA:?set LEAF_LOADTEST_SA to a fake demo-leaf-load service account}"

export NODE_ENV=development
export PORT="${PORT:-3101}"
export REDIS_URL="redis://127.0.0.1:6390"
export GCLOUD_PROJECT=demo-leaf-load
export FIREBASE_PROJECT_ID=demo-leaf-load
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000
export FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
export FIREBASE_DATABASE_URL="http://127.0.0.1:9000?ns=demo-leaf-load"
export GOOGLE_APPLICATION_CREDENTIALS="$LEAF_LOADTEST_SA"
# Pix is the only external dependency of the ride flow: simulate it as paid.
# APP_REVIEW + ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING let createBooking
# accept the synthetic mock_review_ charge; never set these in production.
export MOCK_PAYMENT_FOR_TESTS=true
export APP_REVIEW=true
export ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING=true
# Identity checks call AWS when a driver goes online (not per ride): run the
# canonical activation policy only, with the biometric provider dormant.
export DAILY_KYC_ONLINE_GATE_ENABLED=false
export KYC_TRUST_CADENCE_ENABLED=false
export KYC_PRODUCTION_BIOMETRICS_ENABLED=false
# Runtime topology and dispatch flags as in docker-compose.gateway-scale.yml:
# gateways share sockets through the Socket.IO Redis adapter, the queue
# worker and the listener (sideeffects) worker run as separate processes.
export ENABLE_SOCKETIO_REDIS_ADAPTER=true
export REQUIRE_SOCKETIO_REDIS_ADAPTER=true
export ENABLE_EMBEDDED_LISTENER_WORKERS=false
export RUNTIME_ENABLE_QUEUE_WORKER=false
export ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH=true
export GEOFENCE_FAIL_CLOSED=true
export GEOFENCE_REGION_FILE=config/geofence.json
export DISPATCH_NOTIFY_CONCURRENCY=24
export DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS=20
export DISPATCH_VERIFY_SOCKET_ROOM=false
export MATCH_DRIVERS_PER_WAVE=40
export MATCH_EXPANSION_INTERVAL_MS=250
export MATCH_EMPTY_WAVE_INTERVAL_MS=100
export MATCH_INITIAL_RADIUS_KM=2.0
export MATCH_EXPANSION_STEP_KM=1.5
export DISPATCH_GEO_CANDIDATE_MIN=320
export DISPATCH_GEO_CANDIDATE_MAX=1000
export DISPATCH_SCORE_POOL_MIN=80
export DISPATCH_SCORE_POOL_MAX=280
export QUEUE_WORKER_INTERVAL_MS=1000
export QUEUE_WORKER_BATCH_SIZE_PER_REGION=10
export QUEUE_WORKER_MAX_REGIONS_PER_ITERATION=50
export ENABLE_METRICS=true
export LOG_LEVEL=info
# Never load a .env file (it could carry real keys).
export ENV_FILE=/dev/null
unset WOOVI_API_TOKEN WOOVI_MASTER_API_TOKEN GOOGLE_MAPS_API_KEY GOOGLE_PLACES_API_KEY SENTRY_DSN \
  FIREBASE_SERVICE_ACCOUNT_JSON GOOGLE_APPLICATION_CREDENTIALS_JSON
