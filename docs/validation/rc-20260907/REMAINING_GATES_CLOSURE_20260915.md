# Fechamento dos gates restantes — 15/09/2026

## Objective

Registrar, no mesmo snapshot de trabalho, tudo que foi fechado depois da E3
bilateral e separar o que depende de uma resposta externa que não pode ser
inventada: provider de biometria, assinatura emitida pela Woovi em produção,
device físico, console ou deploy publicado.

## Decisão desta rodada

O núcleo da E3 bilateral está **PASS**. A corrida única passou por cotação,
Pix Woovi sandbox, aceite, chegada, embarque, início, movimento, conclusão,
settlement, recibos e avaliações nos dois papéis, com reconciliação financeira
14/14. Os dois itens locais que ainda afetavam a repetição do fluxo foram
fechados: o fluxo Maestro ideal agora usa a superfície atual do passageiro e o
`startTrip` não transforma uma confirmação lenta em falso erro.

Isso deixa o pacote pronto para a decisão do **piloto controlado**, desde que o
responsável aceite explicitamente a evidência sandbox e os gates externos
listados abaixo. Não é uma declaração de liquidação bancária real nem de
aprovação biométrica sem uma resposta do provider.

**Contagem para o piloto controlado: 0 bloqueios técnicos locais abertos.** Os
três itens ainda listados na matriz pertencem à prova externa ou à abertura
ampla: biometria real, webhook assinado no ambiente de produção e consolidação
formal de manifesto/CI/SHA.

## Escopo concluído nesta rodada

- Corrigir o falso timeout de `startTrip` no cliente sem alterar a autoridade do
  backend: janela de ACK de 20 s e recuperação somente após
  `syncActiveRide` confirmar `started` para o mesmo booking.
- Alinhar o fluxo Maestro ideal aos testIDs da superfície atual do passageiro,
  mantendo intocados os IDs legados dos fluxos que ainda usam a tela de destino.
- Gerar o build iOS local Release, validar bundle, widget e assinatura,
  instalar e lançar nos simuladores de passageiro e motorista e guardar hashes
  e screenshots.
- Reexecutar guards, testes focados, QA local do dashboard e observação de
  health; registrar os resultados e os limites externos.

## Arquivos alterados nesta rodada

- `mobile-app/src/services/WebSocketManager.js`
- `mobile-app/src/screens/prototype/prototypeRideRuntime.js`
- `mobile-app/__tests__/websocket-manager-create-booking.test.js`
- `mobile-app/.maestro/flows/qa/e2e/ideal/13-passenger-request-ideal.yaml`
- `docs/validation/rc-20260907/LOCAL_BUILD_EVIDENCE_20260915.json`
- `docs/validation/rc-20260907/health-current-20260915.json`
- `docs/validation/rc-20260907/REMAINING_GATES_CLOSURE_20260915.md`
- `docs/validation/rc-20260907/README.md`
- `docs/validation/rc-20260907/PRODUCTION_GATES_STATUS_20260912.md`
- `docs/validation/rc-20260907/GO_LIVE_TODO_20260909.md`
- `mobile-app/test-results/e3-full-20260915/E3-REPORT.md` (artefato de evidência ignorado pelo Git)

As demais alterações já existentes no worktree foram preservadas e não são
implicitamente promovidas para o release por este documento.

## Matriz de fechamento

