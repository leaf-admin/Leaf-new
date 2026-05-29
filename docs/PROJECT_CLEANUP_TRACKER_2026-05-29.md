# Project Cleanup Tracker - 2026-05-29

## Objetivo

Limpar o projeto em baby steps, sem remover legado vivo nem misturar limpeza com mudanças funcionais. Cada bloco deve ter escopo pequeno, validação própria e rollback simples.

## Estado Inicial

- Branch de trabalho: `codex/project-cleanup-baby-steps`.
- Branch anterior: `main`.
- Commit base: `3897ccad`.
- Worktree já estava suja antes desta limpeza com mudanças reais de Woovi, mobile UI/runtime e assets do carrinho.
- Tamanho após limpeza prévia de artefatos locais: projeto `20G`, `mobile-app` `2.8G`, backend `193M`, dashboard `14M`, `reports` `1.6G`.

## Produto Vivo

- `mobile-app`: app principal iOS/Android.
- `mobile-app/src/screens/prototype`: UI atual do ciclo da corrida, apesar do nome `prototype`.
- `mobile-app/src/components/prototype`: mapas, overlays e componentes visuais atuais.
- `leaf-websocket-backend`: API, Socket.IO, workers, pagamentos, KYC, campanhas, suporte e observabilidade.
- `leaf-dashboard-js`: dashboard operacional atual.
- `services/face-compare-service`: serviço atual de comparação facial.
- `services/support-agent-orchestrator`: orquestrador atual de suporte.
- `landing-page`: páginas públicas, convite, termos, privacidade e exclusão de conta.

## Legado Vivo - Nao Remover Agora

- `mobile-app/src/common-local`: ainda tem imports ativos em app, hooks, runtime bridges, telas antigas e utilitários.
- `mobile-app/src/components/map/PassengerUI.js` e `mobile-app/src/components/map/DriverUI.js`: legado/fallback de mapa ainda presente.
- `mobile-app/src/screens/MapScreen.js` e `mobile-app/src/screens/NewMapScreen.js`: fallback de navegação ainda registrado.
- `leaf-websocket-backend/server.vps.js`: rollback runtime antigo; só remover após janela estável do modular em canary/release.
- Bridges e imports de Realtime Database em suporte, promoções, referral e subscriptions: exigem decisão/migração de dados.
- `PaymentBypassService`, `DatabaseBypass`, `TestUserService` e ferramentas similares: devem ser isoladas como QA-only antes de qualquer remoção.

## Baixo Risco - Candidatos Para Primeiros Blocos

- Screenshots soltos na raiz e em `mobile-app/*.png` que não fazem parte de assets do app.
- Artefatos locais e temporários em `reports/`, `test-results/` e pastas de QA antigas, respeitando o que estiver versionado.
- `.do/app.yaml` e scripts/documentos de DigitalOcean se não forem mais usados.
- Scripts de infra antiga com Hostinger/Vultr/sslip, depois de confirmar que nenhum runbook atual depende deles.
- `landing-page/assets/referencia-files`, se forem somente referências copiadas e não parte da landing publicada.
- `web-app`, se permanecer fora dos workspaces ativos e sem referência operacional.

## Perigoso - Migrar Antes De Remover

- `prototypeRideRuntime.js`: arquivo vivo, mas grande demais. Deve ser quebrado por domínio.
- `WebSocketManager.js`: vivo; precisa extração incremental, não remoção.
- `routes/dashboard.js`: vivo; dividir rotas por domínio antes de limpar.
- `services/kyc-service`: confirmar supersedência pelo `face-compare-service` antes de remover.
- Wallet/BaaS/subscription antigas: remover somente depois de confirmar ausência em navegação, dashboard, backend financeiro e regras de motorista.
- Imports de `common-local`: remover apenas por migração para serviços canônicos.

## Regra De Execucao

1. Um bloco por commit.
2. Antes de remover arquivo: provar que não há import/runtime ativo.
3. Se for artifact não versionado: pode remover localmente, mas registrar no relatório.
4. Se for arquivo versionado: remover só com teste/check mínimo.
5. Se tocar mobile runtime: rodar pelo menos Jest alvo e `expo config --json`.
6. Se tocar backend: rodar unit/smoke do domínio afetado.
7. Se tocar dashboard: rodar lint/build do dashboard.

## Checks Base

- `git status --short`
- `rg` para imports/referências antes de remover.
- `npm run test:backend` ou teste unitário específico quando backend mudar.
- `npm run test:mobile -- --runInBand` ou teste alvo quando mobile mudar.
- `npm run lint:dashboard` e `npm run build:dashboard` quando dashboard mudar.
- `cd mobile-app && npx expo config --json` quando config/runtime mobile mudar.

## Bloco 1 - Executado

Escopo: limpeza sem impacto runtime.

