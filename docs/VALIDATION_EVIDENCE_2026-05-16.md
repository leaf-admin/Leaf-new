# Validation Evidence - 2026-05-16

Este arquivo registra a validação da branch `codex/project-cleanup-20260516`.

## Resultado geral

Status: aprovado para a limpeza desta branch.

Branch validada: `codex/project-cleanup-20260516`

Checkpoint de rollback: `checkpoint/pre-cleanup-20260516-current-state`

## Comandos executados

| Comando | Resultado | Evidencia |
| --- | --- | --- |
| `npm run test:profile` | PASS | Perfil impresso com branch `codex/project-cleanup-20260516`, Node `v20.20.2`, `APP_REVIEW=false`. |
| `bash -n scripts/maintenance/start-all-services.sh scripts/maintenance/services/restart-all-services.sh scripts/deploy-hostinger-completo.sh` | PASS | Sintaxe shell valida. |
| `node --check leaf-websocket-backend/server.js && node --check leaf-websocket-backend/server.vps.js && node --check scripts/prelaunch/run-prelaunch-suite.cjs && node --check leaf-websocket-backend/scripts/tests/assert-sensitive-route-guards.cjs` | PASS | Sintaxe JS valida. |
| `cd mobile-app && npx expo config --json` | PASS | `name=Leaf`, `slug=leafapp-reactnative`, `ios.buildNumber=23`, `android.versionCode=110`, `scheme=leafapp`. |
| `npm run lint:dashboard` | PASS | ESLint do `leaf-dashboard-js` sem erros. |
| `npm run build:dashboard` | PASS | Next build compilou e gerou 22 rotas. |
| `npm run test:route-guards --workspace leaf-websocket-backend` | PASS | `Sensitive route guard assertion passed.` |
| `npm run prelaunch:testids` | PASS | `Mobile testID guard: PASS (35 selectors)`. |
| `npm run prelaunch:copy` | PASS | `Onboarding copy guard: PASS`. |
| `npm run test:mobile` | PASS | 53 suites, 246 testes. |
| `npm run test:backend` | PASS | 90 suites unitarias + 5 suites de integracao, 369 testes no total. |
| `npm run prelaunch:audit` | PASS / GO | Copy, testIDs, preflight, backend strict real-sandbox e observabilidade passaram. Relatorio em `/Users/izaakdias/Documents/Leaf-new/reports/prelaunch/prelaunch-20260516T162600Z/prelaunch-report.md`. |

## Avisos observados

- `npm run test:mobile` terminou com exit code `0`, mas Jest avisou sobre handles assíncronos abertos.
- `npm run test:backend` terminou com exit code `0`, mas Jest forçou encerramento apos suites passarem.
- `npm run build:dashboard` avisou que existem lockfiles em raiz e `leaf-dashboard-js`; isso ja existia como configuracao do monorepo e nao bloqueou build.

## Simulador/dispositivo

Tentativa de validar ambiente local:

- `xcrun simctl list devices available` falhou com `xcrun: error: unable to find utility "simctl", not a developer tool or in PATH`.
- `xcode-select -p` retorna `/Library/Developer/CommandLineTools`, ou seja, esta maquina esta apontando para Command Line Tools e nao para Xcode completo.
- `adb devices` falhou porque `adb` nao esta instalado/disponivel no PATH.

Conclusao: a abertura em simulador/dispositivo fisico nao foi executavel neste ambiente. A validacao desta branch ficou coberta por config Expo, lint/build dashboard, unit/integration mobile/backend, guards e prelaunch audit.
