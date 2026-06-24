# Production Readiness Core Audit - 2026-06-21

## Objective

Close the Leaf P0 production-readiness loop for the passenger and driver ride cycle without relying on false-positive smoke runs.

This audit is the internal to-do and acceptance record for the current release line. It joins mobile UI state, backend lifecycle enforcement, payment sandbox policy, financial reconciliation, dashboard evidence, KYC/document readiness, support, chat, route rendering, and real-device smoke evidence.

## Hard Rules

- A paid ride cannot exist without a backend-confirmed eligible driver in the same operational area.
- Geofence must block before quote/payment, never after Pix confirmation.
- Pix sandbox is selected by backend/user policy for test users. The app must not require a new build to switch the whole environment to sandbox.
- Payment is confirmed before dispatch and before the ride starts.
- Fare is immutable through quote, payment, ride, receipt, dashboard, ledger, and driver net projection.
- Passenger surfaces show gross fare. Driver surfaces show driver net where appropriate.
- Operational fees, Woovi fees, tolls, pass-throughs, withdrawals, and refunds remain explicit and ledger-backed.
- Active ride state is canonical. Map tap, backdrop, drag, back navigation, relaunch, or socket reconnect must not regress the user to a previous state or to map-only.
- Completion is terminal. After receipt/rating, the passenger returns to a clean map and must not rehydrate the completed ride as active.
- Route preview and active trip map cannot show a synthetic straight line when provider/backend route is required.
- Any bottomsheet over a route must publish its occluded height to the map viewport so the route remains visible and manipulable above the sheet.
- Socket.IO is the normal state transport. Polling loops are not an acceptable production substitute for lifecycle state.

## 2026-06-24 Backend/Mobile Closure Addendum

Status: focused local validation passed. Real Android smoke, backend deploy, OTA, and store/internal build actions remain gated by explicit human authorization.

Closed in this round:

- Driver completion receipt now consumes the backend-final completion result before navigation, carrying `viewerRole`, `receiptRole`, `driverId`, `passengerId`, and the authoritative receipt payload.
- Passenger protected active-trip state now fails visible when canonical ride/driver identity is missing; it no longer renders fake driver/vehicle identity or exposes active ride actions while hydration is incomplete.
- No-driver terminal search for a paid ride now attempts canonical `processRideRefund` before terminalizing and exposes refund status/ledger evidence instead of silently canceling.
- Cancellation refund paths now use `processRideRefund`; direct provider refund calls were removed from socket and command cancellation flows.
- Refund ledger failure no longer reports false `ledgerRecorded: true`; `ride_payments` records `refundLedgerStatus=recorded|pending` and the ledger error when pending.
- Advance payment intent consumption is now transaction-backed and idempotent for the same booking; an intent consumed by another booking cannot be overwritten.
- Quick driver approval is audit-only unless canonical evidence is complete. It no longer writes KYC/liveness/background/doc approval fields and no longer unblocks a driver by itself.
- Generic `support` remains allowed for read/support work but is removed from high-risk dashboard/user/ops mutations; manager/admin/development roles are required.
- Dashboard JWT role/permission authorization now hydrates from the current admin record instead of stale token claims.
- `reportIncident` severity is now server-classified. App users cannot inflate an ordinary report to critical by sending `severity=critical`; emergency language still promotes severity server-side.
- Driver activation document signed URLs now use a short configurable TTL (`DRIVER_DOCUMENT_SIGNED_URL_TTL_MS`, default 24h) and persist `fileUrlExpiresAt`; the previous `2035-01-01` URL is gone.
- Final receipts now expose toll/pass-through explicitly as `tollPassThrough` and `driverTollPassThrough` without changing passenger gross or recalculating the backend-final financial contract.
- Active route and destination sheets are bounded by the visible map frame; route padding uses measured occlusion so route geometry is not treated as visible behind the bottomsheet.
- CRLV color/model/plate normalization remains enforced before approval; missing color/model fails the document instead of approving a partial vehicle identity.

Focused evidence from this round:

- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 144 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-ride-screens.test.js` passed with 2 suites / 149 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/active-route-viewport-contract.test.js __tests__/prototype-route-viewport.test.js __tests__/destination-quote-recalculation.test.js __tests__/prototype-payment-availability.test.js` passed with 4 suites / 41 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/payment-service.payment-status-cache.unit.test.js` passed with 1 suite / 43 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/gradual-radius-expander.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js` passed earlier in the same local validation line with the no-driver refund/refund-ledger coverage.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/commands/CancelRideCommand.unit.test.js tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/bootstrap/register-socket-trip-integrity-handlers.unit.test.js` passed with 3 suites / 8 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/driver-activation-state-service.unit.test.js tests/unit/routes/dashboard-driver-quick-approval-boundary.unit.test.js tests/unit/routes/user-management-routes.unit.test.js tests/unit/routes/ops-mutation-role-boundary.unit.test.js tests/unit/middleware/jwt-auth-current-role.unit.test.js` passed with 5 suites / 19 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-safety-support-handlers.unit.test.js tests/unit/services/support-severity-classifier.unit.test.js` passed with 2 suites / 16 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/receipt-service.unit.test.js tests/unit/services/ride-financial-contract.unit.test.js` passed with 2 suites / 26 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/driver-activation-routes.unit.test.js tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js` passed with 2 suites / 5 tests.

Remaining hard gates before production:

- Real Android L2 smoke with passenger and driver available in the same region, sandbox Woovi approval, route evidence, payment confirmation, accepted/start/complete, rating, receipt, dashboard reconciliation, and backend event trace.
- Backend deploy validation after local tests, then OTA only for JS/runtime-compatible mobile changes. Native build only if runtime/native config requires it.
- KYC/face compare provider evidence in strict mode; local warning-only KYC is not production proof.
- Persistent document-analysis worker/recovery remains a residual architecture item: current upload persists `in_review` plus `filePath`, but true restart recovery requires a durable queue/worker that reloads the PDF from Storage and claims jobs idempotently.

## Current Evidence Baseline

| Area | Current status | Evidence found | Production gate |
| --- | --- | --- | --- |
| Active passenger sheet cannot passively dismiss | Protected | `prototype-ride-screens` tests assert `backdropDismissEnabled=false`, `dragEnabled=false`, and no navigation regression for `accepted`, `arrived`, `started`. | Keep in every mobile unit run and repeat with ADB taps in L2 smoke. |
| Canonical lifecycle navigation cannot passively remove a paid/active ride | Protected in focused mobile tests, pending device proof | `RobotaxiPaymentSuccessScreen`, `RobotaxiDriverSearchScreen`, `RobotaxiDriverOfferScreen`, `RobotaxiTripScreen`, and `RobotaxiDriverTripScreen` now subscribe to `beforeRemove` while their lifecycle is protected. Passive Android back/pop and restored navigation are prevented. Payment/search/offer release only the expected canonical replacement after the acknowledged flow; active trip has no passive removal path. Production/review release policy now also blocks `EXPO_PUBLIC_FORCE_LEGACY_MAP_UI`, so `Map`/`MapScreen`/`TabRoot` cannot silently opt out to the legacy map flow in release builds. A static navigation guard now proves the Robotaxi branch does not register legacy ride/payment routes such as `BookedCab`, `TripTracking`, `RideDetails`, `PaymentDetails`, `PixPayment`, or `DriverSearch`; those remain isolated to the legacy branch. Deep link and FCM push entrypoints are also guarded: app linking cannot publish legacy ride/payment route keys, the FCM allowlist/aliases stay on Robotaxi route names, and known legacy push `screen` names are mapped by notification type to canonical Robotaxi routes. | L2 must press Android back and perform map/sheet taps at payment confirmed, searching, offer, accepted, arrived, started, operational continuation, and push/deep-link entrypoints. |
| Lifecycle event ownership and terminal closure | Protected in mobile and modular backend tests, pending L2 replay proof | Mobile lifecycle guard rejects events for another active booking, normalizes both `canceled` and `cancelled`, preserves terminal completion/cancellation after receipt/rating, accepts only explicit operational reassignment branches, and ignores stale boarding-window expiry after trip start. Runtime no longer clears the terminal lifecycle dedupe key when the receipt/rating cycle is dismissed, so repeated late events for the same completed ride cannot become a fresh visible transition. Backend terminal handling is now centralized in `RideStateManager` and covers `COMPLETE/COMPLETED/CANCELED/CANCELLED`, no-driver, rejected/expired/superseded, and alternate closure states (`EARLY_ENDED_BY_RIDER`, `INTERRUPTED_OPERATIONAL_ENDED`, `EARLY_ENDED_REVIEW`). `activeRideSync` clears stale active indexes, emits `bookingId:null` with terminal metadata instead of an active booking payload, and never sends terminal rides through expired-search reconciliation; dispatch, radius expansion, driver locks, and late driver responses use the same terminal contract. Legacy active-ride socket commands (`reportProblem`, `calculatePartialPayment`, `findNewDriver`, `changeDestination`) now validate authenticated ride participant scope and canonical terminal status before any mutation; if `booking:{id}` is terminal, the stale `bookings:active` entry is removed and the command returns a terminal error instead of recalculating or reopening the ride. Modular `cancelRide` verifies passenger/driver scope before idempotency or persistence, the command validates the actor again, and Firestore is updated only after the canonical cancellation succeeds. System trip-integrity cancellation remains a narrowly named exception during an active trip. `check:no-active-vps-runtime` confirms modular `server.js` is the configured runtime. | L2 must replay delayed `tripCompleted`, `rideCancelled`, `activeRideSync`, legacy active-ride commands, and boarding expiry events around rating/relaunch to prove no visible regression. |
| Paid driver offer cannot passively dismiss | Protected | `RobotaxiDriverOfferScreen` disables backdrop dismissal and drag while an offer is visible, so the driver must explicitly accept, reject, or let the server/timeout remove the offer. `prototype-ride-screens` asserts the backdrop is inert and does not call navigation or rejection. | Real L2 smoke must prove a paid offer cannot disappear from a stray map/sheet tap before driver decision. |
| Completed passenger trip moves to receipt | Protected | `prototype-ride-screens` asserts completed trip replaces route with `RobotaxiPrototypeReceipt`. `driver-online-toggle` now asserts Home auto-routes `completed` to receipt through `replace` even before receipt hydration. It also covers terminal receipt hydration guards: when the receipt opens from a completed trip without a selected receipt, or with a receipt id but no final gross fare snapshot, the UI shows explicit synchronization/recovery copy, attempts runtime/API recovery, keeps rating disabled, avoids fabricated `R$ 0,00`, and can return to a clean map without re-locking the ride. | Real smoke must prove no active-trip rehydration after receipt/rating/relaunch. |
| Rating returns passenger to map | Protected in mobile and backend | `prototype-ride-screens` asserts successful passenger rating calls `dismissCompletedReceipt` and replaces the stack with `RobotaxiPrototype`, so back navigation cannot regress into rating/receipt. The backend now requires an authenticated canonical booking scope in `COMPLETED`, derives the reviewer/target from that scope, and reserves `rating_trip_index/{trip}/{reviewer}` with an RTDB transaction before fan-out. Duplicate submissions replay the persisted rating rather than creating another record. | Real smoke must capture one successful rating, a retry/reconnect replay, and the clean map after submit. |
| Active trip map viewport above bottomsheet | Protected in focused unit tests, pending device proof | `prototypeRouteViewport` now derives camera span from the measured map width/height and the actual exposed rectangle after top/bottom/side padding, not from the full canvas hidden by the sheet. The utility exposes `buildVisibleRouteViewportFrame`, making the usable map frame explicit (`top`, `left`, `right`, `bottom`, width/height, and effective insets) before route projection. `RobotaxiTripScreen`, active `RobotaxiHomeScreen`, `RobotaxiDriverOfferScreen`, and the dedicated `RobotaxiDriverTripScreen` pass route viewport padding and an explicit route region. Driver offer and driver in-trip screens now subscribe to the map `onLayout`, so the route camera is recalculated from the real rendered map area instead of assuming `windowHeight/windowWidth`. The driver in-trip surface mounts the map, including canonical route, traffic segments, and route progress in the started state. The padding contract prioritizes the measured bottomsheet occlusion over the ideal `minVisibleHeight`; it may compress visible height on small screens, but it no longer claims that covered map pixels are usable. `prototype-route-viewport` proves long vertical and horizontal routes stay inside the exposed rectangle/frame; `prototype-map-layer-viewport`, `prototype-ride-screens`, and `driver-online-toggle` cover the screen/map handoff. | Real Android must prove pan/zoom/tap do not collapse sheet or hide route, with screenshot/XML evidence. |
| Map manipulation during active trip | Protected by props and lifecycle gates | `prototype-ride-screens` asserts active passenger and driver trip maps have scroll, zoom, rotate enabled where the live map is intended to be manipulable. `driver-online-toggle` now proves focused active-ride Home maps stay interactive for passenger and driver, while hidden Home under Trip overlay stays non-interactive. Active trip sheets remain non-dismissible, so map manipulation cannot regress to map-only. | Real device must prove pan/zoom/tap do not collapse sheet or hide route. |
| Payment blocked when no driver is available | Backend guard implemented, real smoke pending | `payment-driver-availability-guard` and `create-booking-availability-precheck` exist with focused unit tests. `/api/payment/advance` checks eligible driver before creating Pix. The modular `createBooking` socket handler now uses the same availability precheck synchronously before `RequestRideCommand`, matching the VPS runtime, so a paid request cannot become an active/zombie search when no eligible driver is visible at booking materialization time. The passenger payment screen also routes `autoOpenPix` through the same availability gate before the Woovi modal can appear, preserving backend/geofence messages instead of opening Pix directly. Socket confirmation is guarded in production by provider-backed evidence. | L2 preflight must prove driver readiness before payment; no-driver path must be tested separately on device/backend to verify product copy and cleanup/refund handling. |
| Paid passenger search cannot blank or advance early during transient hydration | Protected in focused unit tests, pending device proof | `RobotaxiDriverSearchScreen` now treats paid/active booking evidence as a reconciliation state when runtime briefly hydrates as `idle` without an error. The search UI remains visible, cancel is disabled while status is non-canonical, support keeps the rendered booking id, and the screen does not navigate back to the map or a terminal route without backend evidence. Passenger routing and runtime normalization keep pre-accept driver notification states (`NOTIFIED`, `AWAITING_RESPONSE`, `DRIVER_NOTIFIED`, `OFFER_SENT`, and equivalents) on the search surface; driver metadata alone cannot promote the passenger into the accepted/driver-on-way trip screen. `prototype-ride-screens` covers confirmed payment plus active booking during transient `idle` and pre-accept driver metadata. | Real Android smoke must prove confirmed payment plus reconnect/relaunch cannot become blank, map-only, or driver-on-way before an accepted event. |
| Driver availability before smoke | Runner guard implemented, real proof pending | `CANONICAL_SMOKE_TEST_DIRECTIVES.md` blocks `driver_unavailable`. `android-real-device-smoke` now maps canonical pickup availability failure to `blocked_precondition:driver_unavailable` before tapping payment confirmation, and a unit contract proves readiness is checked before payment opening. | Real smoke must still capture the preflight/pass state with the actual connected Android and an eligible driver. |
| Sandbox payment by backend/user flag | Directive present | Canonical directives require backend policy and sandbox canary before Pix. | Runtime canary must show sandbox profile for passenger before payment screen opens. |
| Woovi webhook signature verifier | Verified locally and against current provider documentation | `config/woovi-webhook-public-key.js` contains the current Woovi public key used to verify `x-webhook-signature`; `config:validate` enforces signatures in production and reports the bundled verifier as `default-public`. The provider documentation published in June 2026 shows the same Base64 key and RSA verification model. | Preserve the signature-required flags and repeat one real signed webhook evidence check before release closure. |
| Fare consistency | Quote-to-Pix lock, extension fare authority guard, ledger-before-dispatch, backend-final receipt guard, dashboard no-estimate guard, and financial-policy approval guard implemented; full L2 reconciliation pending | `/pricing/quote` now persists a Redis quote lock with TTL/route/category/value signature, `/api/payment/advance` validates it before creating Pix, and mobile forwards `quoteLockId`. The passenger payment screen and `WooviPaymentModal` now also fail closed before opening/creating Pix when the locked quote is missing or expired, so the user sees a recalculation message instead of generating a backend-rejected charge. The shared legacy Pix adapter `paymentService.createPixCharge` also fails closed before calling `/api/payment/advance` when no `quoteLockId` is present, covering residual `PixPayment*` callers that still import the canonical payment service. Active-trip destination extension now recalculates a backend fare estimate in `RequestRideExtensionCommand`, blocks client `newFare` divergence, persists `fareAuthority=backend_extension_estimate`, and prevents driver acceptance from generating Pix when the pending extension lacks backend fare authority. The mobile extension flow no longer displays/sends the local plan fare as an interim value: it waits for backend quote, blocks submission without it, forwards route metrics and quote metadata, and no longer calls legacy `changeDestination` before `requestRideExtension`. Payment confirmation now moves to non-dispatchable `ledger_pending` when posting `payment_received` fails. Receipt generation now rejects final receipts unless the ride has an authoritative `backend_final` financial snapshot with gross, Leaf fee, Woovi fee, and driver net. Dashboard recent-ride, current metrics, marketplace metrics, map-region totals, legacy comprehensive reports, and driver earnings no longer fall back to `fare/estimatedFare/estimate`, `estimate * 0.85`, or raw `driver_share` for completed rides without `backend_final`; they mark reconciliation pending or return zero-value financials while preserving operational ride counts. The active runtime financial policy now exposes `policyId=runtime_tiered_percent_above_50_v1`, and production config validation blocks payment runtimes unless `LEAF_APPROVED_FINANCIAL_POLICY_ID` matches that code policy and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` is present. Focused backend/mobile units cover quote lock, legacy Pix quote-lock fail-closed, Pix amount mismatch, locked metadata propagation, extension fare divergence, dispatch block on pending ledger, receipt rejection for incomplete snapshots, dashboard completed-ride estimate suppression, current metrics exclusion of incomplete snapshots, and financial-policy approval gating. | One L2 run must still reconcile quote gross, extension complement gross if destination changes, payment gross, receipt gross, dashboard gross, Leaf fee, Woovi fee, tolls/pass-throughs, driver net, and the approved policy id used for that run. |
| Route/polyline uniqueness | Focused guards implemented, device route proof pending | Canonical directives forbid straight fallback route as final preview and require traffic coloring when backend route traffic data exists. Destination quote flow publishes route preview as real-route-only (`allowFallback=false`), `prototypeMapRoute` clears stale routes instead of reusing synthetic fallback, Home passes traffic segments/colors plus explicit `routeSynthetic`/`routeSource` provenance, and `PrototypeMapLayer` no longer renders the first two route points as a partial line while animation waits for its first frame. It also no longer infers a synthetic route merely because a real route has few points. Active passenger and driver trip maps keep framing on driver/pickup/destination points but do not publish synthetic live `routeCoordinates` while waiting for canonical route geometry. Driver offer maps no longer fabricate a `[driver, pickup]` polyline when no canonical pickup route is present; they frame the markers without drawing a false route. Driver live route plans preserve pickup/destination traffic segments, the backend update-location sanitizer no longer discards them, and the passenger/driver trip maps forward traffic segments for colored route rendering. | Dedicated route smoke with chosen Rio route must capture first render and final render without straight-line flash and with traffic colors when backend returns segment/timing data. |
| Vehicle identity and color from CRLV | Protected in backend, dashboard projection, and mobile activation | The document-analysis queue normalizes CRLV plate/model/year/color before persistence, strips raw document artifacts, writes the same structured value to both `analysisData` and dashboard-facing `extractedData`, recomputes the activation snapshot, and synchronizes the dashboard projection. The activation snapshot exposes CRLV identity as document-derived while preserving the separate requirement for an approved active vehicle before online/dispatch. `RobotaxiDriverActivationScreen` now displays canonical active/CRLV vehicle identity instead of the previous hardcoded label. | Real signup/document smoke must prove the same model, plate, color, and provenance across activation, approved active vehicle, accepted trip, receipt, and dashboard. |
| Accepted passenger vehicle identity | Protected by fallback fields, must be real-backed | `RobotaxiTripScreen` resolves model, plate, and color from route params, driver info, active booking, and driver active ride. Receipt tests cover model/color/plate. | L2 smoke must prove accepted screen, receipt, and dashboard show the same canonical vehicle identity. |
| Cadastro/onboarding coverage | Android release-flow ready, iOS execution pending | `qa-flow-inventory.json` now recognizes Android release-safe passenger signup and driver signup/document flows. The previous dev-server/Metro markers were removed from the real Android flows, and a focused unit contract prevents them from coming back. | Execute Android evidence on a release/store build and add iOS release-safe signup/document evidence. |
| Login | Covered | Flow inventory marks login GO. | Keep in `run-core-audit-suite.sh`. |
| Driver online | Covered with precondition caveat | Flow inventory marks driver online GO. | Driver must be online and dispatch-eligible before passenger request/payment. |
| Chat in active ride | Backend/mobile guards implemented, L2 role evidence pending | Ride chat Socket.IO derives sender/receptor from authenticated socket identity plus ride participant scope, not payload `senderId/senderType/receiverId`. The canonical handler now owns message history and read acknowledgements too; production does not rely on the disabled legacy bridge. It allows history only to ride participants, marks only messages addressed to the reader, requires Firestore persistence before acknowledgement/delivery, and keeps completed/canceled policy restrictions. Mobile registers socket listeners before emitting chat operations, correlates replies by chat id, forwards an optimistic client message id, and renders failures explicitly instead of a false empty history. | Add real passenger-to-driver and driver-to-passenger chat evidence in L2 smoke, including history reload, read receipt, denied scope, and visible backend error. |
| Support and orchestrator | Backend classifier/queue, mobile ride scope, fail-visible mobile loading, dashboard local guards, and dashboard freshness guard implemented; real operator evidence pending | Support chat Socket.IO now lets normal users write only to their own chat and lets support/admin actors target a user only as `agent`. Support ticket creation now runs through a backend severity classifier before queueing: safety/emergency language becomes `N1`, payment/refund/stuck-flow language becomes at least `N2`, app-user priority inflation is ignored, and trusted operator/system sources may preserve stricter priority. Queue SLA metadata is based on the effective priority. Socket incident/report/ticket paths now validate ride participant scope before linking a `bookingId`, so a user cannot mark another active ride for ops review. Mobile ride/support entry points now pass the active `bookingId`, `source`, and lifecycle status into incident reports, support tickets, complaints, chat handoff, and receipt help. Mobile socket calls now listen to backend error events instead of hanging until timeout. Mobile support ticket/message loaders and `SupportChatService` now propagate backend failures instead of converting them into successful empty lists, and `SupportScreen` renders a visible ticket/chat error state instead of a false empty inbox. The dashboard support inbox and ticket panel now surface backend `supportClassification` priority/severity/source/reasons instead of hiding it only in the technical payload. The dashboard support header/operation panel now exposes data freshness from ticket, N0 inbox, and active message reads as updated/stale/error instead of silently relying on polling. `qa:backoffice` validates classified N2 evidence plus freshness status with local fixtures and no paid provider calls. | Run support ticket, chat, severity classification, escalation, dashboard freshness, and operator evidence with a real support actor. |
| Dashboard user management | Current Next dashboard QA passed, live L2 reconciliation pending | `leaf-dashboard-js` is the active dashboard. `qa:backoffice` runs lint, production build, and Playwright smoke against the Next app, requires `data-leaf-dashboard-generation="current-next"` on every checked route, validates core routes, current financial fields, support freshness, runtime flags, and blocks direct browser calls to Google/Woovi/OpenPix/Firebase providers. Legacy `scripts/maintenance/dashboard-server.js` remains maintenance/static only and is not accepted as product dashboard QA evidence. | Reconcile the same live ride id from L2 smoke across dashboard, receipt, ledger, and app surfaces. |
| KYC and face compare | Backend online/dispatch guard implemented, provider flow evidence pending | AWS liveness and Leaf face compare services/tests exist. Driver eligibility now fails closed through the canonical activation state before online/dispatch eligibility: KYC pending/manual-review/rejected, rejected documents, missing activation state, and unavailable activation reads block the dispatch pool. Existing config validation warning says KYC strict production is not fully clean. | Only KYC warning may remain; Firebase/Google warnings must be clean. Execute KYC happy path, mismatch/manual-review, retry, and provider-backed face compare/liveness evidence before go-live. |
| Offline/local fallback | Snapshot, backend intent guard, offline active UI, terminal cleanup, location batch flush, stale driver signal monitoring, and backoffice stale-signal visibility implemented; device evidence pending | `docs/OFFLINE_FALLBACK_RIDE_FLOW_STUDY.md` defines an executable backlog for local ride snapshots, ride-event outbox, backend idempotency/order validation, offline active-ride UI, reconnection cleanup, location-buffer flushing, heartbeat loss, support playbook, and dashboard telemetry. `RideLocalSnapshotService` now persists canonical ride snapshots for passenger/driver scope, rejects regressions by lifecycle/version/server timestamp, recognizes terminal no-driver/rejected states, and strips fee/net fields unless the financial snapshot is backend-final. `ride-offline-intent-validator` now protects outbox/offline lifecycle intents for arrival, start, completion, and cancellation with participant scope, state policy, idempotency fingerprint, client sequence, terminal ride blocking, and canonical replay storage. Mobile replay now forwards outbox metadata (`offlineIntent`, `source`, `eventType`, `clientSequence`, `clientCreatedAt`) into lifecycle socket commands, active trip screens show protected sync/last-known state instead of falling to map-only, app relaunch of an active persisted session starts as offline/last-known until socket reconciliation, and terminal/no-driver/authoritative clear sync rejects pending local intents plus clears incompatible local snapshots. `LocationBufferService` now flushes offline driver GPS points in ordered batches with active trip context, while backend `updateLocationBatch` applies the same eligibility/policy checks, sequence/dedupe handling, passenger stream emission, route-plan traffic preservation, and accepted/rejected ACK accounting. Passenger runtime now surfaces stale driver signal as last-known location without synthetic movement, backend `ride-health-monitor` emits `driver_signal_stale` alerts from the active driver signal index without canceling/finalizing rides, `/ops/alerts` aggregates that alert, and the current dashboard `/observability` renders stale driver signal counts plus affected booking evidence in smoke. | Run Android airplane-mode/reconnect smoke and add provider/device evidence for offline intents before treating offline resilience as production-ready. |

