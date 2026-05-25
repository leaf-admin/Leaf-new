# Prelaunch Maestro Flows

Esta pasta agrupa os fluxos mobile usados pela rodada `prelaunch`.

O runner principal esta em `scripts/prelaunch/run-prelaunch-suite.cjs`; ele chama os fluxos existentes por meio de `npm run qa:core:audit --workspace mobile-app`.

Fluxos cobertos hoje:

- `auth/01-login-customer-real.yaml`
- `auth/03-phone-otp-login-new-ios.yaml`
- `rides/01-request-ride-real.yaml`
- `qa/11-passenger-menu-support-settings-audit.yaml`
- `qa/12-passenger-rating-screen-audit.yaml`
- `qa/e2e/04-driver-offer-trip-complete.yaml`
- `qa/e2e/20-passenger-signup-real-android.yaml`
- `qa/e2e/21-driver-signup-docs-real-android.yaml`

Para uma rodada completa, combine Maestro com o simulador backend de 10 corridas. Maestro valida a experiencia de tela; o simulador valida consistencia de estado, ledger, eventos, metricas e recibo.
