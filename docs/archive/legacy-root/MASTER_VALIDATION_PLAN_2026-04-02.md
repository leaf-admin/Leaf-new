# Master Validation Plan

Date: 2026-04-02
Scope: Leaf mobility app with two roles in a single app, plus backend, KYC, document extraction, dashboard/admin and financial services

## Grounding In Current Codebase

Primary anchors in the current stack:

- Mobile app: `mobile-app/src/screens/prototype/*`, `mobile-app/src/screens/*`
- Mobility backend: `leaf-websocket-backend/services/*`, `leaf-websocket-backend/routes/*`, `leaf-websocket-backend/bootstrap/*`
- Admin dashboard: `leaf-dashboard-js/app/*`, `leaf-dashboard-js/src/*`
- KYC and OCR: `leaf-websocket-backend/services/kyc-service.js`, `leaf-websocket-backend/services/IntegratedKYCService.js`, `leaf-websocket-backend/services/document-ai-extraction-service.js`, `leaf-websocket-backend/services/ocr-service.js`
- Ride lifecycle: `leaf-websocket-backend/services/ride-lifecycle-service.js`, `leaf-websocket-backend/services/ride-state-manager.js`, `leaf-websocket-backend/services/driver-notification-dispatcher.js`
- Geofence: `leaf-websocket-backend/services/geofence-service.js`, `leaf-websocket-backend/routes/geofence-routes.js`
- Ratings: `leaf-websocket-backend/services/rating-service.js`
- Driver finance and daily fee: `leaf-websocket-backend/services/woovi-driver-service.js`, `leaf-websocket-backend/services/payment-service.js`, `leaf-websocket-backend/services/daily-subscription-service.js`, `leaf-websocket-backend/services/driver-subscription-service.js`

## Execution Model

- Environment 1: local simulator flow for UI, navigation, lifecycle regression, menus, animations and state recovery
- Environment 2: VPS or staging-like backend with real websocket flow, Redis, booking orchestration and payment mock
- Environment 3: production-like admin and financial validation with controlled test accounts
- Evidence for every item: screenshot or video, backend log or trace, Redis or DB state when relevant, pass or fail note, owner, date
- Rule for screenshots in dynamic flows: wait 15 seconds before capturing unless the scenario explicitly validates instant response

## Master Order Of Execution

- [ ] Wave 0: environment sanity, seed users, clean driver and passenger state, observability on
- [ ] Wave 1: registration, profile selection, OTP, documents, OCR, KYC
- [ ] Wave 2: driver activation, geofence eligibility, online or offline, dispatch readiness
- [ ] Wave 3: passenger quote, payment mock, driver offer, full ideal ride lifecycle
- [ ] Wave 4: exception lifecycle, reconnection, cancellation, timeout, reassignment, interrupted ride
- [ ] Wave 5: ratings, support, menus, submenus, invitations, admin dashboard
- [ ] Wave 6: finance, withdrawals, daily fee debit, abuse protection, soft ban, operational policies
- [ ] Wave 7: design audit, zoom behavior audit, animation audit, timeout audit, regression pack

## 1. Driver Validation Plan

- [ ] Driver can log in and remain in driver role after app restart
- [ ] Driver sees correct home state when offline
- [ ] Driver can go online only when activation and KYC rules allow it
- [ ] Driver sees clear blocked reason when activation or KYC is incomplete
- [ ] Driver online toggle responds quickly and does not hang on stale GPS bootstrap
- [ ] Driver stays online after one completed ride when business rules allow it
- [ ] Driver home shows correct earnings, trip count and rating snapshots
- [ ] Driver location and heading refresh without UI flicker or state desync
- [ ] Driver receives only eligible ride categories
- [ ] Driver does not receive rides outside allowed geofence or policy rules
- [ ] Driver sees correct pickup and destination labels in offer and active ride
- [ ] Driver sees stable net value in offer and active ride, never drifting within the same booking
- [ ] Driver can open navigation and return to app without losing ride state
- [ ] Driver can restart app during accepted, arrived and started states and recover to the exact proper screen
- [ ] Driver cannot accidentally accept two rides at once
- [ ] Driver cannot manipulate UI to bypass offline, activation or KYC restrictions

Exit criteria:

- [ ] Driver role has deterministic state recovery across app relaunch
- [ ] No stale locks, ghost offers or incorrect readiness state remain after common operations

## 2. Passenger Validation Plan