## Independent Audit Findings

These findings came from independent mobile, backend finance, and auxiliary-domain audits run against the current dirty worktree. They are not all fixed by the current patch; they are now part of the production readiness queue.

### Post-Audit Corrections - 2026-06-23

- Map camera: when a screen supplies an explicit route viewport region already calculated around the bottomsheet, `PrototypeMapLayer` now clears native `mapPadding`. Google Maps no longer receives the occlusion offset twice. The padding remains active only for the coordinate-fit fallback path.
- Mobile lifecycle: `tripCompleted` now passes through the booking-scoped monotonic lifecycle guard before it can clear active ride state. A delayed completion for another booking cannot close or replace the ride currently in progress.
- Registration contract: mobile onboarding now sends only mutable account profile fields. It no longer attempts to write approval, KYC, vehicle, activation, or document fields that the backend correctly rejects. A failed authoritative profile write keeps onboarding incomplete with a visible retry path.
- Safety/support: socket incident, emergency, and ticket actions require an authenticated identity even when they are not linked to a booking. They cannot use a transient socket id as an actor identity.
- Ride chat: a client retry id is now deterministically scoped by conversation and authenticated sender before Firestore persistence, preserving retry idempotency without allowing cross-conversation or cross-user document-id collisions.
- Backend test isolation: the withdrawal-password route test now provides the complete logger contract required by the Redis pool it loads. This restored the full backend unit suite instead of leaving one route suite unable to boot.
- Canonical route selection: the Robotaxi lifecycle is now the error fallback when its local feature flag cannot load. The legacy map can still be selected only through the explicit `EXPO_PUBLIC_FORCE_LEGACY_MAP_UI=true` runtime opt-out.
- Legacy support surface: a failed support-chat history request now propagates to `SupportScreen`, which shows its existing visible error state instead of presenting an empty conversation as success.
- Lifecycle navigation: sheet configuration is no longer the only protection against state regression. The paid passenger progression (`payment confirmed -> search`) and driver offer now reject passive `beforeRemove` actions, allowing only the exact acknowledged canonical exit. Passenger and driver active-trip screens block all passive removals while a trip is active, including Android hardware back and restored navigation actions.
- Driver terminal stack: a completed driver trip now replaces its active-trip route with `RobotaxiPrototypeReceipt`, matching the passenger terminal flow and preventing a back action from reopening the completed trip surface.
- Financial provenance: a fee-bearing socket or recovered receipt payload is no longer enough to render a final amount, enable rating, or label a driver payout. Mobile accepts terminal financial values only with `authoritativeSnapshot=true` and `financialSnapshotSource=backend_final`; otherwise it keeps the receipt in explicit reconciliation and avoids fabricated currency values. Stored receipt recovery preserves the backend provenance metadata instead of inferring it from the presence of fees.
- Financial dashboard: absent or invalid payment/distribution totals now render as `--` and make holding/split checklist items require attention. They can no longer become `R$ 0,00` or a healthy reconciliation merely because an undefined value was coerced to zero.
- Financial earnings reports: daily rollups and the active driver earnings route now accept completed-ride amounts only from a validated `backend_final` financial snapshot. Completed rides with only `estimate`, `finalFare`, raw `driver_share`, or mutable fee fields are excluded from financial totals and marked as reconciliation pending instead of being locally recalculated. Focused backend units cover daily earnings, ops telemetry, ledger, financial contract, and driver earnings route behavior.
- Accepted-driver recovery: a driver disconnect before boarding still uses the existing `SEARCHING` queue state internally, but now persists and emits `REASSIGNMENT_PENDING` with `accepted_driver_reassignment` metadata, operational continuation context, and an immediate `activeRideSync`. Passenger runtime maps that branch to `searching_replacement` until a replacement driver advances the ride; ordinary backward transitions remain rejected. Driver runtime now renders a locked, non-actionable operational holding surface instead of `Nenhuma corrida ativa` while the server awaits the passenger decision or releases the driver.
- Driver activation: the app no longer simulates facial approval or marks background consent locally. It opens the canonical KYC path and hydrates only remote liveness evidence; the empty activation snapshot is stable, avoiding the render loop that could exhaust the app while status was loading.
- Driver approval: mass application approval/rejection is disabled in dashboard UI and backend (`410`). Individual document review only recomputes canonical activation. The retained audited quick-approval route emits an unlock event only when the canonical result returns `canGoOnline=true`; its manual-override policy remains a product decision, not normal approval evidence.
- Driver suspension: compatibility endpoints now delegate to canonical operational-status management, which persists both data stores, clears driver Redis eligibility, records the operator audit trail, and never reactivates a non-approved driver as approved.
- Legacy active-ride socket guard: direct `bookings:active` commands now require ride participant scope and canonical non-terminal state before report, partial-payment estimate, new-driver reassignment, or destination-change mutation. Terminal canonical bookings clear the stale active hash and return a structured terminal error.

### Post-Audit Corrections - 2026-06-24

- Lifecycle surface contract: mobile now has a canonical passenger/driver lifecycle surface matrix that maps every normalized ride status to the only allowed screen/surface and required QA test ids. Passenger payment success, search, and no-driver screens now route through this matrix instead of local string lists, so operational interruption/replacement aliases remain on the protected trip surface and pre-accept aliases remain on protected search.
- Driver active surface normalization: `RobotaxiHomeScreen` and `DriverLiveRideOverlay` now normalize backend aliases such as `driver_accepted`, `arrived_at_pickup`, and `trip_started` before deciding live-map state, sheet actions, cancellation/navigation buttons, or map interactivity. Active operational interruption and replacement search also remain live-trip map states instead of falling through to an inactive map.
- Validation run: `node --check` passed for the touched lifecycle files. Focused mobile unit tests passed for `ride-lifecycle-surface-matrix`, `passenger-flow-routing`, `ride-lifecycle-state-guard`, `driver-live-ride-overlay`, `prototype-ride-screens`, and `driver-online-toggle` on branch `codex/production-readiness-audit`.
- Active route viewport contract: a static mobile guard now requires every active route surface (`RobotaxiTripScreen`, `RobotaxiDriverTripScreen`, `RobotaxiDriverOfferScreen`, and active `RobotaxiHomeScreen`) to keep `buildVisibleRouteEdgePadding`, `buildRouteViewportRegion`, `viewportPadding`, `routeViewportRegion`, and `forceRegionUpdate` wired into `PrototypeMapLayer`. The focused viewport run passed for `active-route-viewport-contract`, `prototype-route-viewport`, and `prototype-map-layer-viewport`.
- Pix amount fail-closed: `WooviPaymentModal` no longer falls back to a hardcoded payment amount when a `quoteLockId` exists but the locked quote amount is missing. It fails before backend Pix creation with recalculation copy. Focused payment tests passed for `woovi-payment-modal`, `prototype-payment-availability`, and `payment-service-quote-lock`.
- Operational route viewport proof: `prototype-ride-screens` now proves the active passenger map remains interactive and fitted above the sheet for `operational_interrupted` and `searching_replacement`, and proves the active driver trip route viewport recalculates from the measured map layout for those same operational states.
- Driver assist alias normalization: `buildDriverTripAssistModel` now normalizes backend lifecycle aliases before deciding pickup/destination navigation phase and primary driver actions. The focused guard `driver-trip-assist-contract` plus `driver-online-toggle` and `driver-live-ride-overlay` passed.
- Dashboard financial fallback sanitization: legacy dashboard stats, revenue, cost, city, and growth handlers now use `resolveRideRevenue(...)` instead of directly summing mutable `customer_paid`, `fare`, or `estimate` fields. Completed rides without an authoritative `backend_final` financial snapshot now contribute zero to those legacy aggregates, matching current metrics/reconciliation behavior instead of surfacing stale quote estimates as money evidence. `dashboard-financial-route-guards.unit.test.js` fails if the audited handlers return to direct mutable fare aggregation. Focused backend validation passed for `dashboard-financial-route-guards`, `metrics-financial-routes`, `dashboard-ride-monitoring-service`, and `financial-ledger-service` with 4 suites / 28 tests, and `git diff --check` passed.
- KYC operational availability fail-closed: `kyc-driver-status-service` no longer treats Redis/Firestore read failure as "not blocked" and `canDriverWork` no longer permits work on KYC validation errors. `DriverPoolMonitor` now removes the driver from availability when KYC validation throws instead of continuing with lock/status checks. Focused backend validation passed for `kyc-driver-status-service`, `driver-pool-monitor`, `driver-eligibility-service`, `driver-activation-state-service`, `kyc-onboarding-routes`, and `driver-approval-routes` with 6 suites / 19 tests.
- Support queue read-only default: `support-queue-service` and `ops-overview-service` no longer auto-escalate tickets during normal backlog/summary/overview reads. Escalation remains available only through explicit `autoEscalate=true` opt-in or manual agent action, avoiding hidden mutations during dashboard/metrics polling. Focused backend validation passed for support queue, ops overview, engagement chat, safety/support sockets, rating sockets, rating lifecycle, receipt service, and receipt routes with 8 suites / 42 tests.
- Mobile support chat scope split: general support and general ticket follow-up without `bookingId` now route to the Support center chat instead of opening the ride-scoped prototype chat, while trip-scoped support still opens `RobotaxiPrototypeChat`. Focused mobile validation passed for support/chat fail-visible tests, prototype ride/surface tests, rating, and receipt with 7 suites / 165 tests; device/provider L2 evidence remains pending.
- Quote display lock guard: passenger destination pricing now treats a backend quote as display-ready only when it includes a positive fare, `quoteLockId`, and an unexpired `quoteLockExpiresAt`. Quotes without lock remain hidden as `--`/unavailable instead of flashing a stale or provisional fare, and Pix/extension paths remain blocked until a locked quote exists. Focused mobile validation passed for destination quote recalculation, prototype payment availability, payment-service quote lock, and Woovi modal with 4 suites / 28 tests.
- Viewport/lifecycle revalidation: focused mobile viewport and lifecycle guards passed for active route fitting above the bottomsheet, map-layer region application, route viewport contracts, prototype ride screens, lifecycle surface matrix, and lifecycle state guard with 6 suites / 168 tests. This is unit/contract evidence; final visual proof still requires the real Android/iOS smoke pass.

### Production Blockers Requiring A Decision Or External Evidence

- **P0 finance policy decision closed on 2026-06-24:** the active tiered policy in `ride-financial-contract.js` is approved for the release line. The approved policy id is `runtime_tiered_percent_above_50_v1`: R$ 0,79 up to R$ 10, R$ 0,99 from R$ 10,01 to R$ 25, R$ 1,49 from R$ 25,01 to R$ 50, and 3% above R$ 50. The prior fixed R$ 1,49-above-R$ 20 references are superseded for this release line. Runtime/deploy validation must carry `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1`, `LEAF_FINANCIAL_POLICY_APPROVAL_REF=thread-2026-06-24-user-approved-current-tiered-policy`, and `LEAF_FINANCIAL_POLICY_APPROVAL_ACTOR=izaak-dias`. Validation with those envs returns `ok=true`, with Firebase/Google configured and only the expected KYC strict-biometrics warning. Same-ride L2 evidence still must prove quote/payment/receipt/dashboard/ledger equality with this approved policy id.
- **P0 extension pricing model decision closed on 2026-06-24:** active-trip destination extension is approved as backend-authoritative pricing from the current vehicle position to the new destination. The extension Pix amount is the positive fare delta plus explicit operational costs for the new route recalculation and the new Pix processing fee. The backend persists `fareDelta` separately from passenger-payable `diffFare`, stores route recalculation cost, Woovi/payment-intermediation cost, extension operational cost, and passenger payable fare, then retains those extension operational costs in the final backend financial snapshot so they do not become driver net. Local proof passed for backend finance/lifecycle/extension commands and mobile extension surfaces; L2 still must prove the same ride id through extension Pix, webhook confirmation, receipt, dashboard, ledger, and driver net.
- **P0 manual driver approval scope:** legacy mass approval/rejection is disabled. The retained quick-approval path is authenticated and audited, but can still be an intentional override of derived KYC/document state. Product policy must define whether an authorized override can bypass individual CNH, CRLV, liveness, or face-compare evidence. Until then, it is not acceptable as normal approval evidence.
- **P1 payment availability race:** payment creation checks for an eligible nearby driver before Pix, but does not reserve supply through payment confirmation/dispatch. A driver can leave the pool after the precheck. A short-lived, atomic reservation needs explicit dispatch policy and expiry semantics before this is considered fully protected.
- **P1 operational support escalation:** severity classification and SLA metadata are backend-controlled, and normal backlog/summary reads are now read-only by default. Automatic escalation remains an explicit opt-in/manual action. A background escalation worker would change operational behavior and needs explicit approval before implementation.
- **P1 legacy escape surfaces:** Robotaxi is the production-default UI and legacy map UI requires an explicit runtime opt-out, but legacy RTDB chat/rating/report services remain in the repository. They must stay unreachable in production or be retired only after a dedicated usage/dependency audit.
- **P1 legacy manual payment distribution:** `POST /api/payment/distribute` remains in the backend for explicitly enabled manual operations. It is default-disabled, requires a payment-admin actor, and production config validation rejects `ENABLE_LEGACY_MANUAL_PAYMENT_DISTRIBUTION=true`; no caller exists in the current mobile or dashboard trees. Its removal or any replacement is a separate compatibility and operational-policy decision, not part of this audit.

### Backend Finance And Lifecycle

- P0: `startTrip` must require the same provider-backed payment evidence as `confirmPayment`. Local booking status, Redis cache, or mutable holding state is not enough to start a ride.
- P0: `/api/payment/advance` must be tied to a server-persisted quote lock/hash. Implemented in the current patch for quote-to-Pix creation; full ride/receipt/dashboard/ledger reconciliation remains under P0-008/P0-021.
- P0/P1: Woovi confirmation should not dispatch or start a ride if posting the `payment_received` ledger event failed. Implemented in the current patch: failed ledger posting produces non-dispatchable `ledger_pending`, blocks webhook/socket dispatch, and adds a defensive dispatch-service guard.
- P1: offline/partial-completion discount paths must produce explicit refund/settlement records instead of reducing final fare after paid-value validation. Implemented for driver-offline completion: `CompleteTripCommand` no longer mutates the Pix/receipt gross fare or canonical duration after validating the locked fare. It records `offlineSettlementReview`, marks `paymentDistribution.status=UNDER_REVIEW`, emits `settlementReviewRequired`, and the billing worker saves an `under_review` distribution without crediting the driver automatically until explicit ledger/refund settlement exists. Focused command and worker tests cover the guard. Early-end/manual-review paths already produce settlement artifacts; real L2 finance evidence remains pending.
- P1: multi-leg billing must use the same ledger-backed settlement path as single-leg rides. Guard/test coverage implemented: billing worker fails explicitly while `ENABLE_MULTI_LEG_BILLING` is off, and when enabled credits each ride leg through `creditDriverBalance`, persists a `mode=multi_leg` distribution, updates the payment holding, and avoids the simple `processNetDistribution` path. Rollout flag enablement and L2 reassignment evidence remain pending.
- P1: receipt generation should prove equality against payment distribution plus ledger, not recalculate from mutable booking fields. Implemented as a backend guard for final receipts: `ReceiptService` rejects non-`backend_final` or incomplete snapshots and receipt routes return controlled `409` while reconciliation is pending. L2 dashboard/ledger equality evidence remains under P0-008.
- P1: driver withdrawal is protected at the code boundary by app password, authenticated driver scope, idempotency key, KYC step-up, cent-precise available-balance debit, request/processed ledger entries, and a stable Woovi correlation id. Pix Out is blocked while the request ledger is not posted and a successful provider transfer with failed ledger posting remains `processed_ledger_pending`. Provider sandbox payout and reconciliation evidence remain required before enabling withdrawals in production.

### Mobile Lifecycle And UI State

- P0 candidate: driver trip screens can show `Nenhuma corrida ativa` when `bookingStatus` is active but `driverActiveRide` is temporarily incomplete. Implemented in the current patch: `RobotaxiDriverTripScreen` now builds a protected request from `activeBookingId`/`activeBooking`/trip metadata for `accepted`, `arrived`, and `started` states.
- P1: driver offer sheet currently allows passive dismiss through default sheet behavior. Implemented in the current patch: visible paid offers now disable backdrop dismissal and drag; explicit accept/reject/timeout remains the only valid exit path.
- P1: passenger driver-search transient idle states need a release-safe test so confirmed payment plus active booking does not become a blank return. Implemented in the current patch: paid/active search evidence renders a protected reconciliation state instead of `null`, keeps support scoped to the active booking, and disables cancellation until canonical status returns.
- P1: receipt role should be explicit in route params or backed by receipt owner scope, not inferred from potentially stale `activeRole`. Implemented in the current patch: `RobotaxiReceiptScreen` resolves explicit route roles first, then matches the logged profile uid against receipt `driverId`/`passengerId`/`customerId` aliases before falling back to legacy `activeRole`. `prototype-ride-screens` proves a stale driver `activeRole` cannot turn a passenger-owned receipt into the driver receipt surface.
- P1: completed-without-`lastReceipt.id` must show recovery/loading copy or fetch receipt, not an empty receipt state. Implemented in the current patch: `RobotaxiReceiptScreen` shows an explicit synchronization/recovery state, calls `recoverCompletedReceipt`, disables invalid rating, and lets the user return to the map without re-locking the completed ride.

### Auxiliary Domains

- P0: Socket.IO support/chat/rating handlers must require authenticated identity and participant/scope checks. Implemented in the current patch: ride chat, support chat, and rating use authenticated socket identity plus ride/support scope instead of trusting payload-provided `userId`, `senderId`, `senderType`, `reviewerId`, or `targetUserId`.
- P0: manual driver approval and KYC overrides need audit reason, evidence, actor, and policy trail before production use. Implemented in the current patch: `/driver-approval/approve` passes authenticated admin audit metadata, `DriverApprovalService` rejects approvals without actor/reason/provenance/evidence before calling Woovi, and manual KYC unblock refuses `manualOverride` without the same audit trail.
- P0: the active OTP path cannot return simulated success in normal production. Implemented in the current patch as fail-closed: `/api/custom-otp/request-otp` and `/verify-otp` return `OTP_PROVIDER_NOT_CONFIGURED` in production for non-bypass phones, and runtime config blocks `DEBUG_OTP=true`.
- P0: KYC production readiness should fail closed when strict biometric policy is required, rather than returning `ok: true` with warning. Implemented and covered by focused policy/runtime tests when `KYC_PRODUCTION_BIOMETRICS_ENABLED=true`.
- P0: suspension and blocking must remove a driver from dispatch eligibility, not merely set a profile flag. Implemented for canonical user-status management and the legacy driver compatibility routes: both data stores are updated, Redis eligibility is removed, and the operator/action are audited. Re-activation intentionally returns an unapproved driver to `pending_review` rather than granting approval.
- P1: account/profile mutation routes should prevent clients from writing derived driver activation, documents, vehicles, and approval status fields directly. Implemented in the current patch: `/api/account/profile` rejects app payloads containing derived approval, KYC, document, vehicle, or driver activation fields with `PROFILE_DERIVED_FIELD_FORBIDDEN`, while normal profile fields still update. Focused backend unit tests prove forbidden fields are not persisted.
- P1: support mobile should not convert ticket/message load failures into successful empty lists; that masks outage as empty UI. Implemented in the current patch: `SupportTicketService` propagates ticket/message loading failures, `SupportService` returns `success:false` for failed ticket/message reads, `SupportScreen` shows ticket/chat load failures as visible error states, and `RobotaxiChatScreen` renders load failure as an error/retry state instead of an empty conversation.
- P1: dashboard/support polling evidence can be stale; production operational surfaces need visible freshness and socket-driven updates where available. Implemented in the current patch for dashboard support: ticket queue, N0 inbox, and active message reads now track last success/error, render visible updated/stale/error badges, and `qa:backoffice` asserts the freshness evidence. Real support-operator evidence and any broader Socket.IO ticket-stream contract remain pending.

## P0 Internal To-Do

