# Prototype iOS + Backend Validation Report (2026-03-18)

## Scope
Validate iOS Simulator runtime (dev client), backend connectivity, and end-to-end trip flow viability for the Robotaxi prototype.

## Environment
- Date: 2026-03-18
- Workspace: `/Users/izaakdias/Documents/Leaf-new`
- iOS Simulator: `iPhone 16e` (Booted)
- App bundle: `br.com.leaf.ride`
- Xcode: `26.3 (17C529)`
- Backend target: `http://147.182.204.181:3001`

## Executed Checks
1. Backend health endpoint (`/health`)
2. Backend API health endpoint (`/api/health`)
3. Socket.IO handshake (direct websocket client)
4. Runtime endpoint hardcode scan (`mobile-app/scripts/check-runtime-endpoints.sh`)
5. iOS app boot via Metro dev-client + simulator launch
6. Metro runtime logs inspection (API/WS config + connection)
7. Full backend flow simulation (non-Maestro):
   - Firebase sign-in (passenger + driver)
   - websocket auth
   - nearby drivers API and websocket search
   - createBooking
   - confirmPayment
   - ride accept/start/complete
8. Expo doctor (`npx expo-doctor`)
9. Backend local e2e suites (`test:e2e:passenger`, `test:e2e:driver`) as infrastructure sanity check

## Evidence
- E2E simulation JSON:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/qa-sim-ride-ios-20260318_165215.json`
- iOS simulator screenshot:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/ios-simulator-validation-20260318_165818.png`

## Results Summary
- **PASS** Backend `/health` reachable (status `warning` due Redis latency only).
- **PASS** Socket.IO handshake successful on `websocket` transport.
- **PASS** Runtime endpoint scan: no localhost/127.0.0.1 hardcodes in runtime code.
- **PASS** iOS app bundled and launched from Metro dev client.
- **PASS** App logs show:
  - API URL configured to `http://147.182.204.181:3001`
  - WebSocket connected with socket id
  - Woovi base URL configured to backend host
- **PASS** Full non-Maestro backend flow simulation finished with `ok: true` and all stages green.

## Notable Warnings / Risks
1. **CocoaPods missing locally**
   - `npx expo-doctor` failed 1 check: native tooling / CocoaPods not installed.
   - `pod --version` not found.
   - Impact: local native iOS build/archive from this machine may fail until CocoaPods is installed.
2. **Backend health warning (Redis latency)**
   - `/health` reports Redis as `warning` (slow response). Functional, but monitor before wider rollout.
3. **React Native Firebase deprecation warnings**
   - Namespaced API warnings (`ref`, `getApp`, `onAuthStateChanged`, etc.).
   - Non-blocking for now, but technical debt for future SDK upgrades.
4. **Local backend e2e tests failed in this machine context**
   - `test:e2e:passenger` and `test:e2e:driver` failed due local Redis stack unavailable (`localhost:6380`), not due remote backend outage.
   - These failures are environment/infrastructure related to local test harness.

## Go/No-Go Assessment
- **GO (conditional) for physical-device testing of the prototype runtime**:
  - Runtime connectivity and core trip lifecycle against backend are validated.
  - App runs in iOS simulator with active backend connections.
- **NO-GO for local iOS build pipeline on this machine right now** until CocoaPods is installed.

## Recommended Next Steps (before broad device rollout)
1. Install/update CocoaPods (`>= 1.15.2`) and rerun `npx expo-doctor`.
2. Keep monitoring Redis latency on backend health; stabilize before scale tests.
3. Run one manual physical-device smoke:
   - login
   - destination selection
   - PIX modal open
   - booking->accepted->in-trip->completed
4. Optional: enable local Redis test stack if you want local `npm run test:e2e:*` to be part of CI gate.
