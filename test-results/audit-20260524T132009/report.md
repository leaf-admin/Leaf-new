# Auditoria isolada dos fluxos Leaf - 2026-05-24

Run dir: `/Users/izaakdias/Documents/Leaf-new/test-results/audit-20260524T132009`

## Resultado geral

- Status local sem device: GO para seguir para canary assistido, com ressalvas abaixo.
- Chamadas pagas/API externa: nenhuma chamada funcional paga disparada; a auditoria usou suites mockadas, lint/build e guard rails locais.
- Evidencia executada: 572 execucoes de testes/assertions locais considerando as repeticoes de corrida, alem de dashboard lint/build, route guards e canary preflight estatico.
- Preflight nao-device: GO em `/Users/izaakdias/Documents/Leaf-new/test-results/audit-20260524T132009/non-device-canary-preflight/report.md`.

## Bateria executada

| Bloco | Evidencia | Resultado |
| --- | --- | --- |
| Mobile auth/onboarding/docs/KYC | `mobile-auth-onboarding-docs-kyc.log` | 7 suites, 33 testes PASS |
| Mobile notificacoes/navegacao/corrida/campanhas | `mobile-ride-notifications-navigation-campaigns.log` | 16 suites, 88 testes PASS |
| Mobile motorista/status/UI operacional | `mobile-driver-status-vehicle-ui.log` | 10 suites, 87 testes PASS |
| Backend core/ledger/docs/suporte/campanhas | `backend-core-ledger-support-docs.log` | 27 suites, 131 testes PASS |
| Backend contratos booking/lifecycle | `backend-contracts-booking-lifecycle.log` | 2 suites, 7 testes PASS |
| Suporte N1/N2/N3 | `support-orchestrator-tests-rerun.log` | 11 testes PASS |
| Dashboard | `dashboard-lint.log`, `dashboard-build.log` | lint PASS, build PASS |
| Guard rails sensiveis | `backend-sensitive-route-guards.log` | PASS |
| Corrida repetida 5x mockada | `ride-flow-five-mocked-runs.log` | 5 rodadas mobile + backend PASS |

## Status por processo

- Cadastro + onboarding: OK em teste local mockado.
- Recuperacao de senha: OK em teste local mockado.
- Leitura CNH/CRLV no onboarding/KYC: OK em teste local mockado; fluxo legado de veiculo ainda precisa canary visual.
- Validacao facial: OK contra mocks/AWS liveness unitario; validacao real em device fica pendente.
- Aprovacao/leitura/gestao de documentos via dashboard: backend, lint e build OK; falta E2E visual no painel para aprovar/rejeitar/solicitar.
- Notificacoes in-app e pendencia documental: contratos OK; push real/background depende de device.
- Estado de aprovacao motorista dashboard/app: OK em unit/service.
- Cadastro de veiculo: cobertura indireta OK; falta teste dedicado do fluxo visual `AddVehicle/MyVehicles`.
- Fluxo de corrida: 5 rodadas mockadas PASS; E2E real com dois devices ainda necessario.
- Avaliacao: OK.
- Chat no app: cobertura de socket/notificacao OK; fluxo Maestro antigo de chat esta desatualizado e deve ser refeito.
- Navegacao em segundo plano: servicos e fallback OK em unit; background real so em device.
- Chamada de apps de navegacao: OK em unit; abertura real Apple Maps/Google Maps/Waze pendente.
- Persistencia e registro final: ledger, trip location, active ride sync e billing OK em unit; Firestore/outbox real pendente no canary.
- Chamado, leitura no suporte, triagem, resolucao, N1/N2/N3: OK em orquestrador e services; integracao UI dashboard + API real ainda pede E2E.
- Campanhas in-app: OK incluindo slot, ativos, metricas, CPM/CPC/CTR e relatorio comercial.
- Pagamento, ledger, registro de pagamento e saque: OK em unit com idempotencia e senha de saque; provider real nao foi acionado.
- Emails boas-vindas/recibo: NAO implementado com Resend no codigo atual; `rg` nao encontrou `RESEND`, `@resend` ou servico equivalente.

## Mocks usados

- Firebase Auth, RTDB, Firestore, Storage, FCM/messaging.
- OTP, recuperacao de senha, WebSocket booking/accept/sync.
- KYC/liveness/AWS, OCR/documentos, Woovi/Pix/webhook, ledger/billing.
- Navegacao externa via Linking, campanhas/assets, suporte/orquestrador Leaf API.

## Riscos antes do canary

- Jest mobile reporta handles assincronos abertos nas repeticoes de corrida; testes passam, mas vale limpar listeners/timers.
- Push real, background, deep link de notificacao e navegacao externa precisam device fisico.
- Resend precisa ser criado para boas-vindas e recibo pos-viagem; hoje e lacuna real.
- Dashboard nao tem E2E React para aprovar doc, rejeitar com motivo, solicitar documento, suspender/reativar, publicar campanha e resolver chamado.
- Existem trilhas legadas paralelas de documentos/veiculo que podem aparecer por deep link se nao forem bloqueadas.
- Recibos/e-mails com mapa devem continuar mockados nos testes para nao aumentar custo de Google APIs.
