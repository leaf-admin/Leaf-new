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

## Bloco 7 - Executado

Escopo: remover ruidos falsos do scanner sem enfraquecer achados reais.

- Adicionada allowlist por arquivo+regra para strings diagnosticas em:
  - `leaf-websocket-backend/scripts/deploy/validate-runtime-config.js`
  - `leaf-websocket-backend/routes/health.js`
  - scripts QA/prelaunch que rodam fluxos isolados.
- A allowlist nao libera padroes de forma global; vale somente para o arquivo e regra especificos.
- O scanner agora fica focado nos artefatos sensiveis locais restantes.

Validação:

- `node -c scripts/maintenance/security/scan-secrets.cjs`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs`: reduziu de 27 para 19 achados, todos critical e ligados a `.env`, keystores, Firebase config/plist/json ou chave privada local.

## Bloco 8 - Executado

Escopo: registrar caminho seguro para segredos locais ativos.

- Criado `docs/SECURITY_LOCAL_SECRETS_RUNBOOK_2026-05-29.md`.
- Confirmado que `node scripts/maintenance/security/scan-secrets.cjs --tracked-only` passa sem achados.
- Os 19 achados restantes do scanner completo sao locais e ignorados pelo git, mas continuam dentro do workspace porque podem ser necessarios para builds e canary.

Validação:

- `git ls-files` nao lista os segredos/artefatos locais sensiveis.
- `.gitignore` cobre `.env`, `.env.*`, Firebase config, plist, keystores e chaves.
- Nenhuma credencial real foi movida, exibida ou alterada neste bloco.

## Bloco 9 - Executado

Escopo: criar exemplo versionado para materializar segredos fora do repo.

- Criado `scripts/local/materialize-secrets.example.sh`.
- O script nao contem valores reais e espera `LEAF_SECRETS_ROOT` fora do workspace.
- Atualizado o runbook para apontar o exemplo.

Validação:

- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `git diff --check`: PASS.

## Bloco 10 - Executado

Escopo: remover scripts historicos de infra fora do caminho Contabo/modular atual.

- Removidos scripts antigos de Hostinger/Vultr/migracao:
  - `scripts/maintenance/hostinger/setup-hostinger-fallback.sh`
  - `scripts/maintenance/migration/migrate-to-vultr.sh`
  - `scripts/maintenance/vultr/install-vultr.sh`
  - `scripts/maintenance/vultr/nginx-leaf-app.conf`
  - `scripts/maintenance/vultr/setup-vultr-completo.sh`
  - `scripts/maintenance/vultr/setup-vultr-economico.sh`
  - `scripts/maintenance/vultr/setup-vultr-primary.sh`
  - `scripts/maintenance/tests/test-vps-differences.cjs`
- Mantido `leaf-websocket-backend/docker-compose.hostinger.yml` porque ainda e o compose operacional/canonico apesar do nome legado.

Validação:

- `rg` sem chamadas ativas para os scripts removidos fora de docs historicos/tracker.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.

## Bloco 11 - Executado

Escopo: remover pacote de deploy Vultr que se referenciava apenas internamente.

- Removidos:
  - `leaf-websocket-backend/docs/README-VULTR-DEPLOY.md`
  - `leaf-websocket-backend/scripts/deploy/deploy-rapido-vultr.sh`
  - `leaf-websocket-backend/scripts/deploy/deploy-to-vultr.sh`
  - `leaf-websocket-backend/scripts/deploy/fix-dpkg-and-deploy.sh`
  - `leaf-websocket-backend/scripts/deploy/migrate-ips-to-vultr.sh`
  - `leaf-websocket-backend/scripts/deploy/setup-vultr.sh`
  - `leaf-websocket-backend/scripts/deploy/test-ip-migration.sh`
  - `leaf-websocket-backend/scripts/deploy/test-vultr-performance.sh`

Validação:

- `rg` confirmou que as referencias remanescentes eram internas ao pacote removido.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.

## Bloco 12 - Executado

Escopo: remover manifest DigitalOcean App Platform que nao pertence ao deploy Contabo atual.

- Removido `.do/app.yaml`.
- Removida a entrada explicita de `.do/app.yaml` do scanner de secrets.
- O arquivo estava em sandbox, apontava `run_command: node server.js` e nao refletia o deploy modular/Contabo atual.

Validação:

- `git ls-files .do/app.yaml`: confirmava que era versionado antes da remocao.
- `node -c scripts/maintenance/security/scan-secrets.cjs`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.

## Bloco 13 - Executado

Escopo: alinhar documentacao tecnica principal com runtime modular e dominios canonicos.

- Atualizado `docs/DEVKIT_TECNICO_LEAF_2026-05-23.md`:
  - E2E remoto agora aponta para `api.leaf.app.br` e `socket.leaf.app.br` por padrao.
  - SSH remoto deve ser definido via env dos scripts operacionais.
  - Runtime atual documentado como `server.js` modular.
  - `server.vps.js` documentado apenas como rollback legado temporario.
  - `docker-compose.hostinger.yml` mantido como compose atual com nome legado.

Validação:

- `rg` confirmou `LEAF_SERVER_RUNTIME=modular` no compose ativo.
- `git diff --check`: PASS.

## Bloco 14 - Executado

Escopo: remover configs Vultr restantes sem uso.

- Removidos:
  - `leaf-websocket-backend/config/docker/docker-compose-vultr-8gb.yml`
  - `leaf-websocket-backend/config/nginx/nginx-vultr.conf`
- Esses arquivos se referenciavam apenas entre si apos a remocao dos scripts Vultr.

Validação:

- `rg` sem referencias remanescentes para `docker-compose-vultr-8gb` e `nginx-vultr` fora do tracker.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: PASS.

## Bloco 15 - Executado

Escopo: remover laboratorio historico de testes/manutencao fora das suites canonicas.

- Removidos `scripts/maintenance/testing/` e `scripts/maintenance/tests/`.
- Removido `scripts/maintenance/deploy/deploy-baas-system.sh`.
- Removido `docs/architecture/mobile/BAAS_IMPLEMENTATION_GUIDE.md`, guia isolado do modelo BaaS antigo.
- Esses arquivos eram experimentais/historicos de Woovi, BaaS, self-hosted e websocket, sem chamada por `package.json` raiz ou scripts canonicos.
- Testes vivos permanecem em:
  - `leaf-websocket-backend/scripts/tests/`
  - `mobile-app/__tests__/`
  - `scripts/prelaunch/`
  - `scripts/validation/`

Validação:

- `rg` confirmou ausencia de referencias ativas fora de docs historicos/legados.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.

## Bloco 16 - Executado

Escopo: remover pacote Docker/HA/autoscale antigo do backend.

- Removidos scripts antigos em `leaf-websocket-backend/scripts/deploy/` que gerenciavam Docker manual, autoscale, cluster local, KYC solto, FCM manual e deploys one-off.
- Removidos configs antigos:
  - `leaf-websocket-backend/config/docker/docker-compose-autoscaling.yml`
  - `leaf-websocket-backend/config/docker/docker-compose-ha.yml`
  - `leaf-websocket-backend/config/docker/docker-compose-simple-scaling.yml`
  - `leaf-websocket-backend/config/nginx/nginx-ha.conf`
- Removidos docs/runbooks correspondentes de Docker HA/autoscale.
- Removido `leaf-websocket-backend/scripts/utils/auto-scaler.js` e o teste local HA correspondente.
- Mantidos os scripts vivos/canonicos:
  - `leaf-websocket-backend/scripts/deploy/validate-runtime-config.js`
  - `leaf-websocket-backend/scripts/deploy/deploy-secondary-realtime-host.sh`
  - `leaf-websocket-backend/scripts/deploy-hostinger-docker.sh` por compatibilidade operacional atual.

Validação:

- `rg` usado para confirmar ausencia de chamada por `package.json`, workflows e scripts canonicos.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: PASS.

## Bloco 17 - Executado

Escopo: atualizar scripts vivos de QA/prelaunch/validation para dominios canonicos Leaf e remover defaults antigos de VPS.

- Scripts de prelaunch, validation e QA mobile agora usam `https://api.leaf.app.br` e `https://socket.leaf.app.br` como defaults.
- Removidos defaults hardcoded de hosts antigos `147.182.*` e `62.169.*` nos scripts vivos.
- Removido default local de chave SSH antiga nos fluxos de QA mobile; host/chave remotos agora precisam vir de env (`REMOTE_HOST`, `VPS_HOST`, `REMOTE_SSH_KEY`, `VPS_KEY`, `SSH_KEY_PATH` ou `REMOTE_KEY`).
- Renomeado o caminho remoto de ambiente nos scripts ajustados para `REMOTE_ENV_PATH`.
- Mantida apenas deteccao generica de `sslip.io` onde ela serve para classificar endpoint HTTPS de teste, sem apontar para host antigo.

