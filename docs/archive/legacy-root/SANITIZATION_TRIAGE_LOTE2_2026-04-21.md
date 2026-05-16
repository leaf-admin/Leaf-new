# Sanitization Triage - Lote 2 (2026-04-21)

## Escopo avaliado
- Superfície ativa: `mobile-app/src`, `leaf-websocket-backend/{bootstrap,commands,routes,services,utils,workers}`, `leaf-dashboard-js/{app,src}`.
- Base de triagem: `git status --short` + agrupamento por diretório + checagem de referência.

## Resultado resumido
- Alterações totais no workspace: `1559`
- Distribuição: `867 D`, `437 M`, `255 ??`
- Superfície ativa (código) concentrada em:
  - `mobile-app/src` (242 entradas)
  - `leaf-websocket-backend/{bootstrap,routes,services,commands,utils}` (121+ entradas)
  - `leaf-dashboard-js/{app,src}` (9 entradas)

## Classificação

### 1) MANTER (produto/runtime)
- Backend core:
  - `leaf-websocket-backend/bootstrap/*`
  - `leaf-websocket-backend/commands/*`
  - `leaf-websocket-backend/routes/*` (incluindo `auth-password.js`, `driver-activation.js`, `ops.js`)
  - `leaf-websocket-backend/services/*` (incluindo `ride-cost-telemetry-service.js`, `pricing-h3-read-model-service.js`)
  - `leaf-websocket-backend/utils/*` (incluindo `dispatch-config.js`, `fare-snapshot-utils.js`, `vps-metrics.js`)
- Mobile core:
  - `mobile-app/src/screens/*` e `mobile-app/src/screens/prototype/*`
  - `mobile-app/src/components/*` e `mobile-app/src/components/prototype/*`
  - `mobile-app/src/services/*` e `mobile-app/src/services/runtime/*`
  - `mobile-app/src/config/*`, `mobile-app/src/state/*`, `mobile-app/src/theme/*`
- Dashboard core:
  - `leaf-dashboard-js/app/*`
  - `leaf-dashboard-js/src/*`

### 2) MANTER (qualidade/observabilidade)
- Testes novos/ajustados:
  - `mobile-app/__tests__/*`
  - `leaf-websocket-backend/tests/unit/*`
  - `leaf-websocket-backend/tests/integration/contracts/*`
- Guardrails:
  - `.github/workflows/secret-guard.yml`
  - `scripts/validation/*`
  - `leaf-websocket-backend/scripts/tests/assert-sensitive-route-guards.cjs`

### 3) DESCARTAR (não versionar)
- Artefatos de execução/build/report:
  - `leaf-websocket-backend/coverage/**`
  - `leaf-websocket-backend/reports/**`
  - `leaf-websocket-backend/stress-reports-vps-20260306/**`
  - `.tmp/**`, `.tmp-*/**`
  - `mobile-app/tmp/**`, `mobile-app/screenshots-*/**`, `mobile-app/playwright-report/**`
  - `mobile-app/apk/**`, `mobile-app/dist-export-android*/**`
  - imagens de debug de execução
- Secret local removido do tracked:
  - `config/firebase/gradle.properties` (manter fora do git)

### 4) AVALIAR ANTES DE FECHAR
- Legado arquivado:
  - `mobile-app/src/deprecated/**` (sem referência ativa de runtime)
  - `leaf-websocket-backend/deprecated/**`
- Scripts operacionais antigos/migração:
  - `scripts/maintenance/**`
  - `leaf-websocket-backend/scripts/deploy/**`
  - Recomendação: separar em commit de infraestrutura (não misturar com lógica de produto).

## Lotes de commit recomendados

1. `sanitization-artifacts`: apenas remoção de artefato + `.gitignore`.
2. `runtime-backend-core`: mudanças de `bootstrap/routes/services/commands/utils`.
3. `runtime-mobile-core`: mudanças de `mobile-app/src` + assets necessários.
4. `dashboard-runtime`: mudanças de `leaf-dashboard-js`.
5. `tests-and-guards`: testes e scripts de validação.
6. `docs-and-runbooks`: documentação operacional (opcional separado).

## Observações de risco
- Não misturar `scripts/maintenance` com runtime do app/backend no mesmo commit.
- Não commitar build local (`test-build-final-success`) no repo principal; se precisar manter localmente, manter fora da história de produto.
