# Perfil Canônico de Execução de Testes (LEAF)

Este documento define o baseline oficial para reduzir flakiness e evitar falso-positivo/falso-negativo entre execuções em dias diferentes.

## 1) Comandos oficiais

Sempre rode testes pelos scripts npm (não use `npx jest` direto):

1. Backend completo: `cd leaf-websocket-backend && npm run test:all`
2. Backend unit+integration: `cd leaf-websocket-backend && npm test`
3. Backend E2E: `cd leaf-websocket-backend && npm run test:e2e`
4. Mobile unit: `cd mobile-app && npm run test:unit`

Todos esses comandos exibem automaticamente este perfil antes da execução.

## 2) Ambiente alvo (hoje)

1. Infra remota principal de E2E/carga: Contabo (shared runtime)
2. Endpoint socket padrão: `https://socket.leaf.app.br`
3. Endpoint API padrão: `https://api.leaf.app.br`
4. Backend local é opcional para unit/integration; E2E padrão usa ambiente remoto compartilhado

## 3) Variáveis críticas

1. `APP_REVIEW=false` para teste funcional normal (evita bypass mascarar erro real)
2. `E2E_RUN_ID` opcional (se ausente, testes geram tag única via `Date.now()`)
3. `E2E_REMOTE_SSH_HOST` apontando para o host Contabo atual, vindo de env/segredo operacional
4. `E2E_REMOTE_SSH_USER=root`
5. `E2E_REMOTE_SSH_KEY_PATH` apontando para chave válida da Contabo
6. `E2E_REMOTE_REDIS_PASSWORD` definido explicitamente no shell/CI
7. `E2E_GENERATE_FIREBASE_TOKEN=true` (padrão recomendado)
8. `E2E_MOCK_PAYMENT=true` somente para cenários de teste que exigem mock controlado

## 4) Por que passa hoje e falha em 1-2 dias?

As causas mais comuns no projeto atual são:

1. Ambiente E2E é remoto e compartilhado: estado concorrente muda entre execuções.
2. Redis remoto pode variar (locks, filas, TTL, limpeza parcial), mudando timing de eventos.
3. Mudança de credencial/chave SSH/segredo Redis gera falhas como `NOAUTH`.
4. `APP_REVIEW`/flags de bypass alteram comportamento de auth e pagamento.
5. Deploy/config no backend remoto muda entre uma rodada e outra sem fixar snapshot.
6. Testes com janelas de tempo curtas sofrem com variação de latência no ambiente remoto.

## 5) Regras de estabilidade

1. Sempre rodar pelos scripts npm com preflight.
2. Não alternar `APP_REVIEW` no meio da bateria.
3. Não misturar execução local e remota no mesmo relatório sem separar contexto.
4. Registrar commit SHA e branch no relatório da rodada.
5. Em falha, repetir com mesmo perfil e `E2E_RUN_ID` novo para evitar colisão de estado.
6. Antes de classificar regressão de código, validar preflight (env + credenciais + endpoints).

## 6) Checklist rápido antes de executar

1. Estou no branch/commit certo?
2. `APP_REVIEW` está `false`?
3. Endpoints apontam para Contabo?
4. Chave SSH e senha Redis remota estão válidas?
5. Vou rodar via `npm run ...` (com preflight) e não via comando avulso?