Validação:

- `node -c` nos scripts JS alterados: PASS.
- `bash -n` nos scripts shell alterados: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `npm --prefix mobile-app run qa:production-guards`: PASS.

## Bloco 18 - Executado

Escopo: alinhar borda backend ativa aos dominios Leaf.

- Atualizado `docker-compose.hostinger.yml` para usar `https://api.leaf.app.br` e `https://api.leaf.app.br/api/woovi/webhook` como defaults.
- Atualizado `docker-compose.realtime-secondary.yml` com os mesmos defaults canonicos.
- Atualizado `nginx.conf`, montado pelo compose ativo, para servir HTTP/HTTPS em `api.leaf.app.br`, `socket.leaf.app.br` e `dashboard.leaf.app.br`.
- Removidos nomes/certificados `sslip.io` da configuracao `nginx.multi-gateway.conf` usada pelo compose de gateway escalado.

Validação:

- Parser YAML local nos composes alterados: PASS.
- Checagem de balanceamento de blocos Nginx nos arquivos alterados: PASS.
- `git diff --check`: PASS.

## Bloco 19 - Executado

Escopo: remover excecoes nativas mobile para IP antigo.

- Removida excecao ATS hardcoded para `62.169.31.231` do plugin de Google Maps iOS.
- Removido `62.169.31.231` da lista default de HTTP liberado no Android.
- `EXPO_PUBLIC_INSECURE_HTTP_HOSTS` segue disponivel como override explicito quando algum teste local precisar de cleartext.

