# Project State - 2026-05-16

## Checkpoint

- Branch de rollback: `codex/checkpoint-20260516-pre-cleanup-current-state`
- Commit de rollback: `bacbd41`
- Tag de rollback: `checkpoint/pre-cleanup-20260516-current-state`
- Branch de limpeza: `codex/project-cleanup-20260516`

## Fotografia inicial

- Arquivos rastreados: `3312`
- Arquivos rastreados em `docs/`: `396`
- Arquivos rastreados em `mobile-app/`: `1296`
- Arquivos rastreados em `leaf-websocket-backend/`: `1085`
- Arquivos no topo de `docs/`: `367`
- Arquivos no topo de `mobile-app/`: `241`
- Arquivos rastreados em `landing-page/assets/referencia-files`: `119`

Maiores diretórios locais antes da limpeza:

- `mobile-app`: `17G`
- `node_modules`: `8.6G`
- `reports`: `2.0G`
- `leaf-websocket-backend`: `70M`
- `leaf-dashboard-js`: `28M`
- `docs`: `5.7M`
- `landing-page`: `4.3M`

## Runtime atual

- Mobile ativo: `mobile-app/index.js` -> `mobile-app/App.js` -> `mobile-app/src/navigation/AppNavigator.js`.
- UI principal: telas Robotaxi em `mobile-app/src/screens/prototype`.
- Store atual: `mobile-app/src/state/appStore.js`, ainda reexportando store legado de `src/common-local`.
- Backend atual: `leaf-websocket-backend/server.vps.js` em VPS e `leaf-websocket-backend/server.js` como runtime modular.
- Dashboard atual: `leaf-dashboard-js`.
- Landing/legal atual: `landing-page`.

## Legado vivo

- `mobile-app/src/common-local`: actions, reducers, store, helpers e API ainda usados.
- `mobile-app/src/services/runtime`: bridges entre UI Robotaxi e legado.
- `NewMapScreen`, `PassengerUI`, `DriverUI`: fallback de mapa legado quando a UI Robotaxi não é usada.
- `server.vps.js`: produção atual mesmo com duplicação frente ao runtime modular.

## Limpeza executada nesta branch

- Removidos diretórios e arquivos explicitamente deprecated ou sem import runtime.
- `web-app` removido do Git porque não pertence ao workspace ativo.
- Docs históricos movidos para `docs/archive`.
- Resultados Maestro antigos removidos do Git; fluxos Maestro continuam como código de teste.
- `.gitignore` ajustado para não esconder páginas reais do dashboard nem configs/flows Maestro.
- Scripts de manutenção de start/restart alinhados aos workspaces reais.
- Scripts antigos de deploy de produção em `scripts/maintenance/deploy-production.*` removidos porque apontavam para stacks desativadas.

## Fotografia final

- Arquivos rastreados finais: `3334`
- Arquivos rastreados em `docs/`: `505`
- Arquivos rastreados em `mobile-app/`: `1254`
- Arquivos rastreados em `leaf-websocket-backend/`: `1052`
- Arquivos no topo de `docs/`: `6`
- Arquivos no topo de `mobile-app/`: `158`
- Arquivos rastreados em `web-app/`: `0`
- Arquivos rastreados em `deploy-package/`: `0`
- Fluxos Maestro rastreados: `99`

Maiores diretórios locais após a limpeza de Git:

- `mobile-app`: `17G`
- `node_modules`: `8.6G`
- `reports`: `2.0G`
- `leaf-websocket-backend`: `74M`
- `leaf-dashboard-js`: `28M`
- `docs`: `6.5M`
- `landing-page`: `4.3M`

Observacao: os tamanhos grandes restantes são artefatos locais/ignorados, principalmente builds e resultados; eles não fazem parte do pacote rastreado para novos colaboradores.

## Ainda não removido de propósito

- `mobile-app/src/common-local`: remover direto quebra o runtime.
- `landing-page/assets/referencia-files`: algumas páginas HTML ainda usam os CSS/assets.
- `server.vps.js`: produção atual.
- `scripts/maintenance` e variantes Docker: parte foi corrigida/removida, mas ainda exige confirmação do deploy real antes de corte completo.
- `services/kyc-service`: possível componente de KYC externo; precisa decisão arquitetural.