| Item | Estado em 15/09 | Evidência | Limite honesto |
| --- | --- | --- | --- |
| E3 bilateral visual + backend | **PASS** | [E3 full report](../../../mobile-app/test-results/e3-full-20260915/E3-REPORT.md), [evidência backend](../../../mobile-app/test-results/e3-full-20260915/backend-evidence-final.json), screenshots bilaterais e [E3_RUN_20260912](E3_RUN_20260912.md) | Execução em simuladores iOS; o device físico continua sendo uma coleta adicional se o runbook exigir. |
| Seletor Maestro do fluxo ideal | **FECHADO** | [`13-passenger-request-ideal.yaml`](../../../mobile-app/.maestro/flows/qa/e2e/ideal/13-passenger-request-ideal.yaml) usa `passenger-home-destination-search-input`, `passenger-home-destination-result-0` e `passenger-home-category-confirm`, que pertencem à superfície atual. | Os fluxos antigos que iniciam em `RobotaxiDestinationScreen` mantêm os IDs legados de propósito. |
| Falso timeout no início da corrida | **FECHADO LOCALMENTE** | [`WebSocketManager.js`](../../../mobile-app/src/services/WebSocketManager.js) amplia a janela de `startTrip` para 20 s; [`prototypeRideRuntime.js`](../../../mobile-app/src/screens/prototype/prototypeRideRuntime.js) consulta `syncActiveRide` e só recupera a transição `started` quando o backend a confirmou; regressão em [`websocket-manager-create-booking.test.js`](../../../mobile-app/__tests__/websocket-manager-create-booking.test.js). O ajuste foi compilado no build local descrito em [`LOCAL_BUILD_EVIDENCE_20260915.json`](LOCAL_BUILD_EVIDENCE_20260915.json). | Nenhum EAS foi usado; a instalação física continua sendo uma coleta adicional se o runbook exigir. |
| Build local com os ajustes | **PASS** | [`LOCAL_BUILD_EVIDENCE_20260915.json`](LOCAL_BUILD_EVIDENCE_20260915.json): iOS simulator Release 1.0.4 (35), bundle validado, assinatura local verificada, instalado e lançado nos dois simuladores, com screenshots de home dos dois papéis. | A coleta é de simulador; o device físico só é necessário se o runbook de release exigir essa evidência adicional. |
| Corpo bruto e assinatura do webhook Woovi | **FECHADO NO CÓDIGO/CONTRATO** | [`README.md`](README.md) registra a captura dos três caminhos; [`woovi-webhook-guards.unit.test.js`](../../../leaf-websocket-backend/tests/unit/routes/woovi-webhook-guards.unit.test.js) passou com JSON formatado, query string, adulteração e idempotência. | Falta somente uma entrega assinada pelo endpoint real de produção, que exige segredo/provider e não foi simulada. |
| KYC, liveness AWS e face compare | **CONTRATOS FECHADOS; EVIDÊNCIA EXTERNA PENDENTE** | 14 suítes / 364 testes de admission, budget, cost guard, política biométrica, revisão e preflight passaram; a política backend continua sendo a autoridade. | Sem um rosto autorizado, sessão AWS real e resposta do serviço Leaf, o resultado deve permanecer `NOT_RUN` para o gate biométrico. Não usar bypass como prova. |
| Health/latência do staging | **FECHADO COMO OBSERVAÇÃO** | [`health-current-20260915.json`](health-current-20260915.json): API e socket `healthy`, Firestore 199 ms, Redis 0–1 ms, RTDB 2 ms, Redis adapter `ready`, memória ~35%, CPU ~20%. | O alerta anterior de 2522 ms não se repetiu. Continuar monitorando durante o piloto; não alterar thresholds sem aprovação. |
| CPF review HMAC | **PASS — provisionado** | [`PRODUCTION_GATES_STATUS_20260912.md`](PRODUCTION_GATES_STATUS_20260912.md) registra geração no host, fingerprint protegido e carregamento nos gateways. | Rotação exige migração dual-key se houver casos antigos; não trocar a chave nesta rodada. |
| Dashboard contextualizado publicado | **CÓDIGO LOCAL PASS; PUBLICAÇÃO PENDENTE** | `npm --prefix leaf-dashboard-js run qa:backoffice` passou com contratos de suporte/KYC/RBAC, lint, build de 28 páginas e smoke protegido; o estado HTTP publicado ainda precisa ser verificado no SHA candidato. | Requer deploy/console e autenticação administrativa, ações externas ao escopo local desta rodada. |
| Manifesto, CI e SHA limpo | **PENDENTE DE CONSOLIDAÇÃO** | O branch está `codex/uiux-integration-validation` e o worktree mantém alterações anteriores do projeto. | Não fazer `reset`, limpeza ampla ou commit em `main`; consolidar somente depois da revisão humana dos arquivos que entram no release. |