Validação:

- `node -c` nos plugins alterados: PASS.
- `npx expo config --json`: PASS.
- `npm --prefix mobile-app run qa:production-guards`: PASS.

## Bloco 20 - Executado

Escopo: remover fallbacks antigos de runtime backend para IPs legados.

- `load-ngrok-url.js` passa a usar `https://api.leaf.app.br` como fallback de producao para webhook Woovi.
- `kyc-vps-client.js` nao tenta mais chamar a VPS antiga quando `BIOMETRIC_FACE_SERVICE_URL`/`KYC_VPS_URL` nao estiverem configurados; o erro agora e fail-closed.
- `runtime-cors-origins.js`, `runtime-cors-config.js` e `routes/waitlist.js` deixam de liberar `sslip.io`/IP antigo por default.
- Hosts temporarios de CORS continuam disponiveis apenas via env explicito (`CORS_RUNTIME_HOSTS`/`RUNTIME_CORS_HOSTS`).

Validação:

- `node -c` nos arquivos alterados: PASS.
- Unit tests de runtime CORS: PASS (`10/10`).
- Smoke local do cliente KYC sem env: PASS, retornando provider nao configurado sem fallback de IP.

## Bloco 21 - Executado

Escopo: remover scripts raiz de deploy/monitoramento da VPS antiga.

- Removidos scripts raiz que apontavam diretamente para `147.182.*` e fluxos antigos de deploy/monitoramento.
- Mantido `scripts/healthcheck-vps.sh`, pois ainda e usado pela validacao controlada, mas com default atualizado para `https://api.leaf.app.br`.
- Atualizado o Devkit para listar apenas os scripts operacionais atuais.