| ID | Item | Owner domain | Status | Required evidence |
| --- | --- | --- | --- | --- |
| P0-001 | Clean backend runtime warnings so Firebase and Google are OK; only the expected KYC strict-production warning may remain until KYC rollout is closed. | Backend/config | Verified focused check; now gated by financial-policy approval | With the explicit policy-approval env set only for validator-mechanics proof, `config:validate` returns `ok: true`; Firebase configured; Maps key configured; receipt map images configured; only KYC strict biometric warning remains. Without that approval env, current production config intentionally fails on the financial-policy blocker, not Firebase/Google. The `mobile-unit` test profile now recognizes the supported local Firebase service-account fallback and does not emit remote Redis/Firebase warnings for a unit-only run. |
| P0-002 | Replace hardcoded approved CRLV vehicle label in driver activation UI with canonical active vehicle identity. | Mobile/driver onboarding | Implemented, focused mobile unit passed | `prototype-new-surfaces` proves `Nissan Leaf PRATA · LEF-2042` and no `Honda City branco`. |
| P0-003 | Add or unblock release-safe passenger signup evidence. | Mobile/onboarding | Android release-flow unblocked, execution pending | `20-passenger-signup-real-android.yaml` now targets `br.com.leaf.ride` without dev-server, Metro, mock, or bypass markers. `qa-flow-inventory.json` lists Android coverage with only `platform:ios` missing. Real Android/iOS execution evidence still required. |
| P0-004 | Add or unblock release-safe driver signup plus document upload evidence. | Mobile/onboarding/KYC | Android release-flow unblocked, execution pending | `21-driver-signup-docs-real-android.yaml` now targets `br.com.leaf.ride` without dev-server, Metro, mock, or bypass markers and covers CNH plus CRLV upload screens. After async CRLV analysis, the backend now normalizes identity data and mirrors it into both the activation snapshot and the Firestore dashboard projection without granting online eligibility until an active vehicle is approved. Mobile activation/document surfaces now map `rejected`/attention statuses to visible review/failure states instead of showing rejected documents as pending. `qa-flow-inventory.json` lists Android coverage with only `platform:ios` missing. Real Android/iOS execution evidence, OCR backend state, approval/rejection, active vehicle binding, and final driver state still required. |
| P0-005 | Add driver-side active-ride chat evidence. | Mobile/backend | Implemented guards, pending L2 evidence | Focused backend unit proves authenticated driver chat in a started ride persists as `driver`, delivers to the passenger, and ignores spoofed payload sender fields. Focused mobile unit proves the driver `started` trip surface exposes `driver-trip-chat-button` and routes to chat. Real L2 still must capture passenger-to-driver and driver-to-passenger messages visible on both roles. |
| P0-006 | Prove payment availability guard with no eligible driver before payment. | Backend/payment/mobile QA | Backend and runner guards implemented, pending real smoke | Payment creation is blocked before Pix by `/api/payment/advance` when no eligible driver exists, paid `createBooking` fails closed before `RequestRideCommand` if availability disappears before booking materialization, and the Android smoke runner now stops with `blocked_precondition:driver_unavailable` before payment when canonical pickup availability fails. The payment UI no longer lets `autoOpenPix` bypass this precheck: it calls `checkRideAvailability` first and keeps Woovi closed on no-driver/geofence failures. Focused backend/mobile unit and contract tests cover these guards. Device/backend smoke must still verify the behavior with real state. |
| P0-007 | Prove successful L2 ride with driver available before payment. | Mobile/backend/dashboard | Pending device smoke | Ordered events: quote, payment confirmed, dispatch, offer, accept, arrived, started, completed, rating, receipt, clean map. |
| P0-008 | Reconcile ride money as one immutable contract. | Backend/dashboard/mobile | Implemented guards, pending L2 evidence and policy decision | Quote gross = payment gross = receipt gross = dashboard gross; driver net and fees match ledger. Implemented guards now cover quote lock, Pix mismatch, ledger-before-dispatch, backend-final receipt generation, current dashboard metrics excluding incomplete financial snapshots, legacy report/top-driver fallback removal, dashboard completed-ride revenue suppression when final snapshot is missing, and production config blocking runtimes that do not explicitly approve the active financial policy id. Real L2 still must prove equality on the same ride id across app, receipt, dashboard, Woovi, and ledger after the fee policy is approved. |
| P0-009 | Capture route first-render evidence for the selected traffic route. | Mobile/maps/backend | Implemented focused guard, pending device smoke | `prototype-map-route` and destination/runtime guards prevent fallback route publication without real coordinates; `PrototypeMapLayer` no longer paints an initial two-point partial route during route animation; `driver-online-toggle` and `prototype-traffic-route` cover traffic segment colors/worst-level propagation. Android smoke must prove no straight-line flash and traffic segments/colors when backend returns traffic data. |
| P0-010 | Prove active map viewport and manipulation on real Android after bottomsheet fix. | Mobile/maps | Implemented focused guard, pending device smoke | `prototype-route-viewport` proves short/long route math against the exposed map rectangle, including long vertical and horizontal routes with top/bottom/side padding; `prototype-map-layer-viewport` proves `PrototypeMapLayer` uses the explicit visible route region instead of generic `fitToCoordinates`; `prototype-ride-screens` and `driver-online-toggle` prove active Trip/Home maps receive the guard, include immediate live-sheet occlusion, and remain interactive for passenger and driver while hidden Home under Trip overlay stays non-interactive. The latest focused update also proves the paid driver offer and dedicated driver in-trip screen pass viewport padding/route region, restore the driver map in `started`, keep route progress visible, and forward traffic segments. Android smoke still needs screenshot/tap/drag evidence. |
| P0-011 | Prove support severity classification and orchestrator path. | Backend/dashboard/support | Backend and dashboard local guards implemented, operator evidence pending | `support-severity-classifier` and `SupportQueueService` now calculate effective priority before SLA queueing, store classification metadata, ignore untrusted app-user priority inflation, and preserve trusted operator/system severity. Dashboard support inbox/detail promotes `metadata.supportClassification` into visible classification, source, and rationale fields. Focused backend tests cover N1 safety, N2 payment/refund/stuck-flow, priority inflation, queue metadata, support route lifecycle, and socket support chat scope. `npm --prefix leaf-dashboard-js run qa:backoffice` passes with a classified N2 support fixture and no paid provider browser calls. Real evidence still needs ticket id, dashboard visibility with live data, operator assignment/escalation, chat history, and audit trail. |
| P0-012 | Prove KYC blocks driver online when incomplete or mismatched. | Backend/KYC/mobile | Implemented backend guards, pending provider/mobile L2 evidence | `driver-eligibility-service` now resolves canonical activation/KYC state before ride eligibility and fails closed when the state cannot be read. KYC manual review/rejected, rejected activation documents, missing/unavailable activation state, and non-active states block online/dispatch eligibility. `register-socket-update-location-handler` is covered so location sync cannot silently add a blocked driver to the eligible geo pool. Real L2 still needs KYC happy path, mismatch/manual-review, retry, and visible mobile blocking evidence. |
| P0-013 | Block socket `confirmPayment` from fabricating payment confirmation in production. | Backend/payment | Implemented, focused backend unit passed | Unit guard rejects `socket_confirmPayment` holding, accepts `woovi_webhook` and direct `woovi_provider`. |
| P0-014 | Lock driver active trip sheet against backdrop/drag state regression. | Mobile/driver lifecycle | Implemented, focused mobile unit passed | `prototype-ride-screens` proves `accepted`, `arrived`, `started` cannot dismiss through backdrop. |
| P0-015 | Replace OTP simulation/TODO with real provider evidence or explicit pre-production blocker. | Backend/auth | Implemented fail-closed, provider integration pending | Custom OTP simulation is blocked in normal production with `OTP_PROVIDER_NOT_CONFIGURED`; test/review bypass remains explicit. Real OTP provider response evidence remains pending if custom OTP is required for production signup instead of Firebase Auth. |
| P0-016 | Remove or harden fail-open paths in KYC, document queues, chat persistence, and legacy driver admin routes. | Backend/KYC/support/chat/admin | Implemented, focused backend units passed | Chat send now requires Firestore persistence before `messageSent`/`newMessage`; legacy `/api/drivers/applications*` mutations return `410`; dashboard quick driver approval requires reason/evidence and routes KYC unblock through audited `kycDriverStatusService`; KYC strict and document activation guards are covered by focused policy/queue/activation tests. L2 evidence still required for full dashboard walkthrough. |
| P0-017 | Protect receipt APIs so ride receipts and map images are only visible to the passenger, driver, or an authorized support/admin actor. | Backend/receipts/mobile | Implemented, focused backend unit and route guard passed | `receipts-routes-auth` proves owner/support/third-party behavior; `assert-sensitive-route-guards` requires auth/scope/admin-only generation; mobile receipt fetch now uses the authenticated axios client. |
| P0-018 | Prevent passenger quote price flicker before authoritative backend pricing is ready. | Mobile/pricing | Implemented, focused mobile unit passed | `destination-quote-recalculation` proves the quote card shows `--` and `Atualizando tarifa` while backend quote is pending, then displays the locked backend fare. The same guard now applies to active destination extension: the extension card shows no local-plan fare, blocks submission without backend quote, and sends `requestTripExtension` only with backend fare, route metrics, and quote metadata. |
| P0-019 | Require provider-backed payment evidence before `startTrip`, not only before `confirmPayment`. | Backend/payment/lifecycle | Implemented, focused backend unit passed | `authoritative-payment-confirmation-service` centralizes provider proof; `StartTripCommand` and socket `startTrip` use it. Focused tests reject booking/cache-only proof and accept Woovi/provider-verified proof. |
| P0-020 | Persist and enforce a backend quote lock/hash before Pix intent creation. | Backend/pricing/payment | Implemented, focused backend/mobile units passed | `quote-lock-service` creates/validates Redis quote locks; `/pricing/quote` returns `quoteLockId`; `/api/payment/advance` rejects stale/mismatched locks before Woovi; mobile forwards `quoteLockId` into Pix creation. `RobotaxiPaymentScreen` blocks `autoOpenPix` before availability/Pix when the lock is missing or expired, and `WooviPaymentModal` refuses to call `/api/payment/advance` without a lock. Focused tests cover amount mismatch, locked metadata propagation, and fail-closed UI/modal behavior. |
| P0-021 | Block dispatch/start when `payment_received` ledger posting fails. | Backend/ledger/payment | Implemented, focused backend units passed | `storeConfirmedPayment` writes `LEDGER_PENDING`/`ledger_pending` when `payment_received` fails; Woovi webhook and socket `confirmPayment` stop before holding/dispatch on pending ledger; `triggerDispatchAfterPayment` refuses pending-ledger bookings. Focused tests prove ledger failure state and no dispatch. |
| P0-022 | Harden Socket.IO chat/support/rating/cancellation identity and participant authorization. | Backend/socket/support/chat/rating/lifecycle | Implemented, focused backend units passed | `socket-scope-guard` resolves socket identity, support/admin authority, and ride participants from memory/Redis/RTDB. Ride chat canonicalizes sender/receptor from the ride, support chat prevents user-id spoofing, rating canonicalizes reviewer/target from ride scope, and `cancelRide` now validates passenger/driver scope before idempotency, command execution, or persistence. `CancelRideCommand` rechecks the actor from booking data; only the explicit `system_trip_integrity` actor may bypass passenger/driver matching. Focused tests cover spoof rejection and authorized success. |
| P0-023 | Keep driver active trip UI protected during partial rehydration. | Mobile/driver lifecycle | Implemented, focused mobile unit passed | `RobotaxiDriverTripScreen` falls back to active booking metadata when `driverActiveRide` is incomplete. `prototype-ride-screens` proves active `bookingStatus` plus `activeBookingId` does not render `Nenhuma corrida ativa`; sheet remains non-dismissible. |
| P0-024 | Add auditable override trail for manual driver approval/KYC unblock. | Backend/dashboard/KYC | Implemented, focused backend units passed | Manual driver approval now requires actor, role, reason, provenance, evidence, previous state, and next state before Woovi/account approval. Dashboard KYC unblock tied to manual approval passes the same audit trail, and `kycDriverStatusService` refuses manual override unblock without audit. Focused tests cover rejection without audit, route propagation of admin metadata, and KYC audit persistence. Dashboard visual audit evidence remains pending for L2/backoffice. |
| P0-025 | Fail production readiness if the active OTP path is simulated. | Backend/auth | Implemented, focused backend units passed | Normal production custom OTP no longer returns simulated success: request and verify fail closed before Redis simulation for non-bypass phones. Runtime diagnostics expose `fail_closed_without_real_provider`, and `DEBUG_OTP=true` blocks production validation. |
| P0-026 | Prevent completed passenger receipt from becoming an empty or invalid terminal UI when receipt hydration is incomplete. | Mobile/lifecycle/receipt | Implemented, focused mobile unit passed | `RobotaxiReceiptScreen` now treats missing selected receipt and selected receipts without a positive final gross fare as synchronization/recovery states. It calls `recoverCompletedReceipt`, passes `explicitBookingId` when an incomplete receipt id exists, shows no fabricated `R$ 0,00`, disables invalid rating, exposes accessible disabled state, and exits to a clean map. `prototype-ride-screens` covers both missing-receipt and incomplete-financial terminal paths. |
| P0-027 | Prevent completed/rated passenger terminal surfaces from remaining in the navigation back stack. | Mobile/lifecycle/navigation | Implemented, focused mobile unit passed | `RobotaxiRatingScreen` now returns to `RobotaxiPrototype` with `navigation.replace` or `StackActions.replace` after successful rating. `driver-online-toggle` proves Home `completed` auto-route uses receipt replacement even when receipt hydration is missing; `prototype-ride-screens` proves successful rating clears the completed receipt and does not use stack-preserving `navigate`. |
| P0-028 | Prevent backend receipt generation from finalizing without an authoritative final financial snapshot. | Backend/receipt/finance | Implemented, focused backend unit passed | `ReceiptService.generateReceipt` now requires `authoritativeSnapshot=true`, `financialSnapshotSource=backend_final`, positive gross amount, Leaf operational fee, Woovi fee, and driver net before emitting a final receipt. It no longer falls back to quote `estimate` as receipt gross. Receipt routes map incomplete reconciliation to `409 RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE`. Focused receipt service and route tests cover accepted backend-final snapshots plus missing source, missing gross, invalid driver net, and route conflict responses. |
| P0-029 | Scope ride-linked incident reports and support tickets to real ride participants. | Backend/socket/support/safety/mobile | Implemented, focused backend and mobile units passed | `reportIncident`, `emergencyContact`, and socket `createSupportTicket` now call `assertRideParticipant` before accepting a payload `bookingId`. Passenger/driver participants and support/admin actors may link the ride; unrelated users receive scoped errors and cannot create incidents/tickets that mark another booking for ops review. Mobile support, complaint, receipt-help, and active passenger/driver trip entry points now carry `bookingId`, `source`, and status; runtime forwards that scope to socket calls; `WebSocketManager` listens to `incidentReportError`, `emergencyError`, and `supportTicketError` so backend denials surface immediately. Focused tests cover spoof rejection, participant success, support ticket rejection, `socket-scope-guard`, `safety-incident-service`, ride support navigation payloads, support-ticket payload context, and mobile socket scope-error rejection. |
| P0-030 | Prevent paid passenger search from rendering blank when runtime briefly hydrates as idle. | Mobile/lifecycle/search | Implemented, focused mobile unit passed | `RobotaxiDriverSearchScreen` now renders a visible protected reconciliation state when there is confirmed payment or active booking evidence but the status is transiently non-canonical and no terminal backend error exists. `prototype-ride-screens` proves the screen shows search content, keeps origin/destination labels, disables cancellation behavior, preserves support booking scope, and does not navigate to map/terminal routes. |
| P0-031 | Make lifecycle events monotonic, booking-scoped, and terminal after receipt/rating. | Mobile/backend/lifecycle | Implemented focused guard, pending L2 replay evidence | `rideLifecycleStateGuard` permits only normal forward transitions plus named operational reassignment branches, rejects another booking while a ride is active, freezes completed/canceled bookings, and normalizes `cancelled` to the same terminal state. Runtime now routes canceled active-ride sync through terminal cancellation, blocks stale boarding expiry after start, keeps terminal dedupe after receipt/rating dismissal, and permits late authoritative completion only to enrich receipt history without reopening terminal UI. Backend terminal detection is centralized in `RideStateManager` and is used by active-ride sync, stale driver-lock cleanup, dispatchability, radius expansion, queue worker, response handler, and late driver response. Alternate terminal states (`EARLY_ENDED_BY_RIDER`, `INTERRUPTED_OPERATIONAL_ENDED`, `EARLY_ENDED_REVIEW`) now close active indexes and block re-dispatch/re-lock just like completed/canceled/no-driver states. Backend legacy active-ride socket commands now reject non-participants and terminal canonical bookings before mutating `bookings:active`, including destination change, new-driver reassignment, problem report, and partial-payment estimate paths. Backend cancellation state now mirrors this contract. Focused mobile/backend tests and route guards pass; real delayed-event/relaunch replay remains required. |
| P0-032 | Make rating terminal, scoped, and transactionally idempotent. | Backend/mobile/rating | Implemented focused guard, pending L2 retry evidence | `RatingService` now requires the canonical authenticated booking scope in `COMPLETED`, rejects pre-completion/mismatched/missing scopes, derives the opposite participant from the scope, reserves the trip-reviewer index with an RTDB transaction, releases a failed pending reservation, and replays a committed rating on duplicate submit. The socket handler returns the backend code to mobile. Focused backend tests cover pre-completion rejection, atomic duplicate replay, KYC escalation, participant spoofing, and scope reads; focused mobile tests cover rating submit, receipt closure, and map return. |
| P0-033 | Keep ride-chat history and read state on the canonical Socket.IO runtime. | Backend/mobile/chat | Implemented focused guard, pending L2 role evidence | `load_messages` and `mark_messages_read` now run in `register-socket-engagement-chat-handlers`, not only in the legacy bridge disabled in production. Both require participant scope and the same ride status policy as sending; read updates are restricted to messages addressed to the authenticated reader. The mobile client registers handlers before emitting, ignores replies for another chat, surfaces server errors, and forwards the optimistic message id for an idempotent Firestore document id. Focused backend tests cover authorized history, denied history, and recipient-only read updates; focused mobile chat/support suites pass. |
| P0-034 | Prevent client-declared facial signatures from approving driver KYC in production. | Backend/KYC/onboarding | Implemented focused guard, provider L2 pending | Production now always requires a backend/microservice-trusted biometric match and rejects both legacy `device_signature_v1` and AWS-liveness-only identity approval, regardless of a stale permissive environment flag. The legacy onboarding route rejects before mutating KYC state or driver availability. Outside production, the legacy path remains explicitly isolated for development/test compatibility. The existing photo-mismatch policy now has focused proof that revalidation is deferred while a trip is active; terminal commands apply it only after completion/cancellation. |
| P0-035 | Settle the immutable backend-final money snapshot instead of recalculating in billing. | Backend/finance/receipt | Implemented focused guard, L2 reconciliation pending | `CompleteTripCommand` now persists and emits a cent-precise `ride_financial_snapshot_v1`; it contains passenger paid amount, toll pass-through, Leaf operational fee, Woovi intermediation fee, subscription retention, driver net, and balanced allocation. The standard billing worker rejects a completion event without a valid matching snapshot and passes it to `PaymentService`, which settles the exact values rather than recalculating net. Final receipts now require exact `driverNet + totalFees = passengerGross` equality in cents. Manual-review and multi-leg branches remain explicit, not silently converted to the standard settlement. |
| P0-036 | Prevent mobile or dashboard approval actions from locally granting driver eligibility. | Mobile/backend/dashboard | Implemented focused guards, provider L2 pending | Driver activation opens canonical KYC instead of faking facial approval, consumes explicit remote liveness only, and maintains stable loading hydration. Dashboard mass approval is disabled; document review recomputes canonical activation; compatibility suspend/unsuspend endpoints now use audited operational-status management and clear Redis eligibility. |
| P0-037 | Prove withdrawal settlement is provider-backed and ledger-reconciled. | Backend/finance/Woovi | Implemented code guards, provider evidence pending | The request path requires app password, driver scope, idempotency, KYC step-up, sufficient cent balance, and a posted request ledger. Processing claims the withdrawal atomically, sends Pix Out with a stable correlation id, and records or explicitly flags the processed ledger. A real sandbox payout and dashboard/ledger reconciliation remain required before production enablement. |
| P0-038 | Prevent legacy mobile RTDB ride acceptance from calculating driver payout client-side. | Mobile/navigation/finance | Implemented focused guard, L2 regression pending | `Trips` and `DriverTrips` aliases now resolve to `PilotFeatureUnavailableScreen` with an explicit Robotaxi/backend-only message. The legacy `DriverTrips` screen and `acceptTask` action remain in the repository for compatibility cleanup, but production navigation no longer mounts the path that wrote `driver_share`, `convenience_fees`, and acceptance state directly from the client. |

## Latest Validation - 2026-06-23