- [ ] Passenger can log in and remain in passenger role after app restart
- [ ] Passenger home opens with clean map-first layout and working search affordance
- [ ] Passenger quote cards show availability by category before payment
- [ ] Passenger cannot request a category that is unavailable in that region
- [ ] Passenger changing origin before payment recalculates quote
- [ ] Passenger changing destination before payment recalculates quote
- [ ] Passenger returning from quote or payment preserves coherent map and route preview state
- [ ] Passenger request enters search state and remains open for the configured search window
- [ ] Passenger sees correct pickup and dropoff labels during search and active ride
- [ ] Passenger sees correct live vehicle progress while driver is approaching
- [ ] Passenger sees correct in-trip state and can follow ride on the map
- [ ] Passenger app restart during search, accepted, arrived and started restores the correct state
- [ ] Passenger can reach receipt, rating and support paths after completion
- [ ] Passenger cannot request duplicate rides from the same unfinished intent

Exit criteria:

- [ ] Passenger flow is quote-first, payment-confirmed, request-open, map-driven and restart-safe

## 3. Registration Validation Plan

- [ ] OTP request works for fresh users
- [ ] OTP request works for returning users
- [ ] OTP invalid, expired and reused token cases are blocked correctly
- [ ] Profile selection persists correctly between passenger and driver paths
- [ ] Basic registration fields enforce format, length and required checks
- [ ] Duplicate email, phone and CPF paths are handled correctly
- [ ] Restart during registration resumes safely from persisted onboarding state
- [ ] Registration cannot bypass mandatory consent or terms acceptance
- [ ] Session and auth tokens survive app relaunch correctly

Exit criteria:

- [ ] No user can enter the system with partial or conflicting identity state

## 4. Document Reading And Extraction Validation Plan

- [ ] CNH upload works with clean image, low-light image, tilted image and cropped image
- [ ] CRLV upload works with clean image, low-light image, tilted image and cropped image
- [ ] PDF extraction works when the source is a PDF instead of image
- [ ] OCR extracts name, document number, expiry date and key document attributes correctly
- [ ] OCR handles accented names and long addresses
- [ ] OCR rejects unreadable or incomplete documents with actionable feedback
- [ ] Document upload failures, timeout and partial upload are recovered cleanly
- [ ] Extracted fields are normalized consistently before persistence
- [ ] Extracted data never silently overwrites stronger manually confirmed data without auditability

Exit criteria:

- [ ] OCR and document extraction produce reliable fields or explicit failure, never silent garbage

## 5. Driver KYC Validation Plan

- [ ] Driver onboarding enters the correct KYC state machine
- [ ] Face capture and liveness path work end to end
- [ ] Face mismatch is rejected correctly
- [ ] Expired document is rejected correctly
- [ ] Missing document fields are rejected or routed to manual review correctly
- [ ] KYC retry policy works and does not create infinite loops
- [ ] Manual review state is visible to the driver with correct messaging
- [ ] Approved driver can move to activation and online eligibility
- [ ] Rejected driver stays blocked from availability and booking acceptance
- [ ] KYC analytics and notifications are emitted on key transitions

Exit criteria:

- [ ] KYC outcomes directly and correctly gate driver activation and online readiness

## 6. End To End Ride Lifecycle, Ideal Path

- [ ] Driver online and eligible in correct geofence
- [ ] Passenger opens quote and sees category availability
- [ ] Passenger selects category and pays via mock
- [ ] Booking is created once, with fixed financial snapshot
- [ ] Passenger enters search state
- [ ] Driver receives offer with correct pickup, dropoff, category and net value
- [ ] Driver accepts
- [ ] Passenger sees driver assigned
- [ ] Driver reaches pickup and confirms arrival
- [ ] Passenger sees arrival state and boarding countdown
- [ ] Driver starts trip
- [ ] Passenger enters in-trip live map state
- [ ] Driver completes trip
- [ ] Passenger and driver receive receipt
- [ ] Passenger rates driver
- [ ] Driver can rate passenger if business rule applies
- [ ] Booking, payment, receipt and rating state converge cleanly in backend

Expected events:

- [ ] `ride.requested`
- [ ] `payment.confirmed`
- [ ] `ride.accepted`
- [ ] `driver arrived` or equivalent arrival transition
- [ ] `ride.started`
- [ ] trip location updates during active ride
- [ ] `ride.completed`
- [ ] rating submitted

Exit criteria:

- [ ] One clean booking, one payment decision, one trip completion, one receipt outcome, stable UI on both sides

## 7. End To End Ride Lifecycle, Exception Paths