Validação:

- Referencias diretas aos scripts removidos checadas antes da remocao; apenas docs historicos os citavam.
- `bash -n scripts/healthcheck-vps.sh`: PASS.

## Bloco 22 - Executado

Escopo: remover pacote antigo de configs Docker/Nginx fora do runtime atual.

- Removidos `leaf-websocket-backend/config/docker/` e `leaf-websocket-backend/config/nginx/`.
- Removidos `config/nginx/nginx-complete-config.conf` e `config/nginx/nginx-fixed-config.conf`, que nao eram chamados pelos scripts atuais de waitlist.
- Mantidos `config/nginx/nginx-leaf-app-br.conf`, `config/nginx/nginx-waitlist-secure.conf` e o README de waitlist.
- Removidos docs antigos de organizacao que descreviam essa estrutura removida.

Validação:

- `rg` confirmou que os arquivos removidos eram chamados apenas por configs/docs antigas do mesmo pacote.
- Configs de waitlist e compose ativo preservados.

## Bloco 23 - Executado

Escopo: alinhar scripts operacionais ativos com Contabo, runtime modular e dominios Leaf.

- Removidos defaults para IPs antigos, `sslip.io` e `digitaloceankey` dos scripts atuais de deploy/canary/rollout.
- Scripts de deploy agora exigem host/chave explicitos via `VPS_IP`/`CONTABO_HOST` e `VPS_SSH_KEY`/`SSH_KEY_PATH`/`CONTABO_KEY`.
- `check-vps-runtime-parity.sh` passa a assumir `RUNTIME_MODE=modular` por default.
- Deploy/canary de dashboard e realtime passam a publicar defaults para `https://api.leaf.app.br`, `https://socket.leaf.app.br` e `https://dashboard.leaf.app.br`.
- Emissao Let's Encrypt da Contabo passa a usar apenas os dominios Leaf canonicos.

Validação:

- `bash -n` nos scripts shell alterados: PASS.
- `rg` direcionado nos scripts alterados confirmou ausencia de `147.182`, `62.169`, `digitaloceankey` e `sslip.io`: PASS.
- `git diff --check`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: PASS.

## Bloco 24 - Executado

Escopo: remover scripts de manutencao mortos da stack Vultr/white-label.

- Removidos `scripts/maintenance/deploy/` e `scripts/maintenance/deployment/`, substituidos pelos scripts canonicos em `leaf-websocket-backend/scripts/`.
- Removidos scripts antigos de disaster recovery/load balancer baseados em IP fixo.
- Removidos monolitos auxiliares `server-complete*.js` e checks/metricas que apontavam para VPS antiga.
- Removido setup antigo de backup VPS; scripts locais de Redis backup foram preservados.
- Atualizado `scripts/maintenance/README.md` para refletir apenas os grupos ainda mantidos.

Validação:

- `rg` previo confirmou que as referencias vivas eram apenas docs historicos/guardrails.

## Bloco 25 - Executado

Escopo: remover utilitarios legados soltos e atualizar defaults operacionais mantidos.

- Removidos scripts antigos de KYC VPS mockado, junto dos quick starts que chamavam esses scripts.
- Removidos utilitarios mobile soltos que instalavam APK/testavam FCM contra VPS antiga.
- Removido `update-woovi-webhook-vps.js`, mantendo `fix-woovi-webhook.js` como script unico para webhook Woovi.
- Removido `utils/vps-metrics.js`, nao referenciado pelo runtime atual.
- Atualizados defaults mantidos de alerta, notificacao, load test e Woovi para `api.leaf.app.br`/`socket.leaf.app.br`.

Validação:

- `node -c` nos scripts JS alterados: PASS.
- `bash -n` no lembrete de alertas alterado: PASS.

## Bloco 26 - Executado

Escopo: alinhar scripts de teste/E2E aos dominios Leaf.