- Passed: `npm run governance:check`, tracked secret scan, hardcoded-secret guard, and `git diff --check`.
- Passed: `npm --prefix mobile-app run qa:production-guards` and the mobile core cross-suite: 11 suites, 129 assertions across map viewport/layers, quote stability, lifecycle state guards, rating, receipt, chat, support, trip UI, and driver controls.
- Passed: backend core cross-suite: 20 suites, 157 assertions across KYC/onboarding policy, CRLV/activation/eligibility, canonical chat, rating, cancellation/completion/start lifecycle, quote/payment locks, immutable financial snapshot, billing, receipt, and ledger reconciliation.
- Passed: independent backend domains: 10 suites, 46 assertions across OTP, account guards/deletion, driver approval audit, KYC administrative boundaries, support severity/orchestration, safety incident scope, and receipt access control.
- Passed: `npm --prefix leaf-dashboard-js run qa:backoffice` including lint, production build, route smoke, protected-route checks, and provider-call boundary checks.
- Passed: `test:route-guards` and `check:no-active-vps-runtime`. `config:validate` now intentionally fails without explicit financial-policy approval, before any deploy can treat an unapproved split formula as production-ready.
- Runtime config result: Firebase Admin, RTDB, Google Maps, and receipt map images are configured; no Firebase or Google runtime warning remains. With `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` set only for validator-mechanics proof, `config:validate` returns `ok: true` and the only configuration warning is `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`. Without those envs, it blocks on financial policy approval.
- Release residual: runtime diagnostics report `fcmConfigured=false`. This is not a Firebase Admin/RTDB failure and does not invalidate the ride lifecycle checks, but production push-notification configuration and one live delivery proof remain required before a full production go/no-go.
- Test-process update: the mobile core cross-suite now passes under `--detectOpenHandles` without the previous animation `act(...)` noise: 11 suites, 129 assertions. `prototype-ride-screens` now isolates map/motion primitives at the screen-contract layer while `prototype-map-layer-viewport` keeps the real map viewport behavior covered separately.
- Test-process update: backend focused suites now exit cleanly after assertions. The residual hang was isolated to `CompleteTripCommand` loading the real KYC policy stack during unit tests, which initialized KYC worker handles through `IntegratedKYCService`; the command suite now mocks that boundary while still asserting that deferred identity reverification is requested after ride completion. RedisPool shutdown also clears its timeout guard and tolerates test doubles without `quit()`.
- Validation manifest evidence: `RUN_LOCAL_GATES=true bash scripts/validation/run-master-validation.sh --label wave9-local --wave wave9` produced `reports/validation-runs/20260623_030248_wave9-local`. `W9-CORE-001` is `pass`; `W9-L2-001`, `W9-FIN-001`, `W9-SOCKET-001`, `W9-KYC-001`, and `W9-FCM-001` are intentionally `blocked` until real device/provider evidence exists.
- Post-audit validation: `npm --prefix mobile-app run test:unit -- --runInBand` passed with 91 suites / 551 tests; the focused lifecycle, recovery, and financial guard group passed 3 suites / 96 tests under `--detectOpenHandles`. `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` passed with 175 suites / 823 tests. The dashboard `qa:backoffice`, production guards, configuration validation, route guards, governance, tracked secret scan, hardcoded-secret guard, and `git diff --check` passed in this audit window.
- Activation/approval validation: focused mobile activation/liveness coverage passed 3 suites / 57 tests; focused backend legacy-admin, quick-approval, and activation-state coverage passed locally; `qa:backoffice` passed. Current runtime config keeps Firebase/Google clean, with only the intentional KYC readiness warning and the separate FCM delivery residual.
- Focused follow-up validation: operational suspension/status coverage passed 3 suites / 15 tests; withdrawal/ledger coverage passed 3 suites / 58 tests; KYC biometric/activation coverage passed 4 suites / 22 tests. These are local contract proofs only and did not invoke Woovi or AWS.
- Active route rendering follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 79 tests. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-map-route.test.js __tests__/driver-online-toggle.test.js` passed with 4 suites / 49 tests. After traffic-segment propagation, `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/driver-online-toggle.test.js` passed with 2 suites / 113 tests, and `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js` passed with 1 suite / 2 tests.
- Legacy financial-route follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/legacy-financial-routes.test.js` passed with 1 suite / 3 tests. Legacy `Trips`/`DriverTrips` route aliases remain registered for compatibility but now mount `PilotFeatureUnavailableScreen`; they no longer import or mount `DriverTrips`, which contained client-side RTDB acceptance and driver-share calculation.
- Dashboard financial fallback follow-up: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/dashboard-ride-monitoring-service.unit.test.js tests/unit/services/modern-metrics-service.unit.test.js` passed with 2 suites / 10 tests, and `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/metrics-financial-routes.unit.test.js` passed with 1 suite / 2 tests. `node --check` passed for `dashboard-ride-monitoring-service.js`, `modern-metrics-service.js`, `routes/metrics.js`, and `routes/dashboard.js`; `rg` no longer finds `estimate * 0.85` or the old 15% report fee formula in the audited dashboard/metrics paths.
- Lifecycle replay follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-lifecycle-state-guard.test.js __tests__/runtime-crash-recovery.test.js __tests__/websocket-manager-active-ride-sync.test.js` passed with 3 suites / 21 tests, and `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 79 tests. `node --check` passed for `rideLifecycleStateGuard.js` and `prototypeRideRuntime.js`. The focused proof covers terminal alias normalization, delayed active sync handling, runtime recovery, protected trip screens, receipt/rating closure, and no passive map/sheet regression.
- Driver route viewport follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 81 tests after adding paid driver-offer and driver in-trip viewport assertions. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js` passed with 2 suites / 9 tests. `node --check` passed for `RobotaxiDriverOfferScreen.js`, `RobotaxiDriverTripScreen.js`, `prototypeRouteViewport.js`, and `PrototypeMapLayer.js`. The proof covers driver offer route framing above the sheet, restored driver in-trip map, started-trip route progress, canonical traffic segment forwarding, and no synthetic live route fallback while route geometry is absent.
- Backend terminal active-sync follow-up: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/active-ride-sync-utils.unit.test.js tests/unit/bootstrap/register-socket-active-ride-handlers.unit.test.js tests/unit/services/gradual-radius-expander.unit.test.js` passed with 3 suites / 22 tests, and `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/commands/CompleteTripCommand.unit.test.js tests/unit/commands/CancelRideCommand.unit.test.js` passed with 3 suites / 10 tests. `node --check` passed for `active-ride-sync-utils.js`, `register-socket-active-ride-handlers.js`, and `gradual-radius-expander.js`. `config:validate`, governance, tracked secret scan, hardcoded-secret guard, and `git diff --check` passed. The proof covers terminal status aliases, passenger and driver stale active-index cleanup, `activeRideSync` returning terminal metadata without an active `bookingId`, completed bookings not being routed through expired-search reconciliation, legacy active-ride commands rejecting terminal/non-participant mutations before recalculation or reassignment, and existing complete/cancel idempotency behavior remaining green.
- Backend terminal contract broadening follow-up: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-state-manager.unit.test.js tests/unit/bootstrap/active-ride-sync-utils.unit.test.js tests/unit/services/driver-lock-manager.unit.test.js tests/unit/services/driver-notification-dispatcher.unit.test.js tests/unit/services/response-handler.unit.test.js tests/unit/services/gradual-radius-expander.unit.test.js` passed with 6 suites / 38 tests, and `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-driver-response-handler.unit.test.js` passed with 1 suite / 3 tests. The proof covers `RideStateManager` terminal normalization for completed/canceled/no-driver/rejected/expired/superseded and alternate closure states, active passenger index cleanup for `EARLY_ENDED_REVIEW`, stale driver lock release for alternate terminal and no-driver bookings, dispatch blocking for alternate terminal statuses, response-handler no-dispatch behavior, radius-expansion terminal blocking, and legacy driver-response rejection for terminal rides.
- Current dashboard boundary follow-up: `npm --prefix leaf-dashboard-js run qa:backoffice` passed. The evidence includes ESLint, a production Next build, and Playwright smoke against the `leaf-dashboard-js` app. The smoke requires `data-leaf-dashboard-generation="current-next"` on checked routes, validates `/dashboard`, `/support`, `/campaign-center`, `/drivers/review-queue`, `/metrics`, `/financial-reconciliation`, and `/runtime-flags`, verifies current financial contract rendering, verifies the financial simulator stays hidden unless explicitly flagged, rejects deprecated financial/simulation endpoints, and blocks direct browser calls to Google, Woovi/OpenPix, or Firebase providers. This confirms the current dashboard, not the legacy static `scripts/maintenance/dashboard-server.js` on port 3002, is the QA target.
- Offline snapshot/backend intent/mobile reconnection follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-local-snapshot-service.test.js __tests__/ride-event-outbox-service.test.js` passed with 2 suites / 13 tests. `RideLocalSnapshotService` now rejects local regressions, older backend versions, and older `lastServerEventAt`; treats `customer/passenger` as the same scope; recognizes no-driver terminal aliases; strips fee/net fields from non-`backend_final` local financial snapshots; and preserves backend-final financial evidence exactly. `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-offline-intent-validator.unit.test.js tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/bootstrap/register-socket-driver-control-handlers.unit.test.js` passed with 3 suites / 18 tests, and `node --check` passed for `ride-offline-intent-validator.js` plus the start, complete, cancel, and driver-control socket handlers. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-event-outbox-service.test.js __tests__/ride-lifecycle-outbox-replay-service.test.js __tests__/websocket-manager-create-booking.test.js __tests__/runtime-crash-recovery.test.js` passed with 4 suites / 24 tests, and `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 107 tests. `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js` passed with 1 suite / 4 tests, `npm --prefix mobile-app run test:unit -- --runInBand __tests__/location-buffer-service.test.js __tests__/websocket-manager-create-booking.test.js` passed with 2 suites / 11 tests, `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-health-monitor.unit.test.js tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js` passed with 2 suites / 10 tests, `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ops-overview-service.unit.test.js` passed with 1 suite / 1 test, and `npm --prefix leaf-dashboard-js run qa:backoffice` passed with `/observability` rendering `driver_signal_stale`/`booking-signal-stale`. This implements `OFF-P0-001`, `OFF-P0-003`, the main `OFF-P0-004` runtime UI guard, terminal/replay parts of `OFF-P0-005`, `OFF-P1-001`, `OFF-P1-002`, `OFF-P1-003`, and stale-signal visibility for `OFF-P1-004`; offline pending/rejected intent dashboard evidence and Android airplane-mode evidence remain pending.
- Backend extension fare authority follow-up: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/commands/RequestRideExtensionCommand.unit.test.js tests/unit/commands/RespondRideExtensionCommand.unit.test.js` passed with 2 suites / 4 tests. Expanded validation with `tests/unit/bootstrap/register-socket-active-ride-handlers.unit.test.js` and `tests/unit/services/ride-lifecycle-service.unit.test.js` passed with 4 suites / 14 tests, and the existing active-sync/lifecycle terminal set passed with 5 suites / 27 tests. `node --check` passed for `RequestRideExtensionCommand.js`, `RespondRideExtensionCommand.js`, and `ride-lifecycle-service.js`. The proof covers backend fare estimate authority for extension requests, client fare divergence blocking, and refusal to generate Pix from legacy extension requests without backend fare authority.
- Mobile extension quote follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/destination-quote-recalculation.test.js __tests__/websocket-manager-create-booking.test.js` passed with 2 suites / 20 tests. `npm --prefix mobile-app run qa:production-guards` and `git diff --check` passed. The proof covers extension backend quote fetch, UI blocking without quote, backend fare/route/quote metadata forwarded to `requestTripExtension`, and WebSocket `requestRideExtension` metadata propagation.
- Active map visible-area follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js` passed with 3 suites / 43 tests after aligning the active Home route focus and layout keys to the effective map height fallback. The proof covers bottomsheet-aware route padding/region, `PrototypeMapLayer` using explicit viewport regions instead of generic full-map fitting, and active passenger/driver Home maps retaining enough bottom padding for the sheet area.
- Receipt-to-rating stack follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 81 tests. `npm --prefix mobile-app run qa:production-guards` and `git diff --check` passed. The proof covers passenger receipt opening rating via stack replacement instead of stack-preserving navigation, including the fallback driver-id target path, so the completed receipt cannot remain below rating and be reopened by back navigation.
- Visible route viewport dependency follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/driver-online-toggle.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-ride-screens.test.js` passed with 4 suites / 125 tests, including a tall-bottomsheet multi-vertex route where every route point projects inside the visible map rectangle. `homeRouteViewportPadding` is now part of the Home route viewport dependency set, so route camera regions can react to bottomsheet/overlay padding changes without waiting for route coordinates to change.
- Extreme bottomsheet viewport follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js` passed with 1 suite / 8 tests, and the integrated map/lifecycle set `__tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/driver-online-toggle.test.js __tests__/prototype-ride-screens.test.js` passed with 4 suites / 133 tests. The route viewport calculation now fits route vertices inside the actual exposed map area when the bottomsheet is taller than the ideal minimum visible height, instead of pretending a larger visible area exists and risking route overlap behind the sheet.
- Passenger active-trip route visibility follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 91 tests after adding measured-map geometry assertions. The proof now projects route vertices into screen coordinates and verifies they remain inside the visible map window above the bottomsheet for passenger `accepted`, `arrived`, and `started` states while pan/zoom/rotate remain enabled.
- Passenger paid-search fare follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 92 tests. `RobotaxiDriverSearchScreen` now resolves the protected search fare from paid/captured sources (`paymentState`, `activeBooking.paymentData`, gross/payment amount fields, and cents aliases) before falling back to mutable `selectedFare` or `estimatedFare`; the proof covers a stale R$ 80,00 estimate being ignored in favor of the R$ 27,50 paid gross on the search card and in the handoff to `RobotaxiPrototypeTrip`.
- Dashboard current financial-contract follow-up: `npm --prefix leaf-dashboard-js run smoke:backoffice` passed after adding a current-dashboard reconciliation fixture and DOM assertions for backend-final money values. The smoke now proves `leaf-dashboard-js` renders the financial reconciliation contract from backend cents (`R$ 27,50` passenger gross/payment, `R$ 26,01` driver net, `R$ 0,84` Leaf fee, `R$ 0,65` Woovi fee), fails if a stale `R$ 80,00` estimate appears as money evidence, and fails if the current dashboard calls deprecated `/metrics/financial` or `/metrics/financial/advanced` endpoints. `node --check leaf-dashboard-js/scripts/tests/smoke-backoffice.cjs` passed. Backend support for the same contract was revalidated with `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/dashboard-ride-monitoring-service.unit.test.js tests/unit/services/modern-metrics-service.unit.test.js tests/unit/routes/metrics-financial-routes.unit.test.js tests/unit/services/ride-financial-contract.unit.test.js tests/unit/services/receipt-service.unit.test.js tests/unit/services/payment-dispatch-service.unit.test.js`, passing 6 suites / 39 tests.
- Passenger quote-lock no-flash follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/destination-quote-recalculation.test.js` passed with 1 suite / 14 tests. Initial route pricing is now accepted only when it carries a backend `quoteLockId`; a valid home quote preserves `quoteLockId`/expiration through confirmation/Pix, while a route quote without backend lock is ignored and refetched, proving stale `R$ 81,59` never flashes before the locked `R$ 80,39` quote.
- Lifecycle alias/blank-state follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/destination-quote-recalculation.test.js __tests__/passenger-flow-routing.test.js __tests__/prototype-ride-screens.test.js` passed with 3 suites / 114 tests. Passenger and driver screens now share runtime lifecycle normalization for aliases such as `no_drivers_available`, `driver_arrived`, and `trip_started`; terminal no-driver aliases route to the no-driver surface, active driver aliases keep the trip sheet locked, and the passenger accepted state renders without a blank screen even when pickup distance/ETA are absent.
- Dashboard metrics/simulator follow-up: `npm --prefix leaf-dashboard-js run qa:backoffice` passed after extending the current-dashboard smoke to `/metrics` and `/financial-simulator`. `/metrics` now renders current backend financial fields (`totalValue`, `averageValue`, reconciliation counts) instead of legacy `totalRevenue`/`averageTicket` names, and the financial simulator is hidden/disabled unless `runtimeFlags.launch.financialSimulatorEnabled === true`; smoke fails if current QA calls deprecated financial endpoints or `/metrics/simulation/run`.
- Locked payment amount follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-payment-availability.test.js __tests__/woovi-payment-modal.test.js __tests__/payment-service-quote-lock.test.js` passed with 3 suites / 12 tests. `RobotaxiPaymentScreen` no longer has the hardcoded `22.43` fallback; Pix opening now requires both a valid backend quote lock and a positive locked amount, stale route fare is ignored in favor of the locked backend quote, and the legacy booking handoff passes `null` instead of inventing a fare when no numeric plan fare exists. `rg "22\\.43" mobile-app/src mobile-app/__tests__` returns no matches.
- Map viewport and lifecycle alias follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-lifecycle-state-guard.test.js __tests__/passenger-flow-routing.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-ride-screens.test.js __tests__/driver-receipt-screen.test.js` passed with 6 suites / 137 tests. The proof now covers route vertices staying inside the visible map when both top overlay and bottomsheet are active, driver offer and driver trip measured-map route vertices staying above the sheet, lifecycle guard normalization for terminal aliases such as `trip_completed`/`no_drivers_available`, active alias regression blocking such as `trip_started -> driver_accepted`, passenger/driver trip receipt replacement from completion aliases, search/payment-success terminal routing without falling back to map, driver active-trip rehydration from `activeBooking` aliases, and driver receipt/rating submit/skip/failure closure behavior.
- Driver document rejection-state follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-new-surfaces.test.js __tests__/user-database-service.onboarding.test.js __tests__/document-step.kyc.test.js __tests__/qa-flow-inventory-release-signup.test.js` passed with 4 suites / 20 tests. The proof covers `rejected` and `needs_attention` document statuses rendering as `revisar`/`Reenviar` with explicit reasons in driver documents/activation instead of falling back to a misleading pending state, while registration still keeps approval/document fields backend-governed.
- Active ride chat/support scope follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-new-surfaces.test.js` passed with 2 suites / 93 tests, and `npm --prefix mobile-app run test:unit -- --runInBand __tests__/websocket-manager-support-scope.test.js __tests__/support-chat-service-fail-visible.test.js __tests__/support-screen-fail-visible.test.js __tests__/support-service-fail-visible.test.js` passed with 4 suites / 9 tests. The proof covers passenger and driver active-trip chat buttons carrying `bookingId`, `bookingStatus`, and `source`; chat load/retry/send using the scoped ride context instead of relying only on ambient runtime state; and support-ticket-to-chat handoff preserving the same ride scope.
- Cancellation lifecycle scope follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/driver-online-toggle.test.js` passed with 2 suites / 120 tests. The proof covers passenger and driver active-trip cancellation buttons carrying `bookingId`, `bookingStatus`, and `source`; the cancellation screen invoking the driver cancellation flow for `driver-trip` instead of the passenger search flow; runtime cancellation resolving `bookingId` from scoped params or driver/passenger active ride state; search cancellation carrying scoped terminal context after the backend ACK; and completed search cancellation rendering as a terminal state without sending a second cancel command.
- Receipt/rating terminal-close follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/rating-service.prototype.test.js __tests__/receipt-service.test.js` passed with 3 suites / 95 tests. The proof covers completed-trip receipts closing directly to the map even when stack history exists; receipt-launched ratings exposing an explicit `Agora não` exit that dismisses completed receipt state and replaces to the map instead of reopening the receipt; successful passenger rating still clearing the completed cycle and returning to the map; and failed rating submission keeping the rating surface open without falsely clearing terminal receipt state.
- Support/report severity scope follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-new-surfaces.test.js __tests__/prototype-ride-screens.test.js __tests__/websocket-manager-support-scope.test.js __tests__/support-chat-service-fail-visible.test.js __tests__/support-screen-fail-visible.test.js __tests__/support-service-fail-visible.test.js` passed with 6 suites / 110 tests. The proof covers receipt-launched support resolving billing/Pix to payment severity, ticket/incident/complaint payloads preserving `bookingId`, `bookingStatus`, `source`, `priority`, and `severity`, complaint inputs exposing stable QA labels, and support/complaint fallback routes returning to receipt/trip surfaces instead of falling through to a clean map.
- Dashboard current-vs-legacy boundary follow-up: `npm --prefix leaf-dashboard-js run qa:backoffice` passed after adding the `data-leaf-dashboard-generation="current-next"` DOM marker to the Next layout and making the backoffice smoke require it on every checked route. The proof confirms the validated dashboard is `leaf-dashboard-js` (`/dashboard`, `/support`, `/campaign-center`, `/drivers/review-queue`, `/financial-reconciliation`, `/runtime-flags`), not the legacy/static maintenance server. The legacy `dashboard-server.js`/3002 maintenance files are documented as non-QA/non-feature evidence.
- Support/chat close-return follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-new-surfaces.test.js` passed with 2 suites / 105 tests. The proof now covers chat close and direct support-ticket close returning to the canonical active ride/driver trip/receipt route with `bookingId`, `bookingStatus`, and `source`, instead of falling through to the generic map/root surface.
- Auxiliary lifecycle alias follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-new-surfaces.test.js __tests__/prototype-ride-screens.test.js` passed with 2 suites / 144 tests. `node --check` passed for `RobotaxiChatScreen.js`, `RobotaxiSupportScreen.js`, `RobotaxiSupportTicketScreen.js`, `RobotaxiComplainScreen.js`, `RobotaxiCancellationScreen.js`, `RobotaxiPublicTripTrackingScreen.js`, and the touched test files. `npm --prefix mobile-app run qa:production-guards` and `git diff --check` passed. The proof covers auxiliary chat/support/ticket/complaint/cancellation/public-tracking surfaces normalizing lifecycle aliases such as `trip_completed` and `trip_started` before rendering, navigating, submitting support payloads, or issuing cancellation commands; terminal completed aliases return to receipt/clean map paths and do not reopen or cancel an already completed ride.
- Driver active identity/status fail-visible follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 128 tests. `node --check` passed for `RobotaxiDriverTripScreen.js` and `prototype-ride-screens.test.js`; `npm --prefix mobile-app run qa:production-guards` and `git diff --check` passed. The proof covers protected driver statuses such as `trip_started` arriving without `activeBookingId`, `driverActiveRide.bookingId`, or route booking params: the driver trip surface now renders an explicit synchronization state, keeps the sheet/backdrop locked, disables state-changing actions, avoids the generic `Nenhuma corrida ativa` empty state, and does not navigate back to the map until the backend provides canonical ride identity. It also covers stale ride payload status not regressing a runtime `started` driver trip back to the previous `accepted` UI/actions.
- Passenger home terminal-route follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js` passed with 1 suite / 37 tests. `node --check` passed for `RobotaxiHomeScreen.js` and `driver-online-toggle.test.js`. The proof covers passenger Home runtime sync routing terminal `no_drivers_available` directly to `RobotaxiPrototypeNoDrivers` and terminal `cancelled` directly to `RobotaxiPrototypeCancellation`, preserving `bookingId`/`rideId`/`tripId` in route params and avoiding the previous fallback into `RobotaxiPrototypeDriverSearch`.
- Receipt/rating terminal context follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 131 tests, and `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js` passed with 1 suite / 37 tests. `node --check` passed for `RobotaxiDriverTripScreen.js`, `RobotaxiReceiptScreen.js`, `RobotaxiRatingScreen.js`, `RobotaxiPaymentSuccessScreen.js`, `RobotaxiDriverSearchScreen.js`, `prototype-ride-screens.test.js`, and `driver-online-toggle.test.js`; `npm --prefix mobile-app run qa:production-guards` and `git diff --check` passed. The proof covers completed passenger trip, completed driver trip, payment-success terminal completion, passenger search terminal completion, and Home terminal completion all routing to `RobotaxiPrototypeReceipt` with canonical `bookingId`/`rideId`/`tripId` and available gross fare context; receipt recovery now uses the route booking id when no payload is hydrated; Android/back removal on receipt and rating is converted into the terminal close path instead of reopening the completed ride or returning to a stale active surface.
- Terminal lateral-surface receipt context follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/destination-quote-recalculation.test.js` passed with 1 suite / 15 tests, `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passed with 1 suite / 132 tests, `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js` passed with 1 suite / 37 tests, and the viewport contract set `__tests__/active-route-viewport-contract.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js` passed with 3 suites / 19 tests. `node --check` passed for `RobotaxiDestinationScreen.js`, `RobotaxiNoDriversScreen.js`, `RobotaxiHomeScreen.js`, and the touched test files; `npm --prefix mobile-app run qa:production-guards` and `git diff --check` passed. The proof closes remaining lateral routes that could open `RobotaxiPrototypeReceipt` with only `{ fromTrip: true }`: destination completion, no-driver terminal completion, Home deep-link receipt, passenger receipt QA open, driver Home primary complete, driver QA complete, and driver live overlay completion now carry canonical booking identifiers and any available gross fare context. The same pass revalidated the bottomsheet-aware route viewport contract so active route surfaces keep route camera/padding tied to the visible map frame.
- Payment/driver availability fail-closed follow-up: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/create-booking-availability-precheck.unit.test.js tests/unit/routes/payment-advance-availability.unit.test.js` passed with 2 suites / 12 tests, and `npm --prefix leaf-websocket-backend run test:integration -- --runInBand tests/integration/contracts/create-booking-availability-precheck.contract.test.js` passed with 1 suite / 2 tests. The proof covers Pix creation blocked before provider call when no eligible driver exists, paid booking materialization blocked before `RequestRideCommand`, and the create-booking availability helper failing closed for confirmed payments when pickup coordinates or the checker are missing instead of returning a reusable `skipped` state.
- Pre-accept passenger state follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/passenger-flow-routing.test.js __tests__/runtime-crash-recovery.test.js __tests__/prototype-ride-screens.test.js` passed with 3 suites / 101 tests. `node --check` passed for `passengerFlowRouting.js` and `rideLifecycleContract.js`; `npm --prefix mobile-app run qa:production-guards`, `git diff --check`, governance, tracked secret scan, and hardcoded-secret guard all passed. The proof covers backend pre-accept statuses staying on the passenger search surface and verifies that an `AWAITING_RESPONSE` booking with confirmed payment plus `driverInfo` does not navigate to `RobotaxiPrototypeTrip`.
- Financial policy approval follow-up: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-financial-contract.unit.test.js tests/unit/scripts/validate-runtime-config.unit.test.js` passed with 2 suites / 42 tests. `node --check` passed for `ride-financial-contract.js` and `validate-runtime-config.js`; governance, tracked secret scan, hardcoded-secret guard, and `git diff --check` passed. A plain `npm --prefix leaf-websocket-backend run config:validate` now fails as designed with the blocker `Política financeira ativa sem aprovação explícita...`; rerunning the same validator with `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF=local-validator-mechanics-only` returns `ok: true`, preserving only the expected KYC warning and proving Firebase/Google remain clean. This does not approve the business policy; it proves the guard works.
- Route provenance follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/driver-online-toggle.test.js __tests__/prototype-map-route.test.js __tests__/destination-quote-recalculation.test.js` passed with 5 suites / 148 tests. `node --check` passed for `PrototypeMapLayer.js`, `RobotaxiHomeScreen.js`, and `RobotaxiDriverOfferScreen.js`; `npm --prefix mobile-app run qa:production-guards`, governance, tracked secret scan, hardcoded-secret guard, and `git diff --check` passed. The proof covers short real routes not being labeled synthetic by point count, fallback provenance being passed explicitly from Home to the map, destination quote route publication staying real-route-only, and driver offers without canonical route coordinates rendering no fabricated straight polyline.
- Measured map viewport follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js` passed with 3 suites / 104 tests. `node --check` passed for `RobotaxiDriverOfferScreen.js` and `RobotaxiDriverTripScreen.js`. The proof covers driver offer and active driver trip maps recalculating `routeViewportRegion`/padding after receiving a real map layout of `360x640`, keeping the bottom padding bounded by the actual exposed area and preserving active driver-trip map interaction.
- Explicit visible map frame follow-up: `node --check mobile-app/src/screens/prototype/prototypeRouteViewport.js` passed. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js` passed with 2 suites / 15 tests, and the integrated set `__tests__/prototype-ride-screens.test.js __tests__/driver-online-toggle.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js` passed with 4 suites / 157 tests. The proof adds `buildVisibleRouteViewportFrame` as the explicit route-safe map rectangle and verifies route points project inside that frame when a top overlay and a tall bottomsheet are both active.
- 2026-06-24 route/lifecycle revalidation: `node --check` passed for `prototypeRouteViewport.js`, `PrototypeMapLayer.js`, `RobotaxiTripScreen.js`, `RobotaxiDriverTripScreen.js`, `RobotaxiDriverOfferScreen.js`, `RobotaxiHomeScreen.js`, `rideLifecycleStateGuard.js`, `passengerFlowRouting.js`, `rideLifecycleSurfaceMatrix.js`, and `prototypeRideRuntime.js`. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/active-route-viewport-contract.test.js` passed with 3 suites / 19 tests. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-lifecycle-state-guard.test.js __tests__/passenger-flow-routing.test.js __tests__/ride-lifecycle-surface-matrix.test.js __tests__/prototype-ride-screens.test.js __tests__/driver-receipt-screen.test.js` passed with 5 suites / 154 tests. This is focused code evidence only; Android screenshot/tap/drag smoke remains an operational gate.
- 2026-06-24 cancellation/navigation hardening: driver active-trip cancellation now targets a shared prototype route instead of a passenger-only registration, terminal cancellation dismiss replaces to the clean map instead of `goBack()`, and direct `MapView + Polyline` renderers are source-inventoried so new route-map surfaces must be classified before landing. `node --check` passed for `AppNavigator.js`, `RobotaxiCancellationScreen.js`, `active-route-viewport-contract.test.js`, `legacy-financial-routes.test.js`, and `prototype-ride-screens.test.js`. `npm --prefix mobile-app run test:unit -- --runInBand __tests__/active-route-viewport-contract.test.js __tests__/legacy-financial-routes.test.js __tests__/prototype-ride-screens.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/ride-lifecycle-surface-matrix.test.js __tests__/passenger-flow-routing.test.js` passed with 6 suites / 164 tests. `git diff --check` passed. Device validation is still required for Android hardware back, drag/backdrop gestures, and real late socket events.
- Payment auto-open availability follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-payment-availability.test.js __tests__/destination-quote-recalculation.test.js` passed with 2 suites / 15 tests. `node --check` passed for `RobotaxiPaymentScreen.js`. The proof covers `autoOpenPix` failing closed on no-driver/geofence availability, preserving the backend availability message, not opening the Woovi modal, not calling `requestRide`, and opening Pix only after availability passes.
- Pix quote-lock fail-closed follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-payment-availability.test.js __tests__/woovi-payment-modal.test.js __tests__/destination-quote-recalculation.test.js` passed with 3 suites / 20 tests. `node --check` passed for `RobotaxiPaymentScreen.js` and `WooviPaymentModal.js`. The proof covers payment `autoOpenPix` refusing to call availability or open Woovi when the backend quote lock is missing, valid quote locks being forwarded to the modal, and `WooviPaymentModal` refusing to call `/api/payment/advance` without `quoteLockId`.
- Legacy Pix quote-lock adapter follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/payment-service-quote-lock.test.js __tests__/payment-no-direct-woovi-guard.test.js` passed with 2 suites / 30 tests. `node --check` passed for `paymentService.js`. The proof covers `paymentService.createPixCharge` rejecting locally before any backend Pix call when `quoteLockId` is missing, forwarding locked quote metadata when present, and continuing to use only Leaf backend payment paths instead of direct Woovi provider calls.
- Legacy map opt-out release guard follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/legacy-financial-routes.test.js __tests__/payment-service-quote-lock.test.js` passed with 2 suites / 7 tests. `npm --prefix mobile-app run qa:production-guards` and `node --check mobile-app/scripts/qa/validate-release-runtime-policy.cjs` passed. The proof covers production/internal/review EAS profiles explicitly setting `EXPO_PUBLIC_FORCE_LEGACY_MAP_UI=false`, the release runtime validator blocking that flag, and `release-preflight.sh` treating it as a dangerous release flag.
- Canonical navigator legacy-route isolation follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/legacy-financial-routes.test.js` passed with 1 suite / 5 tests, and `node --check mobile-app/__tests__/legacy-financial-routes.test.js` passed. The proof covers the Robotaxi navigator branch excluding legacy ride/payment screen names, while the private legacy branch remains the only branch that can register those routes.
- Deep link / FCM canonical route guard follow-up: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/legacy-financial-routes.test.js __tests__/fcm-notification-service.test.js` passed with 2 suites / 30 tests, and `node --check` passed for both test files. The proof covers app linking, FCM allowlisted routes, and FCM aliases excluding legacy ride/payment route names; it also covers legacy push `screen` names such as `PaymentSuccess` and `DriverSearch` resolving to canonical Robotaxi routes when the notification type is known.

