# Leaf — inventário de alterações para RC

**Data:** 2026-09-09
**Branch:** codex/uiux-integration-validation
**HEAD:** c5cf21fd4
**Entradas capturadas:** 138

Este inventário foi gerado a partir de git status --short para separar as mudanças por domínio antes do manifesto RC. Os status e caminhos são apenas fotografia; a aceitação exige revisão do diff, testes no SHA final e worktree limpo. Nenhuma alteração foi descartada.

| Status | Caminho | Domínio | Disposição |
| --- | --- | --- | --- |
|  M | .github/workflows/eas-build.yml | build/release tooling | revisar no diff final |
|  M | leaf-dashboard-js/app/drivers/[id]/documents/page.js | dashboard | revisar no diff final |
|  M | leaf-dashboard-js/package.json | dashboard | revisar no diff final |
|  M | leaf-dashboard-js/scripts/tests/kyc-identity-review-panel-contract.cjs | dashboard | revisar no diff final |
|  M | leaf-dashboard-js/src/components/kyc/KycIdentityReviewPanel.jsx | dashboard | revisar no diff final |
|  M | leaf-websocket-backend/bootstrap/http-middleware.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/package.json | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/account-routes.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/dashboard.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/driver-approval.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/payment.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/support.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/woovi-driver.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/routes/woovi.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/scripts/deploy/validate-runtime-config.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/scripts/tests/driver-dispatch-bot.cjs | backend | revisar no diff final |
|  M | leaf-websocket-backend/scripts/tests/smoke-woovi-sandbox.cjs | backend | revisar no diff final |
|  M | leaf-websocket-backend/server.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/driver-approval-service.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/driver-identity-trust-service.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/driver-notification-dispatcher.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/financial-reconciliation-dashboard-service.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/kyc-identity-review-workflow-service.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/payment-service.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/services/woovi-driver-service.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/contracts/backend-dependency-security-contract.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/routes/account-routes.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/routes/dashboard-financial-route-guards.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/routes/dashboard-kyc-identity-review-boundary.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/routes/driver-approval-routes.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/routes/support-routes-admin-ops.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/routes/woovi-webhook-guards.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/scripts/validate-runtime-config.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/services/driver-approval-woovi-subaccount.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/services/driver-identity-trust-service.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/services/driver-notification-dispatcher.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/services/financial-reconciliation-dashboard-service.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/services/kyc-identity-review-workflow-service.unit.test.js | backend | revisar no diff final |
|  M | leaf-websocket-backend/tests/unit/services/payment-service.payment-status-cache.unit.test.js | backend | revisar no diff final |
|  M | mobile-app/.maestro/flows/qa/_accept-open-prompt-no-launch.yaml | mobile | revisar no diff final |
|  M | mobile-app/.maestro/flows/qa/e2e/01-driver-login-online-8082.yaml | mobile | revisar no diff final |
|  M | mobile-app/.maestro/flows/qa/e2e/02-passenger-login-8081.yaml | mobile | revisar no diff final |
|  M | mobile-app/.maestro/flows/qa/ui-ux-lifecycle-state-assert-ios.yaml | mobile | revisar no diff final |
|  M | mobile-app/__tests__/android-real-device-smoke-contract.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/driver-home-overlay.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/driver-online-toggle.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/friendly-error-messages.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/mobile-tooling-dependency-security-contract.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/native-aws-liveness-localization-contract.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/onboarding-profile-service.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/passenger-home-automation-config.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/passenger-home-overlay.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/phone-input-step.auth.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/prototype-map-layer-viewport.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/prototype-reduced-motion.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/prototype-runtime-session-sanitize.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/qa-seed-current-routes.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/qa-seed-profile.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/ux-lab.test.js | mobile | revisar no diff final |
|  M | mobile-app/__tests__/woovi-payment-modal.test.js | mobile | revisar no diff final |
|  M | mobile-app/ios/Leaf.xcodeproj/project.pbxproj | mobile | revisar no diff final |
|  M | mobile-app/jest.config.js | mobile | revisar no diff final |
|  M | mobile-app/package.json | mobile | revisar no diff final |
|  M | mobile-app/scripts/build-local-android.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/build-local-ios.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/local-build-doctor.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/manual-e2e-helper.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa-simulate-ride-flow.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/android-real-device-smoke.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/assert-backend-payment-runtime-canary.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/assert-backend-real-sandbox.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/build-smoke-evidence-report.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/collect-ride-dashboard-evidence.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/current-flow-e2e-debug-run.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/current-flow-e2e-lab.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/driver-bot-passenger-device.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/open-dual-ios-vps.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/preflight-dual-ios-vps.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/prepare-real-smoke-env.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/run-dual-driver-concurrency-ios.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/seed-prototype-android-state.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/seed-prototype-ios-state.cjs | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/simulate-latest-ride-payment.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/qa/verify-android-role-runtimes.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/run-e2e-stable-guarded.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/run-e2e-vps.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/run-prototype-ideal-lifecycle-ios.sh | mobile | revisar no diff final |
|  M | mobile-app/scripts/source-local-build-env.sh | mobile | revisar no diff final |
|  M | mobile-app/src/components/auth/AuthFlow.js | mobile | revisar no diff final |
|  M | mobile-app/src/components/auth/steps/PhoneInputStep.js | mobile | revisar no diff final |
|  M | mobile-app/src/components/payment/WooviPaymentModal.js | mobile | revisar no diff final |
|  M | mobile-app/src/components/prototype/PrototypeMapLayer.js | mobile | revisar no diff final |
|  M | mobile-app/src/components/prototype/PrototypeScreenTransition.js | mobile | revisar no diff final |
|  M | mobile-app/src/config/reviewAccounts.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/RobotaxiCancellationScreen.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/RobotaxiDestinationScreen.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/RobotaxiHomeScreen.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/RobotaxiPaymentFailedScreen.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/RobotaxiTripScreen.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/home/DriverHomeOverlay.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/home/PassengerHomeOverlay.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/passengerHomeAutomationConfig.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/prototypeRideRuntime.js | mobile | revisar no diff final |
|  M | mobile-app/src/screens/prototype/rideLifecycleSurfaceMatrix.js | mobile | revisar no diff final |
|  M | mobile-app/src/services/OnboardingProfileService.js | mobile | revisar no diff final |
|  M | mobile-app/src/services/WooviService.js | mobile | revisar no diff final |
|  M | mobile-app/src/utils/friendlyErrorMessages.js | mobile | revisar no diff final |
|  M | mobile-app/src/utils/qaSeedProfile.js | mobile | revisar no diff final |
|  M | mobile-app/ux-lab/config/journeys.json | mobile | revisar no diff final |
|  M | package-lock.json | build/release tooling | revisar no diff final |
|  M | package.json | build/release tooling | revisar no diff final |
| ?? | docs/validation/CANONICAL_PHYSICAL_QA_PROFILE.md | release evidence/docs | revisar no diff final |
| ?? | docs/validation/CURRENT_SURFACE_MENU_AUDIT_20260903.md | release evidence/docs | revisar no diff final |
| ?? | docs/validation/FIREBASE_TEST_PHONE_AUTH_SMOKE_20260903.md | release evidence/docs | revisar no diff final |
| ?? | docs/validation/LIFECYCLE_TRANSITION_VALIDATION_20260903.md | release evidence/docs | revisar no diff final |
| ?? | docs/validation/TERMINAL_TRANSITION_VALIDATION_20260903.md | release evidence/docs | revisar no diff final |
| ?? | docs/validation/UX_STATE_REBRAND_TODO.md | release evidence/docs | revisar no diff final |
| ?? | docs/validation/rc-20260907/ | release evidence/docs | revisar no diff final |
| ?? | leaf-websocket-backend/services/account-lifecycle-service.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/services/cpf-identity-registry-service.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/services/cpf-review-service.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/tests/unit/helpers/ | backend | revisar no diff final |
| ?? | leaf-websocket-backend/tests/unit/scripts/smoke-woovi-sandbox.unit.test.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/tests/unit/services/account-lifecycle-service.unit.test.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/tests/unit/services/cpf-identity-registry-service.unit.test.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/tests/unit/services/cpf-review-service.unit.test.js | backend | revisar no diff final |
| ?? | leaf-websocket-backend/tests/unit/services/woovi-driver-service.unit.test.js | backend | revisar no diff final |
| ?? | mobile-app/.maestro/flows/qa/boot-app-ready-ios.yaml | mobile | revisar no diff final |
| ?? | mobile-app/.maestro/flows/qa/qa-session-bootstrap-ios.yaml | mobile | revisar no diff final |
| ?? | mobile-app/.maestro/flows/qa/qa-session-reset-ios.yaml | mobile | revisar no diff final |
| ?? | mobile-app/.maestro/flows/qa/transitions/ | mobile | revisar no diff final |
| ?? | mobile-app/__tests__/android-build-script.test.js | mobile | revisar no diff final |
| ?? | mobile-app/__tests__/prototype-screen-transition.test.js | mobile | revisar no diff final |
| ?? | mobile-app/__tests__/same-ride-reconciliation-contract.test.js | mobile | revisar no diff final |
| ?? | mobile-app/scripts/qa/run-prototype-ios-state-matrix.cjs | mobile | revisar no diff final |
| ?? | mobile-app/scripts/qa/validate-same-ride-reconciliation.cjs | mobile | revisar no diff final |
| ?? | mobile-app/scripts/qa/verify-host-readiness.sh | mobile | revisar no diff final |

## Próximo passo de aceite

1. Cada caminho deve ser marcado como release, QA/documentação ou alteração do usuário.
2. Alterações fora do release devem ser guardadas em branch/commit separado sem reset amplo.
3. Só depois da revisão e da limpeza controlada o manifesto RC deve ser criado.
4. Reexecutar governança, secret scan, diff check, testes afetados e CI no SHA do manifesto.