- Atualizados defaults de `api.62.169.*.sslip.io` e `socket.62.169.*.sslip.io` para `api.leaf.app.br` e `socket.leaf.app.br`.
- Atualizados testes ad hoc que ainda apontavam para `147.182.*`.
- Removida deteccao especifica de `sslip.io` nos helpers E2E; ambiente remoto agora e inferido por URL HTTPS ou host nao-local.
- `test-redis-connection.js` nao tenta mais abrir Redis em IP antigo; Redis remoto exige `REMOTE_REDIS_HOST` explicito.
- Mantida a capacidade generica de `runtime-cors-origins.js` montar dominios `sslip.io` apenas quando um host e passado explicitamente para teste.

Validação:

- `node -c` em todos os JS/CJS alterados nesse bloco: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.

## Bloco 27 - Executado

Escopo: remover artefatos de teste gerados e ultimo status mobile legado.

- Removidos relatórios JSON antigos `stress-test-e2e-rides-*.json` que estavam rastreados no backend.
- Removido `mobile-app/test-status-atual.cjs`, que ainda apontava para a VPS Vultr antiga e duplicava checks ja cobertos pelos scripts atuais.
- Atualizado teste unitário mobile de WebSocket para usar `socket.leaf.app.br` no cenário de Origin nativo.

Validação:

- `node -c mobile-app/__tests__/websocket-manager-auth.test.js`: PASS.
- `npx jest --config jest.config.js __tests__/websocket-manager-auth.test.js --runInBand`: PASS (`13/13`; Jest manteve o aviso conhecido de open handle apos finalizar).

## Bloco 28 - Executado

Escopo: eliminar ultimas referencias executaveis antigas fora dos docs historicos.

- Removido `leaf-websocket-backend/ssl-config.js`, sem referencias no runtime atual e ainda contendo SAN de IP antigo.
- Removidas deteccoes especificas de `sslip.io` em scripts de prelaunch/perfil de teste; URL HTTPS ja cobre ambiente remoto.

Validação:

- Varredura sem docs historicos passou a apontar apenas para suporte generico `sslip.io` de CORS e testes unitarios dessa funcao.
- `node -c` nos scripts alterados: PASS.

## Bloco 29 - Executado

Escopo: alinhar documentacao operacional ativa aos dominios Leaf e ao runtime Contabo atual.

- Atualizados runbooks ativos de teste, cutover, soft release, capacidade, segundo host realtime, Play Console e KYC dedicado.
- Removidas instrucoes operacionais que ainda mandavam usar `sslip.io`, IP direto da VPS ou chave `digitaloceankey`.
- Mantidos arquivos historicos como evidencia; eles devem ficar separados do caminho operacional atual.

Validação:

- Varredura final de documentacao ativa sem referencias antigas a IP direto, `sslip.io`, `digitaloceankey` ou provedores antigos: PASS.
- `node -c scripts/prelaunch/assert-store-go-static.cjs`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `git diff --check`: PASS.

## Bloco 30 - Executado

Escopo: arquivar relatorios historicos que citavam provedores antigos, IP direto ou `sslip.io`.

- Criado `docs/archive/legacy-infra-2026-05-29/`.
- Movidos relatorios antigos de mobile, backend e arquitetura para o arquivo historico.
- Atualizados links que ainda apontavam para esses relatorios em docs ativos.
- Mantidos os arquivos como evidencia, mas fora da trilha operacional atual.

Validação:

- Varredura final de documentacao ativa sem referencias antigas a IP direto, `sslip.io`, `digitaloceankey` ou provedores antigos: PASS.
- `node scripts/prelaunch/assert-store-go-static.cjs`: PASS com warnings historicos conhecidos e `Failures: 0`.
- `git diff --check`: PASS.

## Bloco 31 - Executado Localmente

Escopo: limpar artefatos ignorados e preservar evidencias operacionais.