## Remaining Production Gates

The code-level controls above are validated locally. The following gates remain operational evidence, not inferred evidence:

1. Execute the authorized Android L2 run with the installed Play/internal-test build, correct runtime/OTA group, and a passenger starting from idle or an explicitly resolved terminal state.
2. Capture the runner preflight proving device GPS pickup, geofence allowance, backend sandbox policy for the passenger, and an eligible online driver in the same operational region before payment is opened.
3. Capture the provider-backed Woovi sandbox charge and signed confirmation, then reconcile the exact passenger gross, retained fees, driver net, receipt, dashboard, payment distribution, and ledger for the same ride id.
4. Capture passenger and driver Socket.IO evidence for acceptance, arrival, start, completion, delayed/replayed events, chat history/read state, rating retry, receipt closure, map tap/pan/zoom, and cold relaunch.
5. Run the provider-backed KYC/liveness/face-compare happy path plus mismatch/manual-review/retry. The code fails closed in production, but `KYC_PRODUCTION_BIOMETRICS_ENABLED=false` means that provider readiness is not yet evidenced.
6. Configure FCM production delivery and capture one real notification delivery/receipt without introducing direct client-to-provider calls.
7. Capture an authorized dashboard suspension/reactivation on a non-live test driver: prove immediate Redis de-eligibility, audit record, and that reactivation does not bypass pending document, vehicle, KYC, or liveness gates.
8. With withdrawals still disabled for normal users, use an authorized sandbox driver to request and process one controlled Pix Out. Reconcile the exact requested amount, withdrawal fee, balance delta, Woovi transfer id/correlation id, dashboard record, and both withdrawal ledger events.

## Independent Subsystem Closure Matrix

This is the working checklist for the remaining production-readiness pass. "Implemented" means local code/tests protect the invariant; "pending" means real device, provider, dashboard, or operator evidence is still required.

| Subsystem | Current status | Remaining proof before 100% |
| --- | --- | --- |
| Passenger signup and login | Android release-safe flows are inventory-ready; OTP simulation fails closed in production unless explicitly bypassed. | Run passenger signup/login on release/internal-test build and record provider/auth evidence. |
| Driver signup, documents, and activation | CNH/CRLV upload flow is release-safe on Android inventory; backend CRLV extraction normalizes model/plate/color and dashboard projection. | Run real document upload, OCR/analysis, approval/rejection, active vehicle binding, and dashboard identity evidence. |
| Driver approval and manual overrides | Mass approval is disabled; quick approval/KYC unblock requires audited actor, reason, provenance, and evidence. | Product decision on manual override scope, plus dashboard walkthrough proving audit trail and no eligibility bypass. |
| Face compare and KYC liveness | Backend fails closed for untrusted/client-declared biometric approval; driver eligibility uses canonical activation/KYC state. | Provider-backed AWS/Leaf face-compare happy path, mismatch/manual review, retry, and mobile blocking evidence. |
| Ride lifecycle passenger and driver | Mobile/backend focused tests protect monotonic state, terminal closure, active sheets, receipt/rating return, and late-event rejection. | L2 Android run with real passenger and driver: acceptance, arrival, start, completion, delayed/replayed events, relaunch, map taps/back actions. |
| Payment, quote, and finance | Quote lock, no-driver pre-Pix guard, provider-backed start, ledger-before-dispatch, backend-final snapshot, receipt, dashboard, and ledger guards are implemented. | Same ride id reconciliation across quote, Pix sandbox, Woovi confirmation, app, receipt, dashboard, payment distribution, ledger, Leaf fee, Woovi fee, toll/pass-through, and driver net. |
| Route, map, traffic, and bottomsheet | Focused tests cover visible map viewport, bottomsheet-aware route camera, no synthetic straight-line fallback, and traffic segment propagation. | Device screenshots/XML/video for first render and final render, including route visibility above bottomsheet and traffic colors when backend route has segment data. |
| Rating and receipt | Backend rating is scoped/idempotent; mobile returns to clean map after rating; receipt requires backend-final financial snapshot. | Real rating submit/retry/relaunch evidence and receipt/dashboard equality for the completed ride. |
| Chat in active ride | Socket.IO chat derives participants from authenticated ride scope, persists before ack, and supports history/read state with mobile error visibility. | Real passenger-to-driver and driver-to-passenger chat, history reload, read receipt, denied-scope evidence. |
| Support, incident reports, and severity | Support/incident/report/ticket scope is backend-enforced; severity classifier and dashboard freshness are covered by local QA. | Real support ticket id, severity/orchestrator classification, dashboard visibility, operator assignment/escalation, chat history, and audit trail. |
| Dashboard and user management | Current `leaf-dashboard-js` Next dashboard passed `qa:backoffice`; legacy static dashboard is not accepted as product evidence. | Reconcile one live L2 ride and one suspension/reactivation operation through the current dashboard. |
| Security and antifraud policies | Sensitive routes have scope guards; production config blocks legacy/manual payment distribution and unapproved financial policy. | Live operational proof for suspension/blocking, fraud/safety edge flows, and final decision on financial policy id. |
| Reset password and auth recovery | Firebase/custom auth routes are guarded; production custom OTP simulation fails closed. | Provider-backed reset/recovery smoke on release build if custom OTP/password path remains in production scope. |
| Push notifications | FCM/deep-link route guards protect canonical navigation aliases. | Configure production FCM delivery and capture one real notification delivery/receipt without direct client provider calls. |
| Offline/local fallback | P0/P1 code path implemented for local snapshot, outbox metadata, backend intent guard, active offline UI, terminal cleanup, location batch flush, passenger stale-signal display, backend stale-signal alerting, and backoffice stale-signal visibility. | Run Android airplane-mode/reconnect proof and add dashboard/provider evidence for pending/rejected offline intents under network/battery loss scenarios. |

## L2 Smoke Preconditions

The next complete smoke starts only when all preconditions are true:

1. Android device is connected and visible in ADB.
2. Installed app is the correct Play/internal-test build and runtime `1.0.3`.
3. OTA group is recorded.
4. Backend health is OK.
5. Payment runtime canary confirms Woovi sandbox for the passenger test user.
6. Pickup/destination are inside geofence, or the test geofence override is explicitly recorded before payment.
7. Passenger starts from idle or from a product-resolved terminal state. No stale search is allowed.
8. Driver is online, eligible, unlocked, same region, close to pickup, and listening before passenger payment.
9. Driver active vehicle identity is canonical and complete: model, plate, color, provenance.
10. Backend quote returns canonical route and fare before UI shows the final fare card.
11. Dashboard/admin credentials can read the ride/finance evidence or the run is marked blocked for dashboard evidence.

## L2 Required Assertions

- Destination entry does not show a provisional fare that changes within a second.
- Quote has an expiration and remains frozen until expiration or explicit destination/origin change.
- Polyline renders once as a real route; no straight-line placeholder is visible as final or intermediate customer evidence.
- Traffic coloring appears when the backend route payload has traffic segment data.
- Payment screen cannot open if no eligible driver is available.
- Pix sandbox charge exists in Woovi sandbox evidence.
- Dispatch starts only after backend payment confirmation.
- Passenger app cannot move to driver-on-the-way before actual accepted event.
- A driver disconnect after acceptance and before boarding remains an explicit continuation state, never a generic new-search or map-only regression.
- Accepted screen shows route from driver to pickup, ETA, model, plate, and color.
- Started screen shows trip progress animation and route progress surface.
- Bottomsheet never collapses to map-only during searching, accepted, arrived, started, completed, receipt, or rating.
- Completion cannot regress to active trip by tapping the map or navigating back.
- Rating submits once and returns to clean map.
- Receipt is available and reconciles with backend/dashboard.
- Cold relaunch after rating shows clean map, not old active ride.

## 2026-06-24 Financial Quote Lock Guard

Objective: preserve the backend quote lock and payment amount chain from Pix confirmation through booking creation, Redis active booking snapshot, receipt/dashboard consumers, and financial reconciliation.

Scope completed:

- `WooviPaymentModal` now returns `quoteSessionId` and `quoteLockId` with every payment confirmation path, including persisted-charge recovery and websocket confirmation.
- Passenger ride runtime now fails closed for real Pix confirmations that do not carry `quoteLockId`; QA bypass/mock payments remain allowed.
- `RequestRideCommand` persists payment gross amount, quote session, and quote lock alongside the paid amount.
- `ride-queue-manager` serializes those payment fields into both canonical and visible Redis booking snapshots.
- Backend validation schema explicitly recognizes payment gross amount and quote lock metadata in `paymentData`.

Evidence:

- `node --check mobile-app/src/components/payment/WooviPaymentModal.js`
- `node --check mobile-app/src/screens/prototype/prototypeRideRuntime.js`
- `node --check leaf-websocket-backend/commands/RequestRideCommand.js`
- `node --check leaf-websocket-backend/services/validation-service.js`
- `node --check leaf-websocket-backend/services/ride-queue-manager.js`
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/woovi-payment-modal.test.js __tests__/destination-quote-recalculation.test.js` PASS, 20 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/commands/RequestRideCommand.unit.test.js tests/unit/services/ride-queue-manager.unit.test.js` PASS, 6 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-confirm-payment-handler.unit.test.js tests/unit/services/authoritative-payment-confirmation-service.unit.test.js tests/unit/services/quote-lock-service.unit.test.js` PASS, 7 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.

Open risk:

- `npm --prefix leaf-websocket-backend run config:validate` remains blocked by environment approval config: `LEAF_APPROVED_FINANCIAL_POLICY_ID` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` are not configured. The only warning surfaced by that run is KYC production biometrics disabled. This should not be bypassed by code; production config must carry the approved policy reference.

## Post-Audit Correction - 2026-06-24

Objective: keep the backend-final financial snapshot visible on every completion response path, including idempotent replay, so API/dashboard/mobile consumers do not need to fall back to weaker fare fields after a completed ride.

Scope completed:

- `CompleteTripCommand` now returns the same backend-final financial fields that it persists and emits in the canonical `ride.completed` event: `financialSnapshot`, `authoritativeSnapshot`, `financialSnapshotSource`, Leaf operational fee, Woovi intermediation fee, total fees, and driver net.
- The already-completed/idempotent replay path now hydrates those fields from the stored booking snapshot instead of returning only coarse fare data.
- Focused command coverage now proves normal completion and idempotent completion replay expose the immutable backend-final snapshot.

Evidence:

- `node --check leaf-websocket-backend/commands/CompleteTripCommand.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/commands/CompleteTripCommand.unit.test.js` PASS.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/commands/CompleteTripCommand.unit.test.js tests/unit/services/ride-financial-contract.unit.test.js tests/unit/services/receipt-service.unit.test.js tests/unit/services/financial-ledger-service.unit.test.js tests/unit/workers/worker-billing.unit.test.js` PASS, 5 suites / 54 tests.
- `git diff --check` PASS.

Open risk:

- `npm --prefix leaf-websocket-backend run config:validate` is still blocked by the intended production guard: `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` are not configured in the loaded production env. It also warns that strict KYC production biometrics are disabled. This remains a release/configuration blocker, not a code-test failure.

## Post-Audit Correction - 2026-06-24 Dashboard Current Money Source

Objective: make the current dashboard and metrics pipeline consume the immutable backend-final financial snapshot as the first money source for completed rides.

Scope completed:

- Confirmed the active dashboard is `leaf-dashboard-js`, not the legacy dashboard. The rendered app carries `data-leaf-dashboard-generation="current-next"` and the backoffice smoke checks this.
- `dashboard-ride-monitoring-service` now recognizes `financialSnapshot.authoritativeSnapshot=true` plus `financialSnapshotSource=backend_final` even when those flags are nested inside the snapshot.
- Completed-ride dashboard resolvers now prefer cent-precise `financialSnapshot.passengerPaidCents`, `operationalFeeCents`, and `driverNetAmountCents` over stale top-level money fields.
- Completed rides without backend-final snapshot still return zero-value financials and remain marked as pending reconciliation instead of rendering quote/estimate/fallback money.

Evidence:

- `node --check leaf-websocket-backend/services/dashboard-ride-monitoring-service.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/services/dashboard-ride-monitoring-service.unit.test.js` PASS.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/dashboard-ride-monitoring-service.unit.test.js tests/unit/routes/metrics-financial-routes.unit.test.js tests/unit/routes/dashboard-financial-route-guards.unit.test.js tests/unit/routes/drivers-legacy-admin-routes.unit.test.js` PASS, 4 suites / 21 tests.
- `npm --prefix leaf-dashboard-js run qa:backoffice` PASS. This ran lint, Next build, and smoke over the current dashboard routes; the smoke verified `current-next`, backend money contract rendering, no deprecated financial metrics endpoints, and no direct browser calls to Google, Woovi/OpenPix, or Firebase providers.
- `git diff --check` PASS.

Open risk:

- `npm --prefix leaf-websocket-backend run config:validate` remains blocked by the intended production guard: `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` are not configured. It also warns that `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`. This is still a release/configuration blocker and should not be bypassed.

## Post-Audit Correction - 2026-06-24 Active Route Viewport Refit

Objective: keep active and preview route camera fitting tied to the actually measured visible map area above the bottomsheet.

Scope completed:

- `RobotaxiHomeScreen` now includes measured map width and height in the active route viewport focus key. This forces route camera refit after the map leaves its initial window-size assumption and receives the real rendered map layout.
- The existing explicit visible-route region remains the source of truth for active passenger trip, active driver trip, paid driver offer, and focused Home route maps.
- The static viewport contract now prevents regressions where Home recalculates by route/sheet only and ignores measured map dimensions.

Evidence:

- `node --check mobile-app/src/screens/prototype/RobotaxiHomeScreen.js` PASS.
- `node --check mobile-app/__tests__/active-route-viewport-contract.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/active-route-viewport-contract.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-ride-screens.test.js __tests__/driver-online-toggle.test.js` PASS, 5 suites / 190 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- Real Android L2 still needs screenshot/tap/drag evidence proving the route remains visible and map remains manipulable above the bottomsheet across passenger accepted/arrived/started, driver offer, driver started, and destination preview/payment/search states.

## Post-Audit Correction - 2026-06-24 Terminal ActiveRideSync Guard

Objective: prevent stale or contradictory `activeRideSync` payloads from reopening a completed/canceled/no-driver ride as active on the mobile client.

Scope completed:

- `WebSocketManager` now normalizes terminal active-ride sync statuses (`COMPLETED`, `TRIP_COMPLETED`, `CANCELED/CANCELLED`, `NO_DRIVERS_*`, `REJECTED`, `EXPIRED`, `SUPERSEDED`, and operational terminal aliases).
- A terminal `activeRideSync` with `hasActiveRide=true` no longer emits `activeRideRehydrated`, `rideAccepted`, or `tripStarted`.
- Terminal/inactive sync now clears rehydration and lifecycle dispatch dedupe for that booking, so stale active events cannot piggyback on a completed booking fallback.
- Lifecycle booking fallback from `lastActiveRideSnapshot` is now allowed only for non-terminal active snapshots.

Evidence:

- `node --check mobile-app/src/services/WebSocketManager.js` PASS.
- `node --check mobile-app/__tests__/websocket-manager-active-ride-sync.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/websocket-manager-active-ride-sync.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/ride-lifecycle-surface-matrix.test.js __tests__/prototype-ride-screens.test.js __tests__/driver-online-toggle.test.js __tests__/runtime-crash-recovery.test.js` PASS, 6 suites / 199 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- L2 replay evidence is still required on a real Android session: complete ride, submit rating, relaunch/reconnect, replay stale `activeRideSync`/late lifecycle events, and prove the passenger remains on clean map or terminal receipt state instead of rehydrating an active ride.

## Post-Audit Correction - 2026-06-24 Backend ActiveRideSync Terminal Aliases

Objective: prevent the backend from returning an active ride sync snapshot when a stale active index points to a booking whose terminal status is stored under `bookingStatus` or a runtime alias.

Scope completed:

- `buildActiveRideSnapshotForUser` now considers `bookingStatus` alongside `status`, `state`, and `tripStatus` when deciding whether an indexed booking is terminal.
- `RideStateManager` terminal aliases now include `TRIP_COMPLETED`, `TRIP_CANCELED`, `TRIP_CANCELLED`, and `NO_DRIVERS`.
- A stale passenger active index pointing at `bookingStatus=trip_completed` now returns `hasActiveRide=false`, `bookingId=null`, `terminal=true`, `terminalBookingId`, and clears `customer_active_booking:{userId}`.
- Existing socket active-ride sync still avoids expired-search reconciliation for terminal snapshots and continues blocking legacy active-ride commands for terminal bookings.

Evidence:

- `node --check leaf-websocket-backend/bootstrap/active-ride-sync-utils.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/bootstrap/active-ride-sync-utils.unit.test.js` PASS.
- `node --check leaf-websocket-backend/services/ride-state-manager.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/services/ride-state-manager.unit.test.js` PASS.
- `node --check leaf-websocket-backend/bootstrap/register-socket-active-ride-handlers.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/bootstrap/register-socket-active-ride-handlers.unit.test.js` PASS.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/active-ride-sync-utils.unit.test.js tests/unit/bootstrap/register-socket-active-ride-handlers.unit.test.js tests/unit/services/ride-state-manager.unit.test.js` PASS, 3 suites / 15 tests.
- `git diff --check` PASS.

Open risk:

- Real L2 still needs to prove server and mobile together after reconnect/relaunch: terminal active indexes must be cleared in Redis, `activeRideSync` must return terminal/inactive metadata, and mobile must not reopen an active ride.

## Post-Audit Correction - 2026-06-24 Receipt/Rating Terminal Contract

Objective: make completed-ride rating resilient to terminal status aliases and idempotent replay, so a completed trip cannot be blocked from rating or locally marked with a value different from the backend-confirmed rating.

Scope completed:

- Backend rating eligibility now accepts lifecycle completion aliases used elsewhere in the runtime (`COMPLETE`, `COMPLETED`, `TRIP_COMPLETED`, `RIDE_COMPLETED`, `EARLY_ENDED_BY_RIDER`, `EARLY_ENDED_REVIEW`, and `INTERRUPTED_OPERATIONAL_ENDED`) while still rejecting pre-completion states.
- Socket `ratingSubmitted` success payload now exposes `idempotentReplay=true` when the backend returns a committed duplicate replay.
- Mobile `RobotaxiRatingScreen` now marks the completed receipt with the backend-confirmed `rating` and `comment` when present, instead of blindly using the current UI input after a replay.
- Receipt/rating terminal-close behavior remains unchanged: successful rating or skip clears completed receipt runtime state and replaces back to `RobotaxiPrototype`.

Evidence:

- `node --check mobile-app/src/screens/prototype/RobotaxiRatingScreen.js` PASS.
- `node --check mobile-app/__tests__/prototype-ride-screens.test.js` PASS.
- `node --check leaf-websocket-backend/services/rating-service.js` PASS.
- `node --check leaf-websocket-backend/bootstrap/register-socket-rating-handler.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/services/rating-service-lifecycle.unit.test.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/bootstrap/register-socket-rating-handler.unit.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/rating-service.prototype.test.js __tests__/receipt-service.test.js` PASS, 3 suites / 141 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/rating-service-lifecycle.unit.test.js tests/unit/bootstrap/register-socket-rating-handler.unit.test.js tests/unit/services/receipt-service.unit.test.js` PASS, 3 suites / 14 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- `npm --prefix leaf-websocket-backend run config:validate` still blocks production because `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` are not configured. Firebase and Google diagnostics are configured; the remaining warning is `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`.
- Real L2 still needs to prove one completed ride can be rated after `TRIP_COMPLETED`/reconnect, duplicate rating replay stays idempotent, and the app returns to the clean map.

## Post-Audit Evidence - 2026-06-24 Driver Pickup Route Viewport

Objective: ensure the driver-side accepted/arrived route to pickup stays visible above the live ride bottomsheet, remains interactive, and preserves traffic-colored route segments.

Scope completed:

- Added focused mobile coverage for `accepted` and `arrived` driver trip states using canonical `pickupRouteCoordinates`.
- The proof verifies the driver-to-pickup route is rendered from canonical route coordinates, traffic segments are forwarded, `showTraffic=true`, scroll/zoom remain enabled, and all route vertices fit inside the measured visible map area above the sheet.
- Existing viewport tests continue covering passenger accepted/arrived/started/operational hold, paid driver offer, driver started/operational hold, Home active route refit, and extreme tall-bottomsheet geometry.

Evidence:

- `node --check mobile-app/__tests__/prototype-ride-screens.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/active-route-viewport-contract.test.js` PASS, 4 suites / 156 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- This is unit/contract evidence. Real Android L2 still needs screenshots/video for passenger active route, driver accepted/arrived pickup route, driver started route, and map gestures while the bottomsheet is present.

## Post-Audit Correction - 2026-06-24 Driver Onboarding/Approval/Documents Gate

Objective: ensure driver registration, document analysis, KYC, vehicle identity, and dispatch eligibility remain backend-governed and fail closed when the canonical source is unavailable or incomplete.

Scope completed:

- Driver eligibility no longer infers `driverApproved=true` or `vehicleApproved=true` from missing Firebase profile data, incomplete Redis cache entries, runtime fallback data, or an absent active vehicle record.
- Missing `users/{driverId}` plus missing `user_vehicles/{driverId}` is now treated as unavailable canonical profile data, not as an empty approved profile.
- Existing dispatch eligibility continues to resolve the canonical activation gate before profile/category matching, so KYC/manual review, rejected documents, and activation-state lookup failures block ride eligibility.
- CRLV analysis evidence confirms normalized plate/model/color/RENAVAM are persisted in both `driver_activation/{driverId}/documents/crlv.data` and `users/{driverId}/documents/crlv.extractedData`, with raw OCR text removed.
- Mobile registration evidence confirms the app does not write `approved`, `canGoOnline`, `driverActivation`, `documents`, or `vehicles` into the base driver profile; those remain backend-owned.
- Mobile activation/document surfaces continue to render canonical CRLV identity, rejected document states, KYC handoff, and document empty states without local approval.

Evidence:

