# Plano de limpeza arquitetural Leaf - 2026-05-24

## Objetivo

Deixar o projeto mais previsivel para crescer sem transformar cada ajuste em risco de regressao. O foco e reduzir ambiguidade de runtime, consolidar contratos criticos e transformar legado vivo em decisao explicita.

## Estado atual resumido

- Producao backend ainda depende do runtime VPS em `leaf-websocket-backend/server.vps.js`.
- Backend modular em `leaf-websocket-backend/server.js` ja existe, mas ainda nao e a fonte unica de deploy.
- Mobile novo roda pelo fluxo Robotaxi/Leaf, mas `prototypeRideRuntime.js` ainda concentra corrida, socket, mapa, pagamentos, persistencia, chat, notificacoes e onboarding.
- Fluxo financeiro tem bons servicos de ledger e settlement, mas ainda convive com caminhos legados de pagamento, BaaS/subaccount e bypass de QA.
- Dashboard ja tem centro de campanhas, suporte e observabilidade, mas ainda precisa alinhar websocket, RBAC/audit trail e relatorios operacionais.

## Trilhas de execucao

### P0 - Guardrails de producao

1. Bloquear flags legadas sensiveis em producao.
2. Exigir Socket.IO Redis Adapter para runtime `gateway` em producao.
3. Expor estado do Socket.IO Redis Adapter no health/readiness.
4. Manter payment bypass, dashboard mocks e confirmacao manual fora da producao.

Status nesta rodada:

- `validate-runtime-config.js` passou a diagnosticar adapter websocket e flags legadas.
- Health/readiness passa a expor e considerar `socketRedisAdapter`.

### P1 - Contratos canonicos

1. Criar contrato mobile puro para `backend status -> runtime status -> UI phase`.
2. Criar contrato financeiro unico para pagamento, holding, corrida, split, pedagio, taxa Leaf, saldo e saque.
3. Criar matriz `server.vps.js` vs `server.js` antes de cortar runtime.

Status nesta rodada:

- Mobile recebeu `rideLifecycleContract.js`.
- `runtimeCrashRecovery.js` passou a usar o contrato para nao manter/sincronizar corrida terminal como ativa.
- Backend recebeu `ride-financial-contract.js` para explicitar pagamento do passageiro, corrida sem pedagio, pedagio passthrough, taxa Leaf, custo de pagamento, liquido do motorista e retencoes.
- `PaymentService.calculateNetAmount` passou a usar o contrato financeiro canonico, preservando as faixas vigentes e evitando settlement desbalanceado em valores anomalos muito baixos.

### P2 - Reducao de superficie legada

1. Classificar cada legado como `ativo`, `compatibilidade`, `qa`, `remover`.
2. Quarentenar `PassengerUI`, `DriverUI`, `PaymentBypassService`, `DatabaseBypass`, BaaS e MEI.
3. Remover apenas depois de teste e canary.

Status nesta rodada:

- `validate-release-runtime-policy.cjs` valida os profiles `release-test`, `production`, `production-apk` e `production-review` do mobile.
- `production-guard-asserts.sh` passou a executar esse validador e tambem confere se `PaymentBypassService` e `DatabaseBypass` continuam presos ao `runtimeAccessPolicy`.
- `DatabaseBypass` ficou classificado como legado de QA sem uso ativo encontrado fora do proprio arquivo; proximo passo seguro e remover em canary separado.
- `PaymentBypassService` ainda aparece em fluxos legados/prototype, mas fica bloqueado por flags explicitas e ferramentas de teste.

### P3 - Modularizacao progressiva

1. Extrair do `prototypeRideRuntime.js` por dominio, sem mudar comportamento:
   - lifecycle e estado;
   - socket/reconnect;
   - pagamento/ledger bridge;
   - mapa/playback/navegacao;
   - persistencia/hidratacao;
   - onboarding/documentos;
   - recibo/avaliacao.
2. Migrar `server.vps.js` para bootstrap modular por rota/handler.
3. Manter paridade por testes antes de trocar runtime.

### P4 - Observabilidade operacional

1. Dashboards por fluxo, nao apenas health:
   - pagamento confirmado;
   - booking criado;
   - dispatch iniciado;
   - motorista notificado;
   - aceite;
   - inicio;
   - conclusao;
   - ledger;
   - recibo;
   - push/chat.
2. Alertas para:
   - adapter Socket.IO fora de `ready`;
   - replay/erro de webhook;
   - divergencia ledger/saldo;
   - queda de cache hit Places;
   - custo medio por corrida acima do alvo.

## Ordem recomendada

1. Fechar guardrails e testes de config/health.
2. Congelar contratos de lifecycle e financeiro.
3. Rodar canary com contratos ativos.
4. Modularizar mobile em pequenas fatias.
5. Migrar backend VPS para modular com matriz de paridade.
6. Limpar legado somente depois de duas rodadas sem regressao.

## Criterios de aceite

- Deploy de producao falha se flags perigosas estiverem ligadas.
- Readiness falha se o Socket.IO Redis Adapter obrigatorio nao estiver pronto.
- Snapshot terminal nao reabre corrida no mobile.
- Dashboard usa transporte websocket previsivel por configuracao.
- Testes focados passam em backend e mobile.
- Legado removivel tem dono, justificativa e teste de ausencia.