- Removidos screenshots soltos não versionados na raiz e em `mobile-app/`.
- Removidos `.DS_Store` locais.
- Removidos caches Python não versionados fora da `.venv` em `services/face-compare-service`.
- Removidos `.pyc` versionados de `services/kyc-service`.
- Removidos arquivos mobile órfãos sem referência ativa:
  - `mobile-app/src/screens/UserTypeSelectionScreen.js`
  - `mobile-app/src/screens/WaitListScreen.js`
  - `mobile-app/src/screens/LanguageSettingsScreen.js`
  - `mobile-app/src/screens/WooviDriverBalanceScreen.js`
  - `mobile-app/src/components/map/DriverClusterMarker.js`
  - `mobile-app/src/components/map/DriverMarkerWithRadar.js`
  - `mobile-app/src/components/map/HeatmapOverlay.js`
  - `mobile-app/src/utils/WebSocketTester.js`
  - `mobile-app/src/utils/testSecureStorage.js`
  - `mobile-app/src/utils/testProfileSelection.js`

Validação:

- `rg` sem referências remanescentes para os arquivos órfãos removidos.
- `npm --prefix mobile-app run qa:production-guards`: PASS.
- `cd mobile-app && npx expo config --json`: PASS.
- `cd mobile-app && npx jest --config jest.config.js --runInBand --runTestsByPath __tests__/prototype-ride-screens.test.js`: PASS, 27 testes.
- `cd services/face-compare-service && .venv/bin/python -m pytest tests -q`: PASS, 11 testes.

## Bloco 2 - Executado

Escopo: remover KYC Node experimental sem uso runtime.

- Removido `services/kyc-microservice/src/api.js`.
- Removida excecao correspondente do scanner de secrets.
- Atualizado o devkit para apontar o fluxo atual para `leaf-websocket-backend/routes/kyc-routes.js` e `services/face-compare-service`.

Validação:

- `rg` confirmou que `services/kyc-microservice` nao tinha referencia runtime.
- `node -c scripts/maintenance/security/scan-secrets.cjs`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs`: executou, mas falhou por artefatos sensiveis locais preexistentes (`.env`, keystores, Firebase json e afins). Nao foi corrigido neste bloco para nao quebrar ambiente/build; tratar em bloco proprio de seguranca.

## Bloco 3 - Executado

Escopo: remover scripts historicos de deploy/manutencao que nao fazem parte do fluxo Contabo atual e eram sinalizados pelo scanner por CORS aberto.

- Removidos scripts antigos de Hostinger/self-hosted/147.182:
  - `scripts/maintenance/deploy/add-trip-tracking-apis.sh`
  - `scripts/maintenance/deploy/deploy-to-hostinger.sh`
  - `scripts/maintenance/deploy/setup-hostinger-leaf.sh`
  - `scripts/maintenance/deploy/setup-self-hosted.sh`
  - `scripts/maintenance/deploy/test-simple-apis.sh`
  - `scripts/maintenance/server.js`

Validação:

- `rg` confirmou que esses scripts nao eram chamados por package scripts ou runtime.
- `node -c scripts/maintenance/security/scan-secrets.cjs`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs`: reduziu de 38 para 32 achados; os CORS wildcard desses scripts sairam. Achados restantes sao artefatos sensiveis locais, validacao Woovi/webhook e bypasses de QA/prelaunch que exigem bloco separado.

## Bloco 4 - Executado Localmente

Escopo: remover artefato local ignorado e inativo.

- Removido `web-app/`, que tinha apenas `web-app/.env` local e nenhum arquivo rastreado.
- `web-app` ja constava como fora dos workspaces ativos desde o plano de migracao de 2026-05-16.

Validação:

- `git ls-files web-app`: nenhum arquivo rastreado.
- `find web-app`: diretorio ausente apos limpeza.

## Bloco 5 - Executado

Escopo: reduzir falso positivo local do scanner de segredos sem esconder arquivos de runtime.

- Atualizado `scripts/maintenance/security/scan-secrets.cjs` para ignorar caches Python e `.venv`.
- Mantidos `node_modules`, build outputs e demais caches ja ignorados.
- Nenhum `.env`, keystore, plist, json de Firebase ou credencial ativa foi removido neste bloco.

Validação:

- `node -c scripts/maintenance/security/scan-secrets.cjs`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs`: reduziu de 31 para 29 achados. Os achados restantes continuam sendo artefatos sensiveis locais e bypasses/validadores que exigem bloco proprio, sem delecao cega para nao quebrar builds ou ambiente.

## Bloco 6 - Executado Localmente

Escopo: remover backups locais de `.env` que nao sao rastreados nem carregados pelo runtime.

- Removidos:
  - `leaf-websocket-backend/.env.backup.20251218_083038`
  - `leaf-websocket-backend/.env.production.sandbox.backup-20260529T153415Z`
- Mantidos `.env` ativos, keystores, plist/json de Firebase e credenciais necessarias para builds locais.

Validação:

- `git ls-files` confirmou que os backups removidos nao eram versionados.
- `git check-ignore -v` confirmou que eram arquivos locais ignorados por `.env.*`.
- `node scripts/maintenance/security/scan-secrets.cjs`: reduziu de 29 para 27 achados. Os achados restantes sao sensiveis ativos ou itens que precisam de migracao/isolamento antes de remover.