- `node --check leaf-websocket-backend/services/driver-eligibility-service.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/services/driver-eligibility-service.unit.test.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js` PASS.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/driver-eligibility-service.unit.test.js tests/unit/services/driver-activation-state-service.unit.test.js tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js tests/unit/routes/driver-approval-routes.unit.test.js tests/unit/routes/kyc-onboarding-routes.unit.test.js` PASS, 5 suites / 17 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/user-database-service.onboarding.test.js` PASS, 1 suite / 3 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-new-surfaces.test.js` PASS, 1 suite / 20 tests.

Open risk:

- This closes unit/contract coverage. Real L2 still needs an approved test driver with CRLV-derived vehicle identity, KYC-approved state, online transition, offer, acceptance, and receipt/dashboard identity comparison.

## Post-Audit Correction - 2026-06-24 Support/Chat/Report Scope Guard

Objective: ensure support chat, trip chat, incident report, emergency contact, and support tickets are scoped to the authenticated actor and fail visibly instead of creating empty UI, unpersisted messages, or cross-user leakage.

Scope completed:

- Socket support chat now authorizes the authenticated user before dispatching messages; regular users cannot target another user chat, and support actors are forced into `agent` sender type.
- Socket trip chat now uses the authenticated socket identity for sender/role, enforces ride participant scope before create/send/load/read, blocks pre-acceptance chat, blocks canceled-ride chat, and only allows post-trip lost-item reopening.
- Both support chat and trip chat now normalize message text, reject blank messages with `MESSAGE_REQUIRED`, reject oversized payloads with `MESSAGE_TOO_LONG`, and persist/emit the trimmed canonical message.
- Trip chat still refuses to acknowledge or deliver messages when Firestore persistence fails, avoiding phantom chat messages in the UI.
- Incident report, emergency contact, and support ticket creation validate booking scope when a booking is provided and reject non-participants.
- Support queue classification evidence confirms safety/emergency is N1, payment/refund/stuck flow is at least N2, and app users cannot inflate priority without trusted source evidence.
- Mobile support chat now fails locally and visibly for empty or oversized messages before socket/API calls, while history-load failures continue to surface instead of becoming an empty successful conversation.

Evidence:

- `node --check leaf-websocket-backend/services/socket-scope-guard.js` PASS.
- `node --check leaf-websocket-backend/bootstrap/register-socket-safety-support-handlers.js` PASS.
- `node --check leaf-websocket-backend/bootstrap/register-socket-engagement-chat-handlers.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/services/socket-scope-guard.unit.test.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/bootstrap/register-socket-safety-support-handlers.unit.test.js` PASS.
- `node --check leaf-websocket-backend/tests/unit/bootstrap/register-socket-engagement-chat-handlers.unit.test.js` PASS.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/socket-scope-guard.unit.test.js tests/unit/services/support-severity-classifier.unit.test.js tests/unit/bootstrap/register-socket-safety-support-handlers.unit.test.js tests/unit/bootstrap/register-socket-engagement-chat-handlers.unit.test.js tests/unit/services/support-queue-service.unit.test.js` PASS, 5 suites / 33 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/support-chat-service-fail-visible.test.js __tests__/support-service-fail-visible.test.js __tests__/support-screen-fail-visible.test.js __tests__/websocket-manager-support-scope.test.js` PASS, 4 suites / 11 tests.

Open risk:

- This is unit/contract evidence. Real L2 still needs support chat/ticket/incident exercised from a passenger and a driver during active ride, after completion, and as a non-participant denial case.

## Post-Audit Correction - 2026-06-24 Payment Availability and Financial Consistency

Objective: prevent payment confirmation/dispatch when no eligible driver can be proven available, and keep quote/payment/receipt/dashboard/ledger settlement values tied to the immutable backend-final financial snapshot.

Scope completed:

- Pix creation already blocked when no eligible driver is available; this pass extends the same fail-closed rule to socket `confirmPayment`.
- `confirmPayment` now uses the canonical availability pre-check, defaults `CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK` to false, emits `paymentError` with `NO_DRIVERS_AVAILABLE`, and returns without confirming payment/dispatch when no driver is eligible.
- Payment sandbox/mock no longer bypasses driver availability by default; bypass now requires the explicit environment flag.
- `server.vps.js` was kept in parity with the same fail-closed availability behavior, while `check:no-active-vps-runtime` confirms the active runtime path is the modular `server.js` stack.
- `processNetDistribution` now honors `subscriptionRetainedFeeCents` from the authoritative `backend_final` snapshot instead of recording zero retained subscription in settlement/distribution.
- Backend-final settlement with subscription retention is proven not to call legacy recalculation or rebuild the financial contract.
- Existing guards still require quote lock, provider-backed payment proof, backend-final receipt source, dashboard backend-final revenue source, worker backend-final snapshot validation, and ledger reconciliation against the immutable snapshot.

Evidence:

- `node --check leaf-websocket-backend/services/create-booking-availability-precheck.js` PASS.
- `node --check leaf-websocket-backend/bootstrap/register-socket-confirm-payment-handler.js` PASS.
- `node --check leaf-websocket-backend/server.vps.js` PASS.
- `node --check leaf-websocket-backend/services/payment-service.js` PASS.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/create-booking-availability-precheck.unit.test.js tests/unit/bootstrap/register-socket-confirm-payment-handler.unit.test.js tests/unit/services/payment-driver-availability-guard.unit.test.js tests/unit/routes/payment-advance-availability.unit.test.js` PASS, 4 suites / 20 tests.
- `npm --prefix leaf-websocket-backend run test:integration -- --runInBand tests/integration/contracts/create-booking-availability-precheck.contract.test.js` PASS, 1 suite / 4 tests.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-financial-contract.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js tests/unit/services/financial-ledger-service.unit.test.js tests/unit/services/receipt-service.unit.test.js tests/unit/workers/worker-billing.unit.test.js tests/unit/services/dashboard-ride-monitoring-service.unit.test.js tests/unit/commands/CompleteTripCommand.unit.test.js tests/unit/commands/RequestRideCommand.unit.test.js tests/unit/services/quote-lock-service.unit.test.js tests/unit/services/authoritative-payment-confirmation-service.unit.test.js tests/unit/routes/pricing-routes.unit.test.js` PASS, 11 suites / 113 tests.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime` PASS.
- `git diff --check` PASS.
- `npm run governance:check` PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only` PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh` PASS.
- `npm --prefix mobile-app run qa:production-guards` PASS.

Open risk:

- `npm --prefix leaf-websocket-backend run config:validate` still fails because production lacks explicit financial policy approval envs: `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF`.
- `config:validate` still warns `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`; Firebase and Maps diagnostics are configured.
- This is unit/contract evidence. Real L2 still needs a fresh ride smoke with passenger and driver in the same test region before store/OTA/deploy acceptance.

## Post-Audit Correction - 2026-06-24 Route Viewport Actual Occlusion

Objective: prevent active ride routes from being calculated behind the bottomsheet and keep live-ride map manipulation independent from a purely visual home-chrome flag.

Scope completed:

- `buildVisibleRouteEdgePadding` now keeps native/fallback map padding aligned with the measured bottomsheet occlusion when the ideal visible height cannot fit on small screens.
- The helper still uses the ideal `minVisibleHeight` when there is enough room, but no longer reduces bottom padding below the real occluded height just to preserve an abstract visible-height target.
- Active Home map interaction now depends on focused active ride state rather than `showHomeChrome`, while hidden Home maps under an overlay remain non-interactive.
- Passenger trip, driver offer, and driver trip tests now assert the actual measured occlusion values that protect the visible route frame (`392`, `356`, `318` in the focused fixtures), instead of accepting a capped value that could leave route pixels covered by the sheet.

Evidence:

- `node --check mobile-app/src/screens/prototype/prototypeRouteViewport.js` PASS.
- `node --check mobile-app/src/screens/prototype/RobotaxiHomeScreen.js` PASS.
- `node --check mobile-app/__tests__/prototype-ride-screens.test.js` PASS.
- `node --check mobile-app/__tests__/prototype-route-viewport.test.js` PASS.
- `node --check mobile-app/__tests__/active-route-viewport-contract.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/active-route-viewport-contract.test.js` PASS, 2 suites / 16 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-ride-screens.test.js` PASS, 2 suites / 141 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js` PASS, 1 suite / 37 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- This is code/unit/contract evidence. The next Android L2 run still must capture active passenger and driver route screenshots plus pan/zoom/tap gestures to prove the bottomsheet never collapses to map-only and the route remains visible above the sheet on the real device.

## Post-Audit Correction - 2026-06-24 Lifecycle Surface Non-Empty Contract

Objective: make every canonical lifecycle surface point to a real rendered UI marker, including Home/map cleared states that do not have a dedicated route name.

Scope completed:

- Driver terminal cleared states (`canceled`, `no_drivers_available`, and `rejected`) now require `driver-home-toggle-online` instead of accepting an empty `requiredTestIDs` array.
- The lifecycle surface matrix test now validates `requiredTestIDs` for route-less Home/map surfaces by reading `RobotaxiHomeScreen`, `PassengerHomeOverlay`, and `DriverHomeOverlay`.
- Passenger idle Home and driver cleared Home are now both proven against actual source, closing the gap where a route-less lifecycle state could pass the matrix while still rendering no actionable UI.

Evidence:

- `node --check mobile-app/src/screens/prototype/rideLifecycleSurfaceMatrix.js` PASS.
- `node --check mobile-app/__tests__/ride-lifecycle-surface-matrix.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-lifecycle-surface-matrix.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/passenger-flow-routing.test.js` PASS, 3 suites / 19 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js __tests__/prototype-ride-screens.test.js` PASS, 2 suites / 173 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js __tests__/ride-lifecycle-surface-matrix.test.js` PASS, 2 suites / 45 tests. This includes rendered Home proof for driver `canceled`, `no_drivers_available`, and `rejected`.
- `git diff --check` PASS.

Open risk:

- This is source/contract evidence. Android L2 still must capture real Home return after driver cancellation/no-driver/rejection and prove it is a clean actionable driver Home, not a blank map.

## Post-Audit Correction - 2026-06-24 KYC Active-Ride Deferral

Objective: ensure driver KYC/liveness/face-compare prompts cannot interrupt active driver work unless an approved safety incident flow explicitly owns that interruption.

Scope completed:

- `openDriverKycModal` now refuses to open while the driver has accepted or active work, including accepted/arrived/started/operational interruption/replacement surfaces.
- If a KYC modal is already visible and the driver state advances into active work, Home closes the modal and leaves the active ride surface canonical.
- Activation/reverification notification params remain deferred during active work instead of being consumed and lost; once the ride is no longer active, the normal KYC path can re-evaluate.
- Idle driver KYC behavior is unchanged: online-toggle KYC and activation notification KYC still open the canonical modal when no ride/offer is active.

Evidence:

- `node --check mobile-app/src/screens/prototype/RobotaxiHomeScreen.js` PASS.
- `node --check mobile-app/__tests__/driver-online-toggle.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-online-toggle.test.js` PASS, 1 suite / 42 tests.

Open risk:

- This is mobile unit/contract evidence. Provider-backed KYC/liveness/face-compare L2 still needs a real idle-driver pass plus mismatch/manual-review/retry evidence before production acceptance.

## Operational Directive - 2026-06-24 Backend-First L2 Preparation

Objective: prevent the next Android/device smoke from being used as a workaround for unfinished backend/local gates or missing dispatch preconditions.

Scope completed:

- `CANONICAL_SMOKE_TEST_DIRECTIVES.md` now explicitly requires local/backend validations before a real device/simulator L2 ride attempt.
- L2 ride smoke must record which role runs on the connected Android device and which role runs on simulator/emulator.
- Passenger and driver must be distinct, in the same region, and the driver must be online, eligible, unlocked, close to pickup, and listening before payment or ride request opens.
- Changes requiring OTA, backend deploy, or native build must carry the validation ladder used before release action. Production deploy, OTA promotion, store submission, and provider-console actions require explicit final operator approval after gates pass.

Evidence:

- `npm --prefix leaf-dashboard-js run qa:backoffice` PASS on 2026-06-24. This ran ESLint, a production Next build, and the current-dashboard smoke against `leaf-dashboard-js`, including the `data-leaf-dashboard-generation="current-next"` contract, protected routes, financial reconciliation fields, observability, runtime flags, and browser-side provider-call boundary.
- The legacy/static `scripts/maintenance/dashboard-server.js` remains maintenance-only and is not accepted as product QA evidence.
- Backend payment/finance/pricing/dashboard focused validation PASS on 2026-06-24: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/create-booking-availability-precheck.unit.test.js tests/unit/services/payment-driver-availability-guard.unit.test.js tests/unit/routes/payment-advance-availability.unit.test.js tests/unit/services/authoritative-payment-confirmation-service.unit.test.js tests/unit/services/quote-lock-service.unit.test.js tests/unit/services/ride-financial-contract.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js tests/unit/services/financial-ledger-service.unit.test.js tests/unit/services/receipt-service.unit.test.js tests/unit/services/dashboard-ride-monitoring-service.unit.test.js tests/unit/services/modern-metrics-service.unit.test.js tests/unit/routes/pricing-routes.unit.test.js tests/unit/routes/metrics-financial-routes.unit.test.js`, 13 suites / 118 tests.
- Backend lifecycle/socket/KYC/support focused validation PASS on 2026-06-24: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-confirm-payment-handler.unit.test.js tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/bootstrap/register-socket-active-ride-handlers.unit.test.js tests/unit/bootstrap/register-socket-driver-response-handler.unit.test.js tests/unit/bootstrap/register-socket-start-trip-handler.unit.test.js tests/unit/bootstrap/register-socket-complete-trip-handler.unit.test.js tests/unit/bootstrap/register-socket-rating-handler.unit.test.js tests/unit/bootstrap/register-socket-engagement-chat-handlers.unit.test.js tests/unit/bootstrap/register-socket-safety-support-handlers.unit.test.js tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js tests/unit/commands/RequestRideCommand.unit.test.js tests/unit/commands/StartTripCommand.unit.test.js tests/unit/commands/CompleteTripCommand.unit.test.js tests/unit/commands/CancelRideCommand.unit.test.js tests/unit/services/driver-eligibility-service.unit.test.js tests/unit/services/driver-activation-state-service.unit.test.js tests/unit/services/kyc-driver-status-service.unit.test.js tests/unit/services/driver-pool-monitor.unit.test.js tests/unit/services/ride-state-manager.unit.test.js tests/unit/services/ride-queue-manager.unit.test.js tests/unit/services/ride-offline-intent-validator.unit.test.js tests/unit/services/socket-scope-guard.unit.test.js tests/unit/services/support-severity-classifier.unit.test.js tests/unit/services/support-queue-service.unit.test.js`, 22 suites / 105 tests.
- Backend availability integration contract PASS on 2026-06-24: `npm --prefix leaf-websocket-backend run test:integration -- --runInBand tests/integration/contracts/create-booking-availability-precheck.contract.test.js`, 1 suite / 4 tests. This proves paid booking creation and confirmPayment availability blocking are wired before ride command execution in both modular and VPS runtime paths.
- Backend route/security/runtime guards PASS on 2026-06-24: `npm --prefix leaf-websocket-backend run test:route-guards`, `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`, `git diff --check`, `npm run governance:check`, `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`, and `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`.
- `npm --prefix leaf-websocket-backend run config:validate` remains intentionally blocked without an explicit financial policy approval reference. With `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF=local-validator-mechanics-only` set only for validator mechanics, the same command returns `ok: true`; Firebase and Google/Maps diagnostics are configured and the only warning is `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`.

Open risk:

- Android L2 has not been rerun after this directive. It remains pending until backend/local gates are closed and the device/simulator pair is prepared with a valid passenger, valid eligible driver, sandbox payment profile, and geofence-ready pickup/destination.

## Mobile Local Gate - 2026-06-24 Pre-L2 Readiness

Objective: validate the mobile core locally before using the connected Android device or simulator/emulator for L2 evidence.

Scope completed:

- Production/review runtime guards passed, including release profiles and legacy-map/payment/direct-provider safeguards.
- Route viewport, visible map area, bottomsheet padding, active route camera, lifecycle matrix, lifecycle state guard, passenger routing, driver overlay, KYC active-ride deferral, quote stability, Pix availability, receipt/rating, support/chat fail-visible behavior, offline snapshot/outbox/replay, FCM, onboarding/documents, Android runner contract, and legacy-route isolation were revalidated.
- The full mobile unit suite passed after the focused groups.
- Toolchain preflight passed when loaded through the repository's bash environment script: Java 17, Maestro 2.5.1, ADB, Android SDK/emulator, and the connected Android device are available.
- Runtime/build assessment: public Expo runtime is `1.0.3`; Android package is `br.com.leaf.ride` with `versionCode 119`; iOS bundle is `br.com.leaf.ride` with build `27`. No current diff exists in `android/`, `ios/`, `package.json`, `package-lock.json`, `app.config.js`, or `config/AppConfig.js`; the code changes are OTA-safe for runtime `1.0.3`. The only build-profile diff is `mobile-app/eas.json` adding `EXPO_PUBLIC_FORCE_LEGACY_MAP_UI=false` to production/review profiles, which affects future native builds/profile envs but does not itself force a new binary for the current JS/runtime fixes.

Evidence:

- `npm --prefix mobile-app run qa:production-guards` PASS.
- `node mobile-app/scripts/qa/validate-release-runtime-policy.cjs` PASS.
- `node --check mobile-app/src/screens/prototype/prototypeRouteViewport.js mobile-app/src/screens/prototype/rideLifecycleStateGuard.js mobile-app/src/screens/prototype/rideLifecycleSurfaceMatrix.js mobile-app/src/screens/prototype/RobotaxiHomeScreen.js mobile-app/src/screens/prototype/RobotaxiTripScreen.js mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js mobile-app/src/screens/prototype/RobotaxiDriverOfferScreen.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/active-route-viewport-contract.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/ride-lifecycle-surface-matrix.test.js __tests__/passenger-flow-routing.test.js __tests__/driver-live-ride-overlay.test.js __tests__/driver-online-toggle.test.js` PASS, 8 suites / 91 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/destination-quote-recalculation.test.js __tests__/payment-service-quote-lock.test.js __tests__/prototype-payment-availability.test.js __tests__/woovi-payment-modal.test.js __tests__/prototype-ride-runtime-financial-snapshot.test.js __tests__/prototype-ride-screens.test.js __tests__/driver-receipt-screen.test.js __tests__/receipt-service.test.js __tests__/rating-service.prototype.test.js __tests__/support-chat-service-fail-visible.test.js __tests__/support-screen-fail-visible.test.js __tests__/support-service-fail-visible.test.js __tests__/websocket-manager-support-scope.test.js __tests__/ride-local-snapshot-service.test.js __tests__/ride-event-outbox-service.test.js __tests__/ride-lifecycle-outbox-replay-service.test.js __tests__/location-buffer-service.test.js __tests__/runtime-crash-recovery.test.js` PASS, 18 suites / 225 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-new-surfaces.test.js __tests__/user-database-service.onboarding.test.js __tests__/qa-flow-inventory-release-signup.test.js __tests__/fcm-notification-service.test.js __tests__/websocket-manager-active-ride-sync.test.js __tests__/websocket-manager-create-booking.test.js __tests__/android-real-device-smoke-contract.test.js __tests__/legacy-financial-routes.test.js __tests__/driver-trip-assist-contract.test.js` PASS, 9 suites / 75 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand` PASS, 97 suites / 692 tests.
- `bash -lc 'source mobile-app/scripts/source-local-build-env.sh; java -version; adb devices -l'` PASS. Java is `OpenJDK 17.0.18`; connected Android is `irsgaiscr4j7cenv`, model `24117RN76L`.
- `bash -lc 'source mobile-app/scripts/source-local-build-env.sh; maestro --version'` PASS, `2.5.1`.
- `bash -lc 'source mobile-app/scripts/source-local-build-env.sh; emulator -list-avds'` PASS, available AVDs: `Leaf_API_35`, `Leaf_API_35_Driver`.
- `cd mobile-app && bash -lc 'source scripts/source-local-build-env.sh; npx expo config --json --type public'` confirms runtime/build metadata: version `1.0.3`, runtimeVersion `1.0.3`, Android versionCode `119`, iOS buildNumber `27`, updates URL `https://u.expo.dev/91dfdce0-9705-4fde-8417-747273ab7cc2`.

Open risk:

- This is local/unit/contract evidence. The L2 run still must prove the same invariants on real Android plus simulator/emulator with passenger and driver in the same region, an eligible online driver before payment, backend/user sandbox payment profile, geofence readiness, provider-backed Pix confirmation, lifecycle events, map gestures, screenshots, receipt/rating, dashboard reconciliation, and backend event logs.

## L2 Preflight Hardening - 2026-06-24 Android Device/Emulator Roles

Objective: prevent a full L2 smoke from starting unless passenger and driver are assigned to distinct Android runtimes, matching the real operational test requirement.

Scope completed:

- `prepare-real-smoke-env.sh` now enables `REQUIRE_ANDROID_ROLE_PAIR=true` by default.
- Default role assignment is passenger on the connected Android device (`PASSENGER_RUNTIME=android_device`) and driver on the Android emulator (`DRIVER_RUNTIME=android_emulator`).
- The preflight blocks with `blocked_precondition:android_role_pair_not_ready` when:
  - passenger and driver are assigned to the same runtime;
  - no role is assigned to the connected Android device;
  - the connected Android device role resolves to an `emulator-*` serial instead of a physical USB/device runtime;
  - no role is assigned to an Android emulator;
  - the connected Android device serial is not resolved;
  - the required AVD is missing;
  - `REQUIRE_RUNNING_ANDROID_EMULATOR=true` and no emulator is running.
- The generated `smoke-env.sh` now records `PASSENGER_RUNTIME`, `DRIVER_RUNTIME`, `PASSENGER_AVD`, `DRIVER_AVD`, and `REQUIRE_ANDROID_ROLE_PAIR`; the preflight also writes `android-role-pair.json` as evidence.
- The preflight now resolves and records `ANDROID_PASSENGER_SERIAL`, `ANDROID_DRIVER_SERIAL`, and `DRIVER_EMULATOR_SERIAL` when available, and verifies that the Leaf package is installed on the connected Android device and on a running emulator before those runtimes can be accepted as smoke evidence.
- The generated `start-driver-emulator.sh` boots/warms the configured driver AVD, verifies package installation, optionally installs `ANDROID_DRIVER_APK`, and writes `driver-emulator-runtime.env`.
- The generated `verify-android-role-runtimes.sh` blocks L2 smoke when passenger/driver serials are missing, equal, or missing the Leaf package. `run-android-smoke.sh` calls this verifier before launching the Android smoke runner.
- The generated `start-driver-bot.sh` now labels the dispatch bot as backend/dispatch support only; it is not accepted as driver-app evidence for full app-to-app L2 validation.

Evidence:

- `bash -n mobile-app/scripts/qa/prepare-real-smoke-env.sh` PASS.
- `node --check mobile-app/__tests__/android-real-device-smoke-contract.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/android-real-device-smoke-contract.test.js` PASS, 1 suite / 5 tests.

Open risk:

- This does not run the ride. It prevents invalid L2 setup from proceeding and generates the emulator/runtime helpers. The existing Android real-device smoke runner still uses a managed driver bot for dispatch automation, so app-to-app L2 evidence remains pending until the driver app flow is controlled and captured on the emulator.

## Real Smoke Preflight Attempt - 2026-06-24 Blocked Before Payment

Objective: validate the connected Android, current pickup source, backend health, payment sandbox canary, and L2 role split before any ride/payment action.

Scope completed:

- Ran `prepare-real-smoke-env.sh` with `REQUIRE_RUNNING_ANDROID_EMULATOR=false` and `PREPARE_DRIVER=false`.
- Physical Android resolved as `irsgaiscr4j7cenv`, model `24117RN76L`, Android `15`.
- Installed app resolved as `br.com.leaf.ride`, `versionName=1.0.3`, `versionCode=119`.
- Device GPS pickup resolved from `fused` provider as `-22.853586,-43.318168`.
- Android role preflight resolved passenger on physical device and driver on `Leaf_API_35_Driver`; the driver emulator was not running yet, so no driver serial was captured.
- Backend `/health` returned healthy for Redis, Firebase, WebSocket, and system checks.

Blocked precondition:

- `blocked_precondition:payment_sandbox_not_confirmed`.
- Runtime config for passenger `3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2` / phone `21102938475` returned `paymentRuntime.effectiveProfile.environment=production`, `profileId=env-default`, `activeProfileCount=0`, `canarySandboxEnabled=false`, `globalSandboxEnabled=false`.
- No smoke, Pix creation, driver seed, dispatch, OTA, or backend mutation was run after this block.

Evidence:

- Artifacts: `mobile-app/test-results/real-smoke-preflight-20260624T060416Z/`.
- `payment-runtime-canary.json` shows the backend default payment profile is production for the smoke passenger.
- `android-role-pair.json` records passenger/runtime split and missing driver emulator serial.
- `backend-health.json` shows healthy backend components.

Next gate:

- Reactivate a short-lived sandbox `payment_runtime_profiles` entry for the smoke passenger/phone through the admin runtime-profile endpoint, then rerun the preflight before starting any L2 smoke. This is a backend runtime mutation and requires explicit operator approval.

## Payment Runtime Sandbox Activation Guard - 2026-06-24

Objective: make the blocked sandbox-runtime step repeatable without making an accidental production backend mutation.

Scope completed:

- Added `mobile-app/scripts/qa/activate-payment-runtime-sandbox-profile.sh`.
- The helper is `DRY_RUN=true` by default and only writes a local payload artifact.
- A real backend runtime mutation requires both `DRY_RUN=false` and `CONFIRM_PAYMENT_RUNTIME_MUTATION=true`.
- The helper enforces `PAYMENT_RUNTIME_PROFILE_TTL_HOURS > 0` and `<= 24`, matching the backend sandbox-profile policy.
- The helper creates a canary-scoped sandbox payload for the smoke passenger/user phone allowlist, posts to `/api/payment/runtime-profiles` only after confirmation, and reruns `assert-backend-payment-runtime-canary.sh` after mutation.
- The failed canary script now points operators to the dry-run helper instead of requiring manual ad hoc curl commands.

Evidence:

- `bash -n mobile-app/scripts/qa/activate-payment-runtime-sandbox-profile.sh` PASS.
- `bash -n mobile-app/scripts/qa/assert-backend-payment-runtime-canary.sh` PASS.
- Dry-run command generated only local payload output and printed `DRY_RUN=true; no backend mutation was executed`.
- Negative dry-run guard: `PAYMENT_RUNTIME_PROFILE_TTL_HOURS=25` exits non-zero with `Invalid PAYMENT_RUNTIME_PROFILE_TTL_HOURS=25`.
- Negative mutation guard: `DRY_RUN=false CONFIRM_PAYMENT_RUNTIME_MUTATION=false` exits non-zero with `Refusing backend runtime mutation without CONFIRM_PAYMENT_RUNTIME_MUTATION=true`.
- `node --check mobile-app/__tests__/android-real-device-smoke-contract.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/android-real-device-smoke-contract.test.js` PASS, 1 suite / 7 tests.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- The sandbox profile has not been activated on the backend in this step. The next L2 smoke remains blocked until explicit operator approval is given and the canary confirms `paymentRuntime.effectiveProfile.environment=sandbox` for the smoke passenger.

## Android App-to-App Runtime Readiness - 2026-06-24

Objective: prove the next L2 smoke can use passenger on the connected Android device and driver on an Android emulator with the same Leaf binary/runtime, instead of relying on a managed driver bot as visual driver evidence.

Scope completed:

- Added standalone `mobile-app/scripts/qa/verify-android-role-runtimes.sh`.
- The verifier requires distinct `android_device` and `android_emulator` roles, rejects physical-device roles backed by `emulator-*`, verifies the Leaf package on both runtimes, records version evidence, and blocks mismatched passenger/driver app versions by default.
- The verifier can start the configured driver AVD with `START_DRIVER_EMULATOR=true`, install `ANDROID_DRIVER_APK` on the driver runtime, and force reinstall with `FORCE_INSTALL_DRIVER_APK=true`.
- `prepare-real-smoke-env.sh` now generates wrappers around this canonical verifier. The generated `run-android-smoke.sh` starts/verifies the driver emulator inside the same command before running the Android smoke runner, then exports `ANDROID_SERIAL` back to the passenger device serial.
- `prepare-real-smoke-env.sh` now also resolves a local driver APK whose `versionName` and `versionCode` match the connected passenger device. When a matching APK exists, generated smoke helpers export `ANDROID_DRIVER_APK` and default `FORCE_INSTALL_DRIVER_APK=true` so the driver emulator is refreshed before L2 runtime verification.
- Rebuilt local Android debug APK with `bash mobile-app/scripts/build-local-android.sh debug` from `mobile-app/`, producing `app-debug.apk` at `versionName=1.0.3`, `versionCode=119`.

Evidence:

- Negative no-emulator guard: `verify-android-role-runtimes.sh` blocks with `blocked_precondition:android_role_pair_not_ready Android emulator is not running` when no emulator is present and `START_DRIVER_EMULATOR=false`.
- Negative version guard: before rebuilding, the driver emulator had `1.0.2/117` while the physical passenger device had `1.0.3/119`; the verifier blocked with `passenger/driver app versions differ`.
- Local debug build PASS: Gradle `assembleDebug` completed successfully in 3m01s.
- APK badging after rebuild: `br.com.leaf.ride`, `versionCode=119`, `versionName=1.0.3`.
- App-to-app runtime verification PASS with artifacts in `/tmp/leaf-android-role-runtime-ready/`:
  - passenger runtime `android_device`, serial `irsgaiscr4j7cenv`, app `1.0.3/119`;
  - driver runtime `android_emulator`, serial `emulator-5554`, app `1.0.3/119`;
  - package `br.com.leaf.ride` on both runtimes.
- Real preflight rerun on 2026-06-24 wrote artifacts to `mobile-app/test-results/real-smoke-preflight-20260624T062151Z/`; it detected physical passenger app `1.0.3/119`, resolved matching driver APK `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`, and recorded the same `1.0.3/119` in `android-role-pair.json`.
- The same preflight stopped before smoke with `blocked_precondition:payment_sandbox_not_confirmed`; runtime config still reports `defaultEnvironment=production`, `effectiveProfile.profileId=env-default`, `activeProfileCount=0`, `canarySandboxEnabled=false`, and `globalSandboxEnabled=false`.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/android-real-device-smoke-contract.test.js` PASS, 1 suite / 7 tests.

Open risk:

- The driver emulator may not remain listed after the one-off verifier command exits in this Codex shell context, so the L2 smoke must start/verify the driver emulator inside the same smoke command. The generated `run-android-smoke.sh` now does that.
- This still does not run a ride. L2 remains blocked by payment sandbox runtime until the canary passenger is switched to sandbox and the preflight passes.

## Geofence Before Payment Preflight Guard - 2026-06-24

Objective: ensure coverage/geofence is proven before any payment-runtime step in the real Android smoke preflight.

Scope completed:

- Reordered `prepare-real-smoke-env.sh` so the live preflight sequence is backend health, pickup/destination geofence, then payment runtime sandbox canary.
- Added a Jest contract in `android-real-device-smoke-contract.test.js` that fails if `assert-backend-payment-runtime-canary.sh` moves before `/api/geofence/check`.
- Updated the canonical smoke directives so geofence readiness is listed before payment sandbox readiness.

Evidence:

- `bash -n mobile-app/scripts/qa/prepare-real-smoke-env.sh mobile-app/scripts/qa/verify-android-role-runtimes.sh mobile-app/scripts/qa/activate-payment-runtime-sandbox-profile.sh mobile-app/scripts/qa/assert-backend-payment-runtime-canary.sh` PASS.
- `node --check mobile-app/__tests__/android-real-device-smoke-contract.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/android-real-device-smoke-contract.test.js` PASS, 1 suite / 8 tests.
- `git diff --check` PASS.
- Real Android preflight artifact: `mobile-app/test-results/real-smoke-preflight-20260624T062515Z/`.
- The preflight log reached `Validating geofence pickup/destination` before `Validating payment runtime sandbox profile`.
- `geofence-pickup.json` returned `success=true`, `isAllowed=true`, coordinates `-22.853586,-43.318168`, reason `Geofence desativado (sem região configurada)`.
- `geofence-destination.json` returned `success=true`, `isAllowed=true`, coordinates `-22.9673111,-43.1789541`, reason `Geofence desativado (sem região configurada)`.
- The run stopped at `blocked_precondition:payment_sandbox_not_confirmed`; `payment-runtime-canary.json` still reports `effectiveProfile.environment=production`, `profileId=env-default`, `activeProfileCount=0`, `canarySandboxEnabled=false`, and `globalSandboxEnabled=false`.

Open risk:

- No payment, ride, driver seed, dispatch, OTA, or backend mutation was executed in this proof. The next L2 smoke remains blocked until a short-lived sandbox profile is explicitly activated for the smoke passenger/phone and the canary confirms `sandbox`.

## Backend Gate Rerun - 2026-06-24

Objective: verify the backend fronts before any Android L2 smoke, backend deploy, or OTA.

Evidence:

- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` initially surfaced one transient failure in `tests/unit/routes/referral-programs-routes.unit.test.js` where the public invite 404 body was empty.
- The focused rerun `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/referral-programs-routes.unit.test.js` PASS, 1 suite / 11 tests.
- The full rerun `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` PASS, 181 suites / 892 tests. No backend code change was made for the transient referral failure because it did not reproduce.
- Plain `npm --prefix leaf-websocket-backend run config:validate` still blocks production as designed when `LEAF_APPROVED_FINANCIAL_POLICY_ID` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF` are not configured.
- Validator-mechanics proof with `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1` and `LEAF_FINANCIAL_POLICY_APPROVAL_REF=local-validator-mechanics-only` PASS: `ok=true`, Firebase configured, Google/Maps configured, no blockers, and the only warning is `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`.

Open risk:

- The financial-policy approval metadata used above is a local validator proof, not a production approval. Production deploy remains blocked until the real approved policy reference is present in the runtime environment.

## Bottomsheet-Aware Route Viewport Guard - 2026-06-24

Objective: keep active ride routes visible inside the actual exposed map area when bottom sheets, top overlays, or lateral UI are present.

Scope completed:

- `prototypeRouteViewport.js` already fit active routes vertically above the measured bottomsheet. It now also recenters the camera horizontally into the visible frame when one side of the map is occluded.
- Added a focused viewport test proving that a route remains inside `buildVisibleRouteViewportFrame()` when the bottomsheet is open and lateral UI occludes one side of the map.
- Reconfirmed active passenger and driver trip screens keep map interaction enabled for live ride states while preventing sheet/backdrop/navigation regression.

Evidence:

- `node --check mobile-app/src/screens/prototype/prototypeRouteViewport.js mobile-app/__tests__/prototype-route-viewport.test.js` PASS.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js` PASS, 1 suite / 12 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/active-route-viewport-contract.test.js` PASS, 3 suites / 22 tests.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` PASS, 1 suite / 136 tests. This includes passenger/driver active trip map interaction, route fitting above sheets, traffic-colored segments, no synthetic active route before canonical coordinates, blocked navigator removal, terminal receipt/rating flow, and no map-only regression for active trip sheets.
- `npm --prefix mobile-app run qa:production-guards` PASS.
- `git diff --check` PASS.

Open risk:

- This is unit/contract evidence. The next device smoke still needs visual proof on the physical Android plus driver emulator after the sandbox runtime preflight passes.

## System-by-System Local Audit Snapshot - 2026-06-24

Objective: convert the broad core audit into current evidence per product domain before the next real-device L2 smoke.

Latest broad gates:

- `npm --prefix mobile-app run test:unit -- --runInBand` PASS, 97 suites / 699 tests.
- `npm --prefix leaf-dashboard-js run qa:backoffice` PASS. This includes ESLint, production Next build, protected-route smoke, financial reconciliation/dashboard fields, current-dashboard generation contract, and no direct browser calls to Google, Woovi/OpenPix, or Firebase providers.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` PASS from the backend gate rerun, 181 suites / 892 tests.
- Backend config validation remains intentionally blocked without the real financial-policy approval envs; with local validator metadata it returns `ok=true`, Firebase and Google/Maps configured, and only the expected KYC warning remains.

Local status by domain:

| Domain | Current local evidence | Remaining acceptance evidence |
| --- | --- | --- |
| Cadastro, validação e onboarding | Mobile full unit suite includes auth, OTP, profile resolution, user database onboarding, Android release signup flow inventory, and document/KYC UI tests. | Real Android/iOS signup execution evidence; iOS signup remains tracked as a flow inventory gap. |
| Driver approval, documents and CRLV vehicle identity | Backend/unit coverage for driver approval boundaries, document analysis queue, vehicle OCR/color normalization, CRLV fixture labeling, and dashboard quick approval boundaries; mobile activation surfaces covered in `prototype-new-surfaces`. | Real driver signup/document smoke proving CRLV-derived model, plate, color, provenance, approval state, dashboard projection, and accepted-trip/receipt identity. |
| Face compare / KYC / liveness | Backend KYC route/auth, AWS liveness, biometric production policy, KYC onboarding route, and mobile document/liveness tests are present in the full suite; active-ride KYC interruption is guarded. | Provider-backed liveness/face-compare pass, mismatch/manual review, retry, and idle-driver-only proof on real provider/device. |
| Ride lifecycle passenger/driver | `prototype-ride-screens`, lifecycle state guard, surface matrix, passenger routing, active sync, outbox/replay, local snapshot, and crash recovery tests passed inside the full mobile suite. Backend lifecycle/socket command tests passed in the full backend suite. | L2 app-to-app smoke on physical Android + driver emulator with ordered backend events, relaunch/reconnect, delayed events, and screenshot/XML proof. |
| Support, report problem and chat | Mobile fail-visible support/chat tests, support scope tests, backend support queue/severity/socket scope tests, and dashboard support smoke are covered. | L2 during active ride and post-trip, including non-participant denial and persisted conversation evidence. |
| Rating and receipt | Mobile full suite covers passenger/driver rating, idempotent receipt/rating behavior, terminal close to clean map, incomplete financial snapshot recovery, and no active rehydration after receipt. Backend receipt/rating service tests passed. | Real completed ride with rating submit/retry, receipt screenshots, and relaunch proof that completed ride stays terminal. |
| Pricing, routes and fare consistency | Mobile quote-lock, no provisional fare, route viewport, traffic-colored routes, payment modal, payment session, financial summary, and no direct Woovi guard tests passed. Backend quote lock, payment, receipt, ledger, worker billing, pricing, and dashboard financial tests passed in backend/dashboard gates. | One real ride id reconciled across quote, Pix/Woovi, booking, receipt, dashboard, ledger, Leaf fee, Woovi fee, driver net, toll/pass-throughs, and approved policy id. |
| Dashboard and user management | `qa:backoffice` passed current Next dashboard build/smoke, protected routes, support, drivers, metrics, observability, runtime flags, financial reconciliation, and provider-call boundary. | Live dashboard observation during the same L2 ride, including state transitions, fare reconciliation, support artifact, driver identity, and final receipt. |
| Offline/local fallback | Mobile full suite covers location buffer, ride local snapshot, ride event outbox, lifecycle outbox replay, runtime crash recovery, and websocket active sync. | Device-level airplane/network interruption during ride/search/completion, with local recovery and no duplicate financial/lifecycle transaction. |

Local conclusion:

- No local P0 failure is currently reproduced in mobile, backend, or dashboard gates.
- The audit is not complete because provider/device proof is still missing for payment sandbox, app-to-app driver/passenger flow, provider-backed KYC/face compare, and same-ride financial reconciliation.

## Wave 9 Runner Semantics - 2026-06-24

Objective: make the production-readiness runner strict enough to avoid false green results, while keeping missing external approvals separated from product failures.

Implemented runner behavior:

- `RUN_EXTENDED_LOCAL_GATES=true` is the default for Wave 9 and includes the full mobile and backend unit gates in addition to governance, secret scans, production guards, route guards, no-active-VPS runtime guard, dashboard QA, and runtime config validation.
- `RUN_EXTENDED_LOCAL_GATES=false` is available only for fast runner sanity checks; it must not be used as release evidence.
- Android L2 smoke remains gated by `EXPLICIT_L2_APPROVAL=true` and `RUN_L2_SMOKE=true`.
- Runtime config failure caused only by missing approved financial-policy reference is classified as `blocked`, not `fail`.
- Runtime config failure caused by Firebase, Google/Maps, parsing errors, or non-financial blockers remains `fail`.

Controlled runner evidence:

- Command: `RUN_EXTENDED_LOCAL_GATES=false RUN_L2_SMOKE=false EXPLICIT_L2_APPROVAL=false bash scripts/validation/run-master-validation.sh --label wave9-runner-check-final --wave wave9`.
- Result directory: `reports/validation-runs/20260624_033839_wave9-runner-check-final`.
- Overall result: `blocked`, exit code 0.
- Runtime config status: `financial_policy_approval_blocked`.
- Firebase configured: `true`.
- Google/Maps configured: `true`.
- KYC provider evidence: still blocked/pending.
- FCM delivery evidence: still blocked/pending.
- L2 Android smoke: not executed in this controlled check.

Full local Wave 9 evidence:

- Command: `RUN_EXTENDED_LOCAL_GATES=true RUN_L2_SMOKE=false EXPLICIT_L2_APPROVAL=false bash scripts/validation/run-master-validation.sh --label production-readiness-local-full --wave wave9`.
- Result directory: `reports/validation-runs/20260624_033955_production-readiness-local-full`.
- Overall result: `blocked`, exit code 0.
- Passed local gates: diff check, governance, tracked secret scan, hardcoded secret guard, mobile production guards, backend route guards, no-active-VPS runtime guard, full mobile unit suite, full backend unit suite, and current dashboard backoffice QA.
- Mobile full unit evidence: 97 suites passed, 699 tests passed.
- Backend full unit evidence: 181 suites passed, 892 tests passed.
- Current dashboard evidence: ESLint passed, Next production build passed, protected-route smoke passed, financial reconciliation contract rendered, current financial metrics rendered, runtime flags rendered, and direct browser calls to Google, Woovi/OpenPix, or Firebase providers were absent.
- Runtime config status: `financial_policy_approval_blocked`.
- Runtime config blocker: approved financial-policy reference is missing for `runtime_tiered_percent_above_50_v1`.
- Firebase configured: `true`.
- Google/Maps configured: `true`.
- Runtime warnings: only KYC biometrics is not yet strict in production config.
- L2 Android smoke: not executed in this local-only run.

Financial policy approval gate proof:

- Command: `LEAF_APPROVED_FINANCIAL_POLICY_ID=runtime_tiered_percent_above_50_v1 LEAF_FINANCIAL_POLICY_APPROVAL_REF=local-validator-mechanics-only-not-production-approval LEAF_FINANCIAL_POLICY_APPROVAL_ACTOR=codex-local-validator npm --prefix leaf-websocket-backend run config:validate`.
- Result: `ok=true`, no blockers.
- Runtime proof: Firebase configured `true`, Google/Maps configured `true`, Woovi production runtime configured, payment bypass flags disabled, legacy runtime flags disabled, Socket.IO Redis adapter required, active policy approved by matching policy id plus non-empty approval reference.
- Remaining warning: `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`.
- Interpretation: this proves validator mechanics only. It does not approve the business policy; production still needs a real approval reference before L2/release acceptance.
- Focused guard tests: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-financial-contract.unit.test.js tests/unit/scripts/validate-runtime-config.unit.test.js` passed, 2 suites / 42 tests.

Android L2 preflight evidence:

- Command: `PREPARE_DRIVER=false REQUIRE_RUNNING_ANDROID_EMULATOR=false FORCE_INSTALL_DRIVER_APK=false bash mobile-app/scripts/qa/prepare-real-smoke-env.sh`.
- Latest result directory: `mobile-app/test-results/real-smoke-preflight-20260624T070659Z`.
- Summary artifact: `mobile-app/test-results/real-smoke-preflight-20260624T070659Z/preflight-summary.json`.
- Result: blocked before smoke/payment, as designed.
- Physical passenger device: `irsgaiscr4j7cenv`.
- Device app version: `1.0.3` / `119`.
- Device GPS pickup resolved from fused provider: `-22.853586,-43.318168`.
- Backend health: passed.
- Geofence pickup/destination: passed; backend reported geofence disabled/no configured region for both coordinates.
- Matching local driver APK resolved: `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`, version `1.0.3` / `119`.
- Android role pair artifact records `androidEmulatorStabilitySeconds=60` even when the payment canary blocks before smoke wrappers are generated.
- Payment runtime canary: blocked because effective environment is `production`, profile `env-default`, even for the smoke passenger context.
- Preflight summary status: `blocked`, step `payment_runtime_sandbox`, blocker `blocked_precondition:payment_sandbox_not_confirmed`.
- Canary classification is now explicit: sandbox mismatch remains a blocked precondition, while unreachable runtime config, invalid runtime config response, or unknown canary failure are classified as preflight failures instead of being hidden as sandbox setup.
- No `smoke-env.sh`, driver seed, Pix, booking, payment confirmation, or ride smoke was executed in this preflight because the canary blocked before the runnable smoke wrappers were written.

Payment runtime sandbox dry-run evidence:

- Command: `DRY_RUN=true BACKEND_URL=https://api.leaf.app.br PASSENGER_UID=3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2 PASSENGER_PHONE=21102938475 bash mobile-app/scripts/qa/activate-payment-runtime-sandbox-profile.sh`.
- Latest result directory: `mobile-app/test-results/payment-runtime-sandbox-20260624T070049Z`.
- Summary artifact: `mobile-app/test-results/payment-runtime-sandbox-20260624T070049Z/payment-runtime-sandbox-summary.json`.
- Result: payload generated only; no backend mutation was executed.
- Payload scope: canary sandbox profile for user `3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2` and phones `21102938475` / `5521102938475`.
- TTL: expires at `2026-06-24T13:00:49.566Z`.
- Summary status: `dry_run`, `mutationExecuted=false`, `verificationExecuted=false`.
- Confirmation guard proof: `DRY_RUN=false CONFIRM_PAYMENT_RUNTIME_MUTATION=false ... activate-payment-runtime-sandbox-profile.sh` produced `mobile-app/test-results/payment-runtime-sandbox-confirmation-refusal-20260624T070125Z/payment-runtime-sandbox-summary.json` with status `blocked`, step `require_confirmation`, blocker `blocked_precondition:payment_runtime_mutation_not_confirmed`, and `mutationExecuted=false`.

Android driver runtime guard evidence:

- The role verifier now requires an emulator stability window through `ANDROID_EMULATOR_STABILITY_SECONDS`, defaulting to 60 seconds, before marking the Android role pair ready.
- The generated `smoke-env.sh`, `android-role-runtime.env`, and `android-role-runtime-verification.json` now persist the emulator stability window used by the L2 run, so the artifact records whether the verifier used the default or an explicit override.
- Contract test: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/android-real-device-smoke-contract.test.js` passed, 1 suite / 8 tests.
- Runtime check: `PASSENGER_RUNTIME=android_device DRIVER_RUNTIME=android_emulator DRIVER_AVD=Leaf_API_35_Driver START_DRIVER_EMULATOR=true REQUIRE_RUNNING_ANDROID_EMULATOR=true REQUIRE_MATCHING_ANDROID_APP_VERSION=true ANDROID_EMULATOR_STABILITY_SECONDS=45 ANDROID_DRIVER_APK=/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk FORCE_INSTALL_DRIVER_APK=false OUTPUT_DIR=/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/android-role-runtime-20260624T064835Z bash mobile-app/scripts/qa/verify-android-role-runtimes.sh`.
- Result: passenger physical runtime and driver emulator runtime verified during the stability window with matching app version `1.0.3` / `119`.
- Operational note: under the Codex command runner the emulator is not guaranteed to remain alive after the command exits. The authorized L2 smoke must start and verify the driver emulator inside the same `run-android-smoke.sh` command that performs the smoke.

Backend/mobile/dashboard revalidation - 2026-06-24:

- Objective: verify the backend fronts before any Android L2 smoke, backend deploy, OTA, or local build promotion.
- Backend unit: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` passed, 181 suites / 892 tests.
- Backend config: `npm --prefix leaf-websocket-backend run config:validate` remains intentionally blocked by missing explicit approval for `runtime_tiered_percent_above_50_v1`; Firebase/Admin/RTDB and Google/Maps are configured, and the only config warning is KYC strict biometrics disabled.
- Security/baseline: `git diff --check`, `npm run governance:check`, tracked secret scan, and hardcoded-secret guard passed.
- Dashboard: `npm --prefix leaf-dashboard-js run qa:backoffice` passed, including ESLint, Next production build, protected-route smoke, current-dashboard marker, financial reconciliation, metrics, runtime flags, support/observability, and no direct browser calls to Google, Woovi/OpenPix, or Firebase.
- Mobile lifecycle guard: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/ride-lifecycle-surface-matrix.test.js` passed, 3 suites / 156 tests.
- Direct map-tap regression proof: `prototype-ride-screens` now covers passenger active trip states `accepted`, `arrived`, `started`, `operational_interrupted`, and `searching_replacement` receiving a direct map press without navigating back, replacing to the clean map, or showing the home destination input. This is local unit/contract evidence; the Android L2 run still must repeat the same taps on the physical passenger device.
- Mobile release guards: `npm --prefix mobile-app run qa:production-guards` passed for production, production-apk, release-test, and production-review profiles.
- No backend mutation, runtime profile mutation, Pix creation, booking creation, driver seed, OTA, deploy, or native build was executed in this validation pass.

Core domain audit continuation - 2026-06-24:

- Viewport/bottomsheet contract: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/active-route-viewport-contract.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/prototype-ride-screens.test.js __tests__/driver-online-toggle.test.js` passed, 5 suites / 205 tests.
- Lifecycle state contract: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-lifecycle-surface-matrix.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/passenger-flow-routing.test.js __tests__/runtime-crash-recovery.test.js` passed, 4 suites / 27 tests.
- Cadastro/onboarding/document surfaces: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/user-database-service.onboarding.test.js __tests__/qa-flow-inventory-release-signup.test.js __tests__/prototype-new-surfaces.test.js` passed, 3 suites / 26 tests.
- Rating/receipt/support/chat mobile: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/rating-service.prototype.test.js __tests__/receipt-service.test.js __tests__/support-chat-service-fail-visible.test.js __tests__/support-screen-fail-visible.test.js __tests__/support-service-fail-visible.test.js __tests__/websocket-manager-support-scope.test.js` passed, 6 suites / 18 tests.
- Quote/payment/financial UI mobile: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/destination-quote-recalculation.test.js __tests__/payment-service-quote-lock.test.js __tests__/prototype-payment-availability.test.js __tests__/woovi-payment-modal.test.js __tests__/prototype-ride-runtime-financial-snapshot.test.js __tests__/driver-receipt-screen.test.js` passed, 6 suites / 44 tests.
- Backend independent domain set: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/account-routes.unit.test.js tests/unit/routes/auth-otp.unit.test.js tests/unit/routes/kyc-onboarding-routes.unit.test.js tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js tests/unit/services/driver-eligibility-service.unit.test.js tests/unit/services/kyc-biometric-production-policy.unit.test.js tests/unit/services/rating-service-lifecycle.unit.test.js tests/unit/bootstrap/register-socket-engagement-chat-handlers.unit.test.js tests/unit/services/support-severity-classifier.unit.test.js tests/unit/services/ride-financial-contract.unit.test.js tests/unit/services/receipt-service.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js` passed, 12 suites / 108 tests.
- Static audit check: current code already routes passenger lifecycle surfaces through `rideLifecycleSurfaceMatrix`, normalizes runtime aliases in Home, driver overlay, driver trip, support/chat/cancellation screens, and keeps the financial simulator hidden behind explicit `financialSimulatorEnabled`; dashboard smoke still fails on deprecated financial/simulation endpoint calls.
- Evidence limitation: these are source/unit/contract checks. They do not replace the required Android L2 proof for map gestures, driver/passenger role pair, provider-backed sandbox payment, real chat, receipt/rating closure, dashboard reconciliation, and delayed socket event replay.

Financial simulator guard hardening - 2026-06-24:

- Objective: prevent hypothetical simulator math from becoming a parallel financial source of truth while the production model requires backend-final receipt/ledger/dashboard reconciliation.
- Backend launch flags now expose `financialSimulatorEnabled`, defaulting to disabled through `ENABLE_FINANCIAL_SIMULATOR=false`.
- `/api/metrics/simulation/run` now returns `403 FEATURE_DISABLED_IN_LAUNCH_PROFILE` unless that explicit launch flag is enabled.
- Focused backend proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/metrics-financial-routes.unit.test.js tests/unit/utils/pilot-launch-flags.unit.test.js` passed, 2 suites / 6 tests.
- Dashboard proof: `npm --prefix leaf-dashboard-js run qa:backoffice` passed after the guard; the current dashboard still renders financial reconciliation/metrics from backend-final fixtures, keeps the simulator disabled without the flag, fails on deprecated financial/simulation API calls, and makes no direct browser calls to Google, Woovi/OpenPix, or Firebase.
- This does not change take-rate, Woovi fee, toll, split, payout, or withdrawal business rules. It only gates a hypothetical simulator surface.