- [ ] Passenger loses connection during quote
- [ ] Passenger loses connection during search
- [ ] Passenger loses connection after driver accept
- [ ] Passenger loses connection during active ride
- [ ] Driver loses connection before seeing the offer
- [ ] Driver loses connection with offer on screen
- [ ] Driver loses connection after accept
- [ ] Driver loses connection during active ride
- [ ] Passenger force closes app during search
- [ ] Driver force closes app during accepted state
- [ ] Driver force closes app during started state
- [ ] Payment confirmation arrives late
- [ ] Driver ignores the offer and timeout expires
- [ ] Driver rejects once and is cooled down before reoffer
- [ ] Driver rejects twice and no longer receives the same booking
- [ ] No drivers available at quote time
- [ ] Drivers become available after search already started
- [ ] Operational interruption mid-ride
- [ ] Replacement driver search after interruption
- [ ] Early trip termination and proportional settlement
- [ ] Duplicate websocket events do not corrupt ride state
- [ ] Out of order websocket events do not corrupt ride state

Exit criteria:

- [ ] Recovery is deterministic and the system never leaves zombie bookings or invisible active rides

## 8. Driver Ride Acceptance Validation Plan

- [ ] Driver receives offer only once per initial dispatch attempt
- [ ] Driver offer contains correct net value from booking snapshot
- [ ] Driver cannot accept stale or already claimed booking
- [ ] Driver cannot accept while blocked, offline or out of policy
- [ ] Driver rejection cooldown works exactly as defined
- [ ] Driver second rejection excludes the booking for that driver
- [ ] Offer timeout expires cleanly and does not prematurely kill valid search state
- [ ] Driver acceptance updates Redis, websocket and booking state atomically enough to avoid dual accept

Exit criteria:

- [ ] Offer, accept, reject and timeout are idempotent and race-safe

## 9. Ratings Validation Plan

- [ ] Passenger can rate driver after completed trip
- [ ] Driver can rate passenger if that rule is active
- [ ] Rating UI cannot be submitted twice for the same ride
- [ ] Rating persistence survives app relaunch
- [ ] Comment or complaint path opens correctly from low rating flow
- [ ] Negative rating triggers the right downstream services and analytics
- [ ] Repeated negative patterns are visible to moderation or soft-ban logic

Exit criteria:

- [ ] Ratings are single-use per trip, attributable and auditable

## 10. Menus, Submenus And Utilities Validation Plan

- [ ] Passenger menu opens full-screen over the map with correct contrast and animation
- [ ] Driver menu opens full-screen over the map with correct contrast and animation
- [ ] No white sheet artifacts, card ghosts or offset bleed behind menus
- [ ] Each menu item leads to the correct screen
- [ ] Profile screen is coherent for each role
- [ ] Settings screen is coherent for each role
- [ ] Trip history screen shows correct data for each role
- [ ] Earnings and activation screens are reachable only where relevant
- [ ] Support, chat and legal utilities open from the right contexts

Exit criteria:

- [ ] Menus are coherent, non-redundant and visually aligned with the app design system

## 11. Driver Invitation System Validation Plan

- [ ] Referral or invitation creation works for valid inviter
- [ ] Invite code or link is unique and attributable
- [ ] Invite redemption works once and only once when rules demand that
- [ ] Invalid, expired or duplicated invite usage is blocked
- [ ] Invite effects on onboarding and rewards are correctly recorded
- [ ] Dashboard or backend reporting reflects invite lifecycle accurately

Exit criteria:

- [ ] Invitation attribution cannot be gamed or duplicated

## 12. Geofence Validation Plan

- [ ] Driver inside active geofence can become eligible
- [ ] Driver outside active geofence cannot receive offers
- [ ] Boundary edge cases behave consistently near borders
- [ ] H3 or geofence refresh updates do not flicker eligibility incorrectly
- [ ] Passenger quote availability reflects active driver presence by region
- [ ] Ride started inside one area and completed in another does not break eligibility recovery
- [ ] Geofence changes in admin propagate safely

Exit criteria:

- [ ] Geofence is consistent across quote, search, dispatch, ride completion and driver recovery

## 13. Zoom In And Zoom Out Behavior Analysis

- [ ] Home map camera follows user without overreacting
- [ ] Passenger quote route preview frames route without aggressive oscillation
- [ ] Passenger search expands search radius with smooth visual progression
- [ ] Passenger accepted state shows driver approach without jitter
- [ ] Passenger started state shows live ride without background jump
- [ ] Driver home follows only when useful
- [ ] Driver offer freezes background camera while decision card is open
- [ ] Driver active ride camera supports navigation context without random zoom churn
- [ ] App relaunch does not cause extreme camera reset loops

Exit criteria:

- [ ] Every zoom action has a business reason and no camera motion feels decorative or broken

## 14. Withdrawal Service Analysis