- Inventario antes da limpeza:
  - `reports`: `1.6G`
  - `mobile-app/.maestro/results`: `1.0G`
  - `leaf-websocket-backend/reports`: `16M`
  - `test-results`: `352K`
  - `services/face-compare-service/.venv`: `650M`
  - `vehicle-image-bank`: `1.2G`
- Removidos somente arquivos ignorados e nao versionados:
  - `mobile-app/.maestro/results/`
  - `reports/build-ios-sim-release.log`
  - zips duplicados de onboarding em `reports/`
  - logs grandes `metro.log` de rodadas antigas `mobile-only-rider-driver-4ios_20260521_*`
- Preservados:
  - `test-results/` versionado
  - `leaf-websocket-backend/reports/`
  - `vehicle-image-bank/`
  - `.venv` do `face-compare-service`

Validação:

- `git ls-files` confirmou que os artefatos removidos nao eram versionados.
- Inventario apos limpeza:
  - `reports`: `1.5G`
  - `leaf-websocket-backend/reports`: `16M`
  - `test-results`: `352K`
  - `services/face-compare-service/.venv`: `650M`
  - `vehicle-image-bank`: `1.2G`
- `git status --short`: limpo antes do registro deste bloco.

## Bloco 32 - Executado

Escopo: criar aliases canonicos para nomes legados vivos sem quebrar compatibilidade.

- Criados aliases de compose:
  - `leaf-websocket-backend/docker-compose.contabo.yml`
  - `leaf-websocket-backend/docker-compose.production.yml`
- Os aliases apontam para `docker-compose.hostinger.yml`, que segue sendo o compose operacional por compatibilidade.
- Criados wrappers de deploy:
  - `leaf-websocket-backend/scripts/deploy-contabo-docker.sh`
  - `scripts/deploy-contabo-completo.sh`
- Os wrappers chamam o script legado compatível `deploy-hostinger-docker.sh`.
- `server.vps.js` permanece preservado como rollback deprecated, sem renome nesta etapa.

Validação:

- `bash -n leaf-websocket-backend/scripts/deploy-contabo-docker.sh scripts/deploy-contabo-completo.sh`: PASS.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: PASS.
- `node` confirmou que os aliases de compose sao symlinks para `docker-compose.hostinger.yml` e que o alvo existe.
- `git diff --check`: PASS.
- `docker compose -f docker-compose.contabo.yml config --services`: nao executado porque `docker` nao esta disponivel neste shell.

## Bloco 33 - Executado

Escopo: reforcar guardrail de bypass de pagamento no mobile.

- `allowForcedPaymentBypass` agora exige:
  - flag explicita de ferramentas de teste (`allowTestUserTools()`)
  - flag explicita de bypass de pagamento (`hasExplicitPaymentBypassFlag()`)
- A mudanca mantem ferramentas QA disponiveis quando as duas flags estao ligadas em ambiente permitido.
- Adicionado teste unitario da politica de runtime.
- Atualizado production guard para travar regressao nesta regra.

Validação:

- `npm --prefix mobile-app run qa:production-guards`: PASS.
- `cd mobile-app && npx jest --config jest.config.js --runInBand --runTestsByPath __tests__/runtime-access-policy.test.js __tests__/woovi-payment-modal.test.js`: PASS (`3/3`).
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `git diff --check`: PASS.

## Bloco 34 - Executado

Escopo: reduzir acoplamento direto do mobile ao legado vivo `common-local`, sem remover fallback ou rotas compatíveis.

- Criados bridges runtime canonicos para consumidores ainda acoplados diretamente:
  - `services/runtime/localizationBridge.js`
  - `services/runtime/typographyBridge.js`
  - `services/runtime/authTypesBridge.js`
  - `services/runtime/firebaseConfigBridge.js`
  - `services/runtime/locationActionsBridge.js`
- Migrados imports diretos de telas, hooks, navegacao, componentes e utils para os bridges acima.
- Removido import morto de Firebase em `AuthService`, que ja usa `@react-native-firebase/auth` diretamente.
- Corrigido caminho quebrado `common-local/src/actions/locationactions` em hooks de tracking/historico, apontando para bridge runtime.
- Mantidos vivos e intocados:
  - `common-local`
  - `state/appStore.js`
  - `theme/runtimeTokens.js`
  - bridges runtime existentes
  - `PassengerUI`, `DriverUI`, `NewMapScreen`
  - aliases `MapScreen` e `TabRoot`

