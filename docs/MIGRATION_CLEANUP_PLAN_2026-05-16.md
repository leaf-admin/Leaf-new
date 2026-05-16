# Migration And Cleanup Plan - 2026-05-16

## Objetivo

Reduzir legado e ruído sem quebrar a build aprovada, preservando rollback e criando uma base legível para novos colaboradores.

## Fase 0 - Freeze

- Manter checkpoint local atual: `checkpoint/pre-cleanup-20260516-current-state`.
- Criar um manifesto específico da build aprovada quando o artefato exato da build 22 for confirmado.
- Não usar `AppConfig` local como prova da build aprovada, porque ele já avançou para build futura.

## Fase 1 - Limpeza segura

Executado nesta branch:

- Remover `mobile-app/src/deprecated`.
- Remover `leaf-websocket-backend/deprecated`.
- Remover apps/configs paralelos não usados.
- Remover rotas backend não registradas no runtime ativo.
- Remover `web-app` e `deploy-package`.
- Arquivar docs e notas históricas.
- Manter fluxos Maestro como teste rastreável e remover apenas resultados antigos.
- Corrigir scripts locais de start/restart para os workspaces ativos.
- Remover scripts de deploy de produção em manutenção que ainda dependiam de `web-app`, `functions` e `leaf-dashboard`.

## Fase 2 - Fonte da verdade

- Usar Linear como backlog oficial.
- Manter `README.md` e `docs/README.md` como porta de entrada.
- Consolidar docs por domínio: setup, release, arquitetura, validação, operação.
- Qualquer novo relatório temporário deve ir para `reports/` ignorado ou para uma issue Linear, não para o topo do repo.

## Fase 3 - Migração do legado vivo mobile

Não apagar `common-local` diretamente. Estratégia:

1. Criar serviços canônicos em `mobile-app/src/services` para sessão, perfil, corrida, motorista, pagamento e localização.
2. Migrar bridges em `mobile-app/src/services/runtime` para esses serviços.
3. Migrar `prototypeRideRuntime` por fatias pequenas.
4. Reduzir imports de `src/common-local` até zero.
5. Só então remover actions/reducers/helpers legados.

Critério de progresso: cada PR deve reduzir ou manter estável o número de imports de `common-local`.

## Fase 4 - Backend e deploy

1. Confirmar se produção deve continuar em `server.vps.js` ou migrar para `server.js`.
2. Se migrar, fazer staging com `LEAF_SERVER_RUNTIME=modular`.
3. Comparar rotas registradas em `server.vps.js` e `bootstrap/register-http-routes.js`.
4. Consolidar Docker/PM2/Nginx em uma matriz canônica.
5. Só depois remover variantes antigas de Docker e scripts de manutenção.

Status desta branch: scripts locais de start/restart foram corrigidos; deploy de produção ainda deve usar o caminho canônico do backend antes de remover outras variantes.

## Fase 5 - Validação por PR

Mínimo para qualquer limpeza que toque runtime:

- `npm run test:profile`
- `npm run lint:dashboard`
- `npm run build:dashboard`
- `npm run test:mobile`
- `npm run test:backend`
- `npm run test:route-guards --workspace leaf-websocket-backend`
- `cd mobile-app && npx expo config --json`

Validação pesada para release:

- `npm run test:all`
- `npm run prelaunch:audit`
- Maestro em simulador/emulador para login, mapa, perfil, exclusão de conta e corrida.

## Regras de corte

- Sem import ativo: pode remover.
- Import ativo mas só por docs: arquivar docs ou atualizar texto.
- Import ativo em runtime: migrar antes de remover.
- Arquivo de deploy: manter até confirmar produção real.
- Artefato gerado: ignorar ou remover do Git.