- [ ] Driver balance is computed from settled earnings only
- [ ] Withdrawal request validates amount, limits, status and banking readiness
- [ ] Pending withdrawal is visible and prevents conflicting duplicate requests if required
- [ ] Failed withdrawal is reversible or retryable according to policy
- [ ] Successful withdrawal updates balances, ledger and dashboard correctly
- [ ] Receipt or statement for withdrawal is traceable
- [ ] Withdrawal service stays consistent when websocket and REST timing differ

Exit criteria:

- [ ] No money can be withdrawn twice and no settled balance disappears without trace

## 15. Soft Ban For Recurrent Negative Ratings Analysis

- [ ] Repeated negative rating thresholds are clearly defined
- [ ] Soft-ban is applied only with valid evidence and correct scope
- [ ] Soft-ban blocks the intended abilities and nothing beyond that scope
- [ ] Driver or passenger messaging explains blocked state appropriately
- [ ] Appeal, review or manual override path exists if required
- [ ] Soft-ban expiry or persistence follows policy and is auditable

Exit criteria:

- [ ] Soft-ban logic is explainable, reversible by policy and resistant to noisy false positives

## 16. Admin Dashboard Analysis

- [ ] Login and RBAC work correctly
- [ ] Dashboard home metrics reflect backend truth
- [ ] Drivers page shows activation, KYC and live status coherently
- [ ] Users page supports customer and driver lookup accurately
- [ ] Maps or observability pages reflect live operational state
- [ ] Subscriptions and programs pages reflect financial rules correctly
- [ ] Support page can inspect tickets and conversation history
- [ ] Notifications page works without duplicate or stale pushes
- [ ] Reports and exports are consistent with underlying data
- [ ] Admin actions leave audit trail

Exit criteria:

- [ ] Dashboard can observe and operate the system without creating inconsistent backend state

## 17. Design, Animation, Typography, Timeout And Abuse Protection Analysis

- [ ] Fonts, sizing and spacing are consistent between driver and passenger flows
- [ ] Sheets, menus and cards animate smoothly and predictably
- [ ] No overlay fights with the map or causes double-surface confusion
- [ ] Timeout copy matches real backend behavior
- [ ] Search timeout, offer timeout and payment timeout are aligned with business rules
- [ ] Buttons are debounced against repeated tap abuse
- [ ] Network retry paths do not spam backend with duplicated requests
- [ ] Role switching or logout does not leak prior user state
- [ ] Security and abuse controls cover replay, duplicate payment confirm, repeated rating submit, duplicate ride request and duplicate accept

Exit criteria:

- [ ] UX feels intentional and abuse protections match the actual risk points

## 18. Daily Fee Debit On Withdrawal After Grace Period Analysis

- [ ] Grace period start and end are computed correctly
- [ ] Driver sees the correct pre-withdrawal fee warning when grace period expired
- [ ] Daily fee deduction is computed once and only once per rule
- [ ] Net withdrawal amount reflects fee deduction correctly
- [ ] Ledger stores gross, fee and net separately
- [ ] Receipts and dashboard reflect the deduction transparently
- [ ] Edge cases work: no balance, partial balance, multiple withdrawals, already charged day, grace period still active

Exit criteria:

- [ ] Fee deduction is deterministic, transparent, non-duplicated and financially auditable

## Suggested Ownership And Automation Split

- [ ] Manual first: UI, map, gestures, navigation, visual timing, menu behavior, document capture quality
- [ ] Semi-automated: simulator lifecycle smoke, registration smoke, menu routing, search and receipt flows
- [ ] Backend automated: ride state transitions, dispatch rules, cooldown, exclusions, KYC policy, geofence policy, payment and settlement invariants
- [ ] Dashboard automated where possible: auth, RBAC, page availability, key live-data contracts

## Suggested Priority

- [ ] P0: registration, documents, KYC, driver activation, geofence eligibility, ideal ride lifecycle, connection loss during active ride, driver accept or reject rules, payment correctness, receipt and rating
- [ ] P1: menus, submenus, support, invitations, dashboard, withdrawal service, daily fee debit, zoom behavior polish
- [ ] P2: design polish, animation polish, soft-ban calibration, advanced abuse scenarios, long soak tests

## Release Gate

- [ ] No P0 open bug in registration, KYC, payment, dispatch, ride lifecycle, receipt or rating
- [ ] No silent state corruption across reconnect or relaunch
- [ ] No financial mismatch between quote, booking, receipt and withdrawal
- [ ] Dashboard reflects real operational truth for support and intervention
- [ ] At least one full green pass of ideal lifecycle and one full green pass of exception lifecycle on current build