Evidencia:

- `rg` dos imports diretos sensiveis agora retorna apenas os novos bridges runtime.
- `npm --prefix mobile-app run qa:production-guards`: PASS.
- `cd mobile-app && npx jest --config jest.config.js --runInBand --runTestsByPath __tests__/prototype-ride-screens.test.js __tests__/auth-provider-startup.test.js`: PASS (`30/30`; warnings conhecidos de `Animated act(...)` no teste visual).
- `cd mobile-app && npx expo config --json`: PASS (`Leaf`).

## Bloco 35 - Executado

Escopo: extrair uma duplicidade pequena do backend grande sem alterar API publica do dashboard.

- Extraido o contrato efetivo de `getPeakHours` para `services/dashboard/reportMetrics.js`.
- Mantida fachada `getPeakHours` em `routes/dashboard.js`, preservando chamadas e formato atual das respostas.
- Removida a declaracao duplicada anterior que era sobrescrita pela segunda declaracao em tempo de execucao.
- Adicionado teste unitario fixando o contrato legado, inclusive o comportamento historico de lista vazia retornar todas as horas empatadas.

Validação:

- `rg "function getPeakHours|const getPeakHours|getPeakHours\\(" leaf-websocket-backend/routes/dashboard.js leaf-websocket-backend/services/dashboard/reportMetrics.js`: PASS, sem duplicidade concorrente no router.
- `node -c leaf-websocket-backend/routes/dashboard.js && node -c leaf-websocket-backend/services/dashboard/reportMetrics.js`: PASS.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: PASS.
- `cd leaf-websocket-backend && npx jest --config config/jest.unit.config.js --runInBand --runTestsByPath tests/unit/services/dashboard-report-metrics.unit.test.js tests/unit/services/dashboard-user-management-service.unit.test.js tests/unit/services/dashboard-ride-monitoring-service.unit.test.js`: PASS (`10/10`).
- `npm --prefix leaf-websocket-backend run config:validate`: BLOCKED por ambiente atual (`WOOVI_WEBHOOK_AUTHORIZATION/WOOVI_WEBHOOK_AUTH_TOKEN` ausente na `.env` carregada para producao); nao foi causado pelo bloco.

## Bloco 36 - Executado

Escopo: desligar superficies financeiras legadas no mobile sem remover arquivos de rollback.

- Rotas antigas de wallet/BaaS/plano semanal continuam registradas como aliases de compatibilidade.
- Essas rotas nao montam mais diretamente telas que chamam BaaS ou `walletCredit`:
  - `DriverBalance`
  - `WeeklyPayment`
  - `WeeklyPaymentScreen`
  - `FreeTrial`
  - `PlanSelection`
  - `AddMoney`
  - `addMoney`
  - `WalletDetails`
  - `AccountStatement`
- `BaaSAccount` e `BaaSAccountScreen` seguem apontando para a tela indisponivel/repasse pelo saldo Leaf.
- Mantidos intactos:
  - ledger financeiro
  - `DriverBalanceService` moderno em `/api/payment`
  - telas/servicos de ganhos, saldo e saque atuais
  - arquivos legados para rollback ate prova final de ausencia de uso.
- Adicionado teste estatico para impedir que o `AppNavigator` volte a montar diretamente telas legadas de wallet/BaaS/plano.

Validação:

- `rg` de imports/componentes legados no `AppNavigator`: PASS sem resultados.
- `npm --prefix mobile-app run qa:production-guards`: PASS.
- `cd mobile-app && npx jest --config jest.config.js --runInBand --runTestsByPath __tests__/legacy-financial-routes.test.js __tests__/driver-balance-service-pilot.test.js __tests__/trip-financial-summary.test.js`: PASS (`11/11`).