Production Robotaxi map/lifecycle gate - 2026-06-24:

- Objective: remove the production escape hatch that could route active ride users to legacy direct `MapView`/`Polyline` screens without the Robotaxi visible-route viewport and lifecycle locks.
- `AppNavigator` now limits the legacy map opt-out to local development only (`__DEV__` plus non-review, non-E2E, non-simulator context). Production, review, internal-test, and E2E builds force `effectivePrototypeUiEnabled=true`, so a remote `PROTOTYPE_ROBOTAXI_UI_ENABLED=false` value cannot route release users to `NewMapScreen`, `BookedCabScreen`, or `TripTrackingScreen`.
- Focused proof: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/legacy-financial-routes.test.js __tests__/active-route-viewport-contract.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/ride-lifecycle-surface-matrix.test.js` passed, 4 suites / 22 tests.
- Release guard proof: `npm --prefix mobile-app run qa:production-guards` passed, and `node --check mobile-app/src/navigation/AppNavigator.js mobile-app/__tests__/legacy-financial-routes.test.js` passed.
- Remaining limitation: direct legacy route renderers still exist in the repository for old/non-core paths, but release navigation can no longer reach them as the active ride core through the Robotaxi UI flag. Any future deletion requires a separate usage audit.

Backend fail-closed hardening - 2026-06-24:

- Driver activation document uploads now fail closed before any RTDB mutation, Firestore/dashboard sync, status recomputation, runtime metric, socket event, or document-analysis enqueue when Firebase Storage save fails or when Storage does not return a durable signed URL.
- Focused proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/driver-activation-routes.unit.test.js tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js tests/unit/services/driver-activation-state-service.unit.test.js tests/unit/routes/driver-approval-routes.unit.test.js` passed, 4 suites / 10 tests.
- `completeTrip` receipt generation now imports Firebase config explicitly, no longer depends on `io.activeBookings` still containing the booking, and builds the receipt from the merged active/Redis booking snapshot plus the `CompleteTripCommand` backend-final financial snapshot. This prevents a completed ride from silently missing its receipt when the in-memory active booking map is empty or stale.
- Focused proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-complete-trip-receipt.unit.test.js tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/commands/CompleteTripCommand.unit.test.js tests/unit/services/receipt-service.unit.test.js` passed, 4 suites / 16 tests.
- Production runtime validation now blocks deploy when core ride/payment guard rails are weakened by env: `REQUIRE_PAYMENT_QUOTE_LOCK=false`, `REQUIRE_PAYMENT_BEFORE_BOOKING=false`, `VERIFY_PAYMENT_BEFORE_BOOKING=false`, `REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=false`, `CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK=true`, `ENFORCE_PAYMENT_FARE_LOCK=false`, or `REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH=false`.
- Focused proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/scripts/validate-runtime-config.unit.test.js` passed, 1 suite / 25 tests.
- Lifecycle source contract was aligned with the current passenger surface matrix instead of stale hardcoded route returns. Proof: `npm --prefix leaf-websocket-backend run test:integration -- --runInBand tests/integration/contracts/create-booking-availability-precheck.contract.test.js tests/integration/contracts/ride-lifecycle-contract.integration.test.js` passed, 2 suites / 9 tests; `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-lifecycle-surface-matrix.test.js __tests__/passenger-flow-routing.test.js` passed, 2 suites / 9 tests.
- Live local validator proof: `npm --prefix leaf-websocket-backend run config:validate` still blocks only on missing explicit financial-policy approval reference. Its JSON diagnostics now show `coreRidePaymentGuards` all at the expected safe values by default, with Firebase/Admin/RTDB and Google/Maps configured and only the expected KYC strict-biometrics warning.
- This does not change take-rate, fee, split, payout, withdrawal, Pix provider, or ride lifecycle business rules. It only prevents partial document ingestion and unsafe deploy configuration.

CreateBooking provider-backed payment guard - 2026-06-24:

- Objective: make the paid booking entrypoint enforce the same provider-backed payment proof used by `confirmPayment`/`startTrip`, so a passenger client cannot mark a ride as paid using only socket/local/cache state.
- `createBooking` now calls `resolveAuthoritativePaymentConfirmation` before setting `paymentServerValidated=true`. Non-authoritative sources such as `booking_cache`, `payment_holding_doc`, `payment_holding_query`, `payment_holding_retry`, `payment_status_cache`, `ride_payments_query`, `socket_confirmPayment`, or `socket_mock_payment` cannot unlock paid booking creation.
- Frontend compatibility is preserved: provider-proof failure still emits `bookingError.code=PAYMENT_NOT_CONFIRMED`; the backend also sends `providerCode=PAYMENT_NOT_PROVIDER_CONFIRMED` for audit/QA.
- The App Review mock path remains isolated behind `APP_REVIEW=true` plus `ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING=true`; production config validation already blocks unsafe runtime guard weakening.
- New executable socket proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js` passed, 1 suite / 3 tests:
  - rejects client-confirmed payment when proof is only local/cache-backed;
  - blocks provider-confirmed paid booking before `RequestRideCommand` when no eligible driver is available;
  - creates a paid booking only after provider proof and driver availability, passing `paymentData.serverValidated=true` and triggering paid dispatch.
- Focused backend proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js tests/unit/services/authoritative-payment-confirmation-service.unit.test.js tests/unit/services/create-booking-availability-precheck.unit.test.js tests/unit/commands/RequestRideCommand.unit.test.js` passed, 4 suites / 18 tests.
- Contract proof: `npm --prefix leaf-websocket-backend run test:integration -- --runInBand tests/integration/contracts/create-booking-payment-validation.contract.test.js tests/integration/contracts/create-booking-availability-precheck.contract.test.js tests/integration/contracts/ride-lifecycle-contract.integration.test.js` passed, 3 suites / 11 tests.
- Expanded backend proof after the guard change: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js tests/unit/bootstrap/register-socket-complete-trip-receipt.unit.test.js tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/commands/RequestRideCommand.unit.test.js tests/unit/commands/CompleteTripCommand.unit.test.js tests/unit/services/authoritative-payment-confirmation-service.unit.test.js tests/unit/services/create-booking-availability-precheck.unit.test.js tests/unit/services/payment-dispatch-service.unit.test.js tests/unit/services/receipt-service.unit.test.js tests/unit/scripts/validate-runtime-config.unit.test.js tests/unit/routes/driver-activation-routes.unit.test.js tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js tests/unit/services/driver-activation-state-service.unit.test.js tests/unit/routes/driver-approval-routes.unit.test.js` passed, 14 suites / 71 tests.
- Baseline proof after the guard change: `git diff --check`, `npm run governance:check`, `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`, `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`, `npm --prefix leaf-websocket-backend run test:route-guards`, and `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime` passed.
- Runtime config proof after the guard change: `npm --prefix leaf-websocket-backend run config:validate` still exits with the known financial-policy approval blocker only; `coreRidePaymentGuards` remains safe, Firebase/Admin/RTDB and Google/Maps are configured, and the expected KYC strict-biometrics warning remains.
- This does not create a new payment rule or Pix provider path. It closes a backend trust gap by reusing the existing authoritative payment confirmation service.

Active trip viewport/state hardening - 2026-06-24:

- Objective: prevent active passenger/driver trip routes from being hidden behind oversized bottomsheets and prevent protected operational ride states from regressing to idle/map-only on ambiguous `activeRideSync` payloads.
- `LeafRideSheet` now supports opt-in internal scrolling. Passenger and driver active trip screens enable it and cap the effective sheet height from the measured map height, preserving a real visible map area instead of letting content growth consume the route.
- Passenger and driver trip screens now clamp measured card height before publishing map occlusion. A tall measured sheet no longer makes the viewport believe the usable map has only a few pixels or lets the route sit behind the bottomsheet.
- Runtime active-ride context now includes `operational_interrupted` and `searching_replacement`. Ambiguous idle syncs without terminal authority no longer clear those protected states, even if an active-index response is empty; explicit terminal/cancel/no-driver authority still closes the ride.
- Receipt recovery now accepts both `bookingId` and `explicitBookingId`, matching the route-only receipt screen path that already sends `explicitBookingId`.
- Focused proof: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-ride-runtime-financial-snapshot.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/active-route-viewport-contract.test.js __tests__/passenger-search-lifecycle.test.js __tests__/ride-lifecycle-state-guard.test.js __tests__/ride-lifecycle-surface-matrix.test.js __tests__/passenger-flow-routing.test.js` passed, 9 suites / 202 tests.
- Full mobile proof: `npm --prefix mobile-app run qa:production-guards` passed and `npm --prefix mobile-app run test:unit -- --runInBand` passed, 97 suites / 710 tests.
- Baseline proof after the mobile hardening: `git diff --check`, `npm run governance:check`, `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`, and `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh` passed.
- No backend deploy, OTA publication, native build, Pix creation, booking creation, driver seed, or real Android smoke was executed in this pass. These changes are JS/runtime-surface changes and need the next authorized OTA/build validation before L2 smoke evidence can close the device gate.

P1 guardrail continuation - 2026-06-24:

- Objective: close the last high-risk trust gaps found by the independent backend/mobile/auxiliary audit without changing fare, take-rate, Pix provider, dispatch, payout, KYC, or document-approval business policy.
- Payment binding: `createBooking` now validates the provider-confirmed advance payment intent against the incoming booking request before driver availability or `RequestRideCommand`. The guard compares passenger/customer, quote lock, quote session, payment session, payment context key, car type, route signature, payable cents, and gross amount where those values are available. A mismatch emits `PAYMENT_INTENT_*` and stops booking materialization.
- Mobile payment context propagation: the prototype ride runtime now forwards `paymentSessionId` and `paymentContextKey`, and `RequestRideCommand` persists them into booking payment data. This gives backend/dashboard/smoke evidence a stable correlation path from quote/payment to ride.
- Refund idempotency: cancellation refund handling now treats `REFUNDED`, `REFUNDED_FULL`, and `REFUNDED_PARTIAL` as already refunded before attempting a legacy refund call. `PaymentService.markPaymentRefunded` also persists `refunded=true` for full and partial refund statuses.
- Driver navigation phase: the standalone driver trip screen now uses the central `openDriverExternalNavigation` helper and selects pickup or destination by normalized lifecycle phase. It no longer builds manual Google/Waze URLs locally or points a pre-pickup accepted ride at the dropoff.
- Active quote/payment sheets: passenger booking/payment sheets now compute bottom occlusion from measured viewport and cap their sheet height with internal scrolling. Backdrop tap and drag are disabled on those protected operational sheets, so map interaction cannot collapse the ride surface or regress to map-only.
- Onboarding recovery: password setup no longer references a stale `profilePayload` variable. It resolves phone/profile data from normalized, persisted, or saved onboarding payloads so registration recovery does not break at finalization.
- OCR auth boundary: CNH/CRLV OCR endpoints now require Firebase auth before upload processing and reject body `userId` that does not match the authenticated uid. The mobile document extraction service sends the Firebase bearer token for those OCR calls.
- Support chat spoofing: the REST support-chat fallback now derives `senderType` from the authenticated actor. A normal user posting `senderType=agent` is stored as `user`; only support/admin actors can persist as `agent`.
- Mobile focused proof: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-route-viewport.test.js __tests__/active-route-viewport-contract.test.js __tests__/driver-trip-assist-contract.test.js __tests__/prototype-payment-availability.test.js __tests__/prototype-ride-screens.test.js __tests__/auth-flow.recovery.test.js` passed, 6 suites / 176 tests.
- Backend focused proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js tests/unit/commands/RequestRideCommand.unit.test.js tests/unit/routes/support-chat-routes.unit.test.js tests/unit/routes/ocr-routes-auth.unit.test.js` passed, 5 suites / 51 tests.
- Residual risks left explicit: payment intent validation is fail-closed when the intent/binding is present, but the booking id is still generated inside `RequestRideCommand`, so an atomic pre-materialization payment consumption/reservation remains a future backend improvement; toll/pass-through display still needs one real ride reconciliation across receipt/dashboard/ledger; the mobile map vehicle-color fallback still needs its separate UI fix/proof.
- No backend deploy, OTA publication, native build, Pix creation, booking creation, driver seed, or real Android smoke was executed in this pass. The next L2 smoke must be explicitly authorized and must start from a clean passenger/driver preflight, available driver, sandbox payment profile, and dashboard monitoring.

Backend residual closure - 2026-06-24:

- Refund consistency: manual `/api/payment/refund`, dispute decisions, and early-ending passenger refunds now call `PaymentService.processRideRefund(...)` instead of calling Woovi directly. The wrapper resolves the payment by ride/booking/charge, fails closed when no ride payment can be linked, claims a refund request in Firestore, blocks replay when the ride is already `REFUNDED`, `REFUNDED_FULL`, or `REFUNDED_PARTIAL`, calls the provider once, then records `ride_payments`, `payment_holdings`, and refund ledger metadata through `markPaymentRefunded`.
- CRLV identity gate: CRLV approval now requires plate, RENAVAM, model, and color. The analyzer fails incomplete CRLV extraction, and `updateDocumentState` also reclassifies any attempted approved CRLV without those required fields to `failed/rejected`, so dashboard/queue paths cannot persist an approved vehicle document with `cor pendente` or model missing.
- Dashboard audit trail: individual document review, manual vehicle configuration, and quick manual driver approval now emit central `auditService.logEvent` entries with actor, driver, previous/next state, evidence/reason, vehicle category/status, and document decision details. Existing user-level audit fields remain, but they are no longer the only audit surface.
- Focused refund proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/payment-service.payment-status-cache.unit.test.js tests/unit/services/dispute-review-service.unit.test.js` passed, 2 suites / 41 tests.
- Focused CRLV/dashboard proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/driver-document-analysis-queue-crlv.unit.test.js tests/unit/routes/dashboard-driver-quick-approval-boundary.unit.test.js` passed, 2 suites / 8 tests.
- Syntax proof: `node --check` passed for `payment-service.js`, `payment.js`, `dispute-review-service.js`, `driver-document-analysis-queue.js`, `dashboard.js`, and the focused unit tests.
- L2 readiness check: local ADB is available and reports one connected Android device, `24117RN76L` (`irsgaiscr4j7cenv`, USB). No real smoke, install, OTA, backend deploy, Pix creation, booking creation, or driver/passenger simulation was executed in this pass.

Backend/mobile audit closure continuation - 2026-06-24:

- Objective: close the P0/P1 blockers found by the independent mobile, backend, and dashboard audits before any backend deploy, OTA, build promotion, or real Android smoke.
- Mobile receipt authority: `RobotaxiReceiptScreen` now prefers a same-booking backend-final runtime receipt over route params/minimal local receipts. Route params can still render a complete backend-final receipt, but cannot mask the authoritative backend-final financial snapshot already hydrated in runtime/history.
- Mobile receipt recovery: completed receipt recovery no longer returns `ALREADY_RECOVERED` just because `lastReceipt.id` equals the booking id. It only skips the backend lookup when the local receipt already has `authoritativeSnapshot=true` and `financialSnapshotSource=backend_final`.
- Backend createBooking fail-closed guards: passenger trust, active-ride duplication, and operational-area policy guard failures now emit explicit `bookingError` codes and stop booking creation instead of continuing after validation exceptions.
- Backend refund consistency: `CancelRideCommand` now refunds canonical captured statuses (`PAID`, `CONFIRMED`, `LEDGER_PENDING`, `IN_HOLDING`) using `chargeId || paymentId`. `processNetDistribution` applies the same captured-status rule for early-ending passenger refunds. The VPS cancel path now uses `processRideRefund(...)` instead of direct provider refund plus manual marking.
- Backend/dashboard security: reports in `routes/metrics.js` require support auth plus `REPORT_READ_ROLES`; dashboard report routes require `authenticateJWT` plus `DASHBOARD_FINANCIAL_ROLES`; worker observability endpoints require support auth; dashboard document uploads now use short-lived signed URLs and persist `fileUrlExpiresAt` instead of `2035-01-01`.
- KYC legacy boundary: `server.vps.js` now keeps `/api/kyc-proxy` behind the same explicit `ENABLE_LEGACY_KYC_PROXY=true` flag used by the modular runtime.
- Focused mobile proof: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js __tests__/prototype-ride-runtime-financial-snapshot.test.js __tests__/destination-quote-recalculation.test.js __tests__/active-route-viewport-contract.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-payment-availability.test.js` passed, 6 suites / 203 tests.
- Focused backend proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js tests/unit/commands/CancelRideCommand.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js tests/unit/services/payment-refund-boundary.unit.test.js tests/unit/routes/dashboard-driver-quick-approval-boundary.unit.test.js tests/unit/routes/metrics-financial-routes.unit.test.js tests/unit/services/kyc-legacy-boundary.unit.test.js tests/unit/routes/worker-health-routes-auth.unit.test.js` passed, 8 suites / 74 tests.
- Route guard proof: `node leaf-websocket-backend/scripts/tests/assert-sensitive-route-guards.cjs` passed with reports, dashboard reports, worker endpoints, and dashboard document signed URL checks.
- Residual risks left explicit: support N1/N2/N3 backend RBAC still needs an approved support policy matrix; report export content in `metrics.js` still needs real production datasets before it can be considered a production reporting feature; multi-leg billing remains conditional until rollout evidence proves ledger settlement before every balance credit; L2 real smoke still must validate one ride end to end with passenger device, driver emulator, sandbox Woovi, available driver, dashboard observation, rating, receipt, and same-ride financial reconciliation.
- No backend deploy, OTA publication, native build, Pix creation, booking creation, driver seed, real provider action, or real Android smoke was executed in this continuation.

Reports/support continuation - 2026-06-24:

- Objective: remove two remaining false-positive production surfaces without changing support severity policy or financial rules.
- Report exports: `/api/reports/generate/:reportId` no longer generates PDF/Excel files from an empty placeholder dataset. Until each predefined dataset is implemented, the endpoint returns `501 REPORT_DATASET_NOT_IMPLEMENTED`, so dashboard/report QA cannot mistake an empty export for production evidence.
- Support roles: backend support auth and support routes now recognize the dashboard roles `support_n1`, `support_n2`, and `support_n3` as support agents. This aligns backend access with existing dashboard role names. Fine-grained N1/N2/N3 action and priority policy remains a separate business-policy task because it affects who can assign, escalate, or resolve each severity level.
- Focused proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/metrics-financial-routes.unit.test.js tests/unit/routes/support-tier-roles-boundary.unit.test.js tests/unit/routes/support-routes-admin-ops.unit.test.js tests/unit/routes/support-chat-routes.unit.test.js` passed, 4 suites / 10 tests.
- Guard proof was extended so `assert-sensitive-route-guards.cjs` now fails if report routes lose auth, report placeholders return, or support tier roles disappear from backend auth/routes.

Backend/dashboard residual closure - 2026-06-24 12:14 BRT:

- Objective: close two remaining QA false positives before backend deploy, OTA, build promotion, or real Android smoke.
- Dashboard report export now uses the authenticated `leafAPI` client instead of `window.open(config.api.baseUrl)`. The export request carries the dashboard bearer token, refreshes through the existing auth path, downloads the binary response locally, and renders backend errors such as `501 REPORT_DATASET_NOT_IMPLEMENTED` in the dashboard instead of opening a blind tab.
- Backoffice smoke now includes `/reports` and clicks the PDF export fixture, asserting the request uses `/api/reports/generate/...` with `Authorization: Bearer smoke-access-token`. This prevents a regression where the frontend bypasses the dashboard API client after backend report routes are protected.
- Fee-only/no-refund cancellations now close `payment_holdings` as `cancelled` with `refunded=false` while preserving `refundStatus=FEE_ONLY` or `NO_REFUND_REQUIRED` for audit. Real refund statuses (`REFUNDED`, `REFUNDED_FULL`, `REFUNDED_PARTIAL`) still mark the payment as refunded to block replay. This removes the false evidence where a retained cancellation fee could look like a Pix refund.
- Driver eligibility full-suite correction: the vehicle-assignment conflict test now builds an actually active canonical driver activation fixture before expecting `VEHICLE_ASSIGNED_TO_ANOTHER_DRIVER`. This preserves the production behavior that pre-registered drivers are blocked by activation first, while still proving that active drivers cannot enter dispatch with a vehicle assigned to another driver.
- Receipt unit noise cleanup: the receipt service unit test now stubs static map image generation, so the unit suite no longer emits a local Google Maps key warning unrelated to production config. Runtime config validation remains the source of truth for Firebase/Google readiness.
- Dashboard proof: `npm --prefix leaf-dashboard-js run qa:backoffice` passed, including lint, production build, smoke route rendering, financial reconciliation money contract, no direct provider calls, and authenticated report export.
- Backend proof: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js tests/unit/commands/CancelRideCommand.unit.test.js tests/unit/services/payment-service.payment-status-cache.unit.test.js tests/unit/services/payment-refund-boundary.unit.test.js tests/unit/routes/dashboard-driver-quick-approval-boundary.unit.test.js tests/unit/routes/metrics-financial-routes.unit.test.js tests/unit/services/kyc-legacy-boundary.unit.test.js tests/unit/routes/worker-health-routes-auth.unit.test.js tests/unit/routes/support-tier-roles-boundary.unit.test.js` passed, 9 suites / 77 tests.
- Full backend proof after the fixture/noise cleanup: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` passed, 191 suites / 937 tests.
- Mobile release guard proof: `npm --prefix mobile-app run qa:production-guards` passed.
- Baseline/config proof: `git diff --check`, `npm run governance:check`, `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`, `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`, `node leaf-websocket-backend/scripts/tests/assert-sensitive-route-guards.cjs`, and validator-mechanics `config:validate` passed. In runtime config, Firebase/Admin/RTDB and Google/Maps are configured; the only remaining warning is `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`.
- No backend deploy, OTA publication, native build, Pix creation, booking creation, driver seed, provider action, or real Android smoke was executed in this pass. The connected Android device remains reserved for the next explicitly authorized L2 smoke after local gates are green.

Acceptance meaning:

- A Wave 9 `blocked` result is acceptable only when the artifact explains the missing external precondition.
- A Wave 9 `fail` result is a product or environment failure that must be fixed before OTA, build promotion, backend deploy, or real smoke.
- A release candidate still needs one authorized L2 run with physical passenger device, driver emulator, sandbox payment profile, eligible driver availability, same-ride financial reconciliation, dashboard observation, rating, receipt, and terminal-state relaunch evidence.

## Validation Commands

Run these before closing any implementation PR:

```bash
git status --short
git diff --check
npm run governance:check
node scripts/maintenance/security/scan-secrets.cjs --tracked-only
bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh
npm --prefix mobile-app run qa:production-guards
npm --prefix mobile-app run test:unit -- --runInBand
npm --prefix leaf-websocket-backend run config:validate
npm --prefix leaf-websocket-backend run test:unit -- --runInBand
npm --prefix leaf-dashboard-js run qa:backoffice
```

Run real smoke only after explicit permission:

```bash
source mobile-app/scripts/source-local-build-env.sh
export ADB_BIN=/Users/izaakdias/Android/Sdk/platform-tools/adb
bash mobile-app/scripts/qa/prepare-real-smoke-env.sh
bash mobile-app/scripts/qa/run-core-audit-suite.sh
```

## Stop Conditions

Stop the run as blocked, not failed, when the environment violates a precondition:

- `blocked_precondition:device_not_ready`
- `blocked_precondition:toolchain_not_ready`
- `blocked_precondition:payment_sandbox_not_confirmed`
- `blocked_precondition:geofence_not_ready`
- `blocked_precondition:driver_unavailable`
- `blocked_precondition:driver_vehicle_identity_incomplete`
- `blocked_precondition:dashboard_auth_missing`

Stop as failed P0 when product behavior violates a rule after preconditions are satisfied:

- payment opens or confirms with no eligible driver;
- geofence blocks after payment;
- fare diverges across any surface;
- state regresses from active ride;
- completed ride rehydrates as active;
- straight-line route appears in customer flow;
- trip cannot be rated, receipted, or closed to clean map.

## Rollback Path

- Mobile behavior regression: revert the scoped mobile commit or publish a rollback OTA for runtime `1.0.3`.
- Backend lifecycle/payment regression: revert the scoped backend commit and redeploy only after preserving smoke artifacts.
- QA manifest/doc regression: revert this document and rerun validation commands.
- Test data issue: use only approved test cleanup paths and preserve ride/payment artifacts before cleanup.
