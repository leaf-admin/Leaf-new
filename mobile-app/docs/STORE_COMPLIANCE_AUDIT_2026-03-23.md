# Store Compliance Audit (2026-03-23)

## Status
- Code hardening for publication: **APPLIED**
- Automated checks (`expo-doctor`, permission hardening, runtime endpoint checks): **PASS**

## Applied in code (this cycle)
- Prototype/test navigation hidden in production builds.
- Review-account OTP bypass constrained to review/dev gates only.
- Account deletion flow hardened (backend purge + mobile session reset after deletion).
- Dedicated entry in settings: `Privacidade e Exclusão`.
- Background-location disclosure gate before requesting `always/background` permission.
- Runtime references to legacy provider naming removed from mobile runtime.
- API base URL usage standardized in key services through `src/config/backendBaseUrl.js`.

## Remaining items before store submission (operational, outside code)

### Apple App Store Connect
- Fill `App Review Notes` with review credentials and exact test flow.
- Confirm legal URLs are final public production URLs (prefer brand domain over temporary host/IP domain).
- Ensure privacy answers in App Store Connect match app behavior (location in foreground/background for driver mode).
- Provide explanation for background location usage focused on driver online/active trip continuity.

### Google Play Console
- Submit `ACCESS_BACKGROUND_LOCATION` declaration form with:
  - core feature justification (driver availability/navigation with app minimized),
  - in-app prominent disclosure text,
  - short demo video showing the exact permission flow.
- Complete `Data safety` with exact data categories collected/processed (location, identifiers, support metadata, ride data).
- Ensure policy links in listing are reachable without authentication.

### Release readiness package
- Final screenshots/video from production-like build (no dev/test/prototype screens visible).
- Soft-release test evidence (auth, ride start/end, reconnect, account deletion).
- Incident/rollback plan attached to release notes.

## Known residual risk
- The app currently declares background location at manifest level. This is expected for driver operation, but approval depends on correct console declarations and clear reviewer evidence.