## Testes executados hoje

As validações rápidas foram repetidas entre 13:05 e 13:31 BRT (16:05–16:31Z)
depois dos ajustes desta rodada; o worktree permaneceu no branch
`codex/uiux-integration-validation` e
continuou deliberadamente sem limpeza ampla ou commit em `main`.

- Mobile focado: 4 suítes / 60 testes PASS — `WebSocketManager`, overlay do
  motorista, overlay do passageiro e sanitização da sessão.
- Backend Woovi: 3 suítes / 50 testes PASS — webhook, sandbox smoke e
  configuração de credenciais.
- Backend KYC: 14 suítes / 364 testes PASS — preflight, admission, budget,
  cost guard, política biométrica, revisão, status e escopo sandbox.
- A primeira tentativa da suíte KYC foi interrompida pelo `EPERM` do sandbox ao
  abrir o listener do `supertest`; a repetição com listener local autorizado
  passou integralmente. Isso é uma limitação de execução, não um teste
  convertido em sucesso por bypass.
- Dashboard: `qa:backoffice` PASS — contratos, lint, build de 28 páginas e
  smoke autenticado/rotas protegidas; execução repetida com permissão de
  listener local em 15/09.
- `git diff --check`: PASS.
- Os 15 links relativos deste documento foram resolvidos no worktree: PASS.
- Health read-only: API e socket PASS em 15/09 às 13:05 BRT (16:05Z); resposta completa
  preservada em [`health-current-20260915.json`](health-current-20260915.json).

## Fechamento externo que ainda depende de autorização/provider

1. Se o piloto exigir biometria estrita, executar uma sessão AWS liveness e
   face compare com identidade de QA autorizada, guardar `sessionId`/`evidenceId`
   opacos e rodar `ops:kyc-aws-preflight` sem expor tokens.
2. Depois do deploy autorizado do SHA candidato, entregar um webhook Woovi
   assinado no endpoint real e guardar apenas hash, status HTTP, event id e
   resultado de idempotência.
3. Consolidar manifesto/CI e fazer a revisão humana final antes de qualquer
   abertura ampla. `LEAF_BROAD_LAUNCH_APPROVED` permanece desligado.

## Risks

- A E3 e o settlement observados são sandbox; não constituem liquidação ou
  saque bancário real.
- O worktree está sujo por alterações anteriores preservadas. O documento não
  trata todas essas alterações como parte do release.
- A execução de KYC real e o webhook assinado dependem de provider, credenciais
  e/ou device fora deste ambiente local.

## Rollback path

- Reverter os quatro arquivos locais desta rodada em um único delta: o timeout
  do `WebSocketManager`, o recovery em `prototypeRideRuntime`, a regressão Jest
  e o selector do fluxo Maestro.
- Remover `health-current-20260915.json` e este documento não toca no runtime.
- Para a janela QA remota, usar o backup documentado em
  [`E3-REPORT.md`](../../../mobile-app/test-results/e3-full-20260915/E3-REPORT.md)
  e recriar somente os serviços indicados pelo relatório.

## Out of scope

- Deploy de produção, EAS/App Store, consoles Apple/Google/AWS/Woovi/Firebase,
  rotação de segredos, ativação de saque ou cobrança real.
- Migração Expo/Metro e atualização forçada das dependências; permanecem
  hardening pós-piloto conforme a política já registrada.
- Alteração de regra financeira, take-rate, pedágio, refund ou política de CPF.
