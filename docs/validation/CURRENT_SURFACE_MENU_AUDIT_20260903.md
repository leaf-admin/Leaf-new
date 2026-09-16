# Auditoria das entradas auxiliares CURRENT — 2026-09-03

## Objetivo

Validar as entradas e saídas das superfícies auxiliares das duas raízes operacionais sem abrir rotas legadas, executar ações financeiras ou mutar conta, documentos, veículos, waitlist ou suporte.

## Gate obrigatório

Cada papel passou primeiro pelo runner protegido, com device `6BC9EC30-C939-4598-A85D-A9E071E90CE5` em `Booted`, app instalado, bundle Dev Client carregado, localização QA aplicada e `READY_SCREEN_ID` visível. Somente depois o fluxo de menu foi iniciado.

- Passageiro: [`readiness/MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-menu-audit-v1/readiness/MATRIX_REPORT.md) — `1 PASS / 0 FAIL / 0 NOT_RUN`, Home `passenger-home-destination-input`.
- Motorista: [`readiness/MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-driver-menu-audit-v1/readiness/MATRIX_REPORT.md) — `1 PASS / 0 FAIL / 0 NOT_RUN`, Home `driver-home-toggle-online`.
- Java usado: `/Users/izaakdias/.local/jdks/temurin17/jdk-17.0.18+8/Contents/Home`.
- Metro usado: `http://127.0.0.1:8097`.

## Passageiro

O fluxo [`01-passenger-dedicated-device.yaml`](../../mobile-app/.maestro/flows/current-menus/01-passenger-dedicated-device.yaml) passou todas as entradas e retornos:

1. Perfil (`robotaxi-profile-screen`), aceitando somente o estado de erro remoto honesto quando aplicável.
2. Histórico (`Histórico` / `Viagens recentes`).
3. Privacidade (`privacy-policy-screen`).
4. Configurações, confirmando apenas ações CURRENT e a ausência das linhas antigas de notificações, idioma, trânsito e voz.
5. Suporte (`robotaxi-support-screen`).

Cada visita retornou a `passenger-home-destination-input`. Não houve logout, exclusão, ticket, incidente ou ação de pagamento. O log completo do Maestro está em [`commands-(01-passenger-dedicated-device.yaml).json`](../../mobile-app/test-results/ux-lab/20260903T-passenger-menu-audit-v1/menu/2026-09-03_054926/commands-(01-passenger-dedicated-device.yaml).json).

## Motorista

O fluxo [`02-driver-dedicated-device.yaml`](../../mobile-app/.maestro/flows/current-menus/02-driver-dedicated-device.yaml) passou todas as entradas e retornos:

1. Ganhos (`driver-earnings-screen`), sem abrir saque.
2. Histórico (`robotaxi-trip-history-screen`, `Viagens`, `Recibos recentes`).
3. Ativação (`Ativação do motorista`), sem continuar upload.
4. Documentos (`robotaxi-driver-documents-screen`, `Resumo`).
5. Veículos (`robotaxi-vehicles-screen`), aceitando apenas estado vazio/erro honesto/dado existente.
6. Waitlist (`robotaxi-driver-waitlist-screen`), sem entrar, convidar, copiar ou compartilhar.
7. Perfil (`robotaxi-profile-screen`).
8. Privacidade (`privacy-policy-screen`).
9. Configurações, confirmando ações CURRENT e ausência das linhas antigas.
10. Suporte (`robotaxi-support-screen`).

Cada visita retornou a `driver-home-toggle-online`. Não houve saque, upload, cadastro/remoção de veículo, entrada em waitlist, convite, logout, exclusão, ticket ou incidente. O log completo do Maestro está em [`commands-(02-driver-dedicated-device.yaml).json`](../../mobile-app/test-results/ux-lab/20260903T-driver-menu-audit-v1/menu/2026-09-03_055407/commands-(02-driver-dedicated-device.yaml).json).

## Resultado e limite

As entradas auxiliares CURRENT estão validadas em E2 físico sequencial e não apontam para os componentes legados. A matriz de ciclo de corrida continua separada: esta auditoria não prova quote, Socket.IO, Pix, receipt financeiro, ledger ou E3 bilateral. A remoção dos 56 nomes legados, 4 componentes antigos e 67 rotas aposentadas permanece fora desta auditoria e depende de aprovação explícita.

Após os dois fluxos, a varredura de teardown não encontrou Maestro, `maestro-driver`, `xcodebuild`, runner de matriz, `simctl spawn` ou `simctl diagnose` residual.

## Transições terminais adicionais

Os fluxos [`passenger-no-drivers-retry-to-home-ios.yaml`](../../mobile-app/.maestro/flows/qa/transitions/passenger-no-drivers-retry-to-home-ios.yaml) e [`passenger-cancelled-return-to-home-ios.yaml`](../../mobile-app/.maestro/flows/qa/transitions/passenger-cancelled-return-to-home-ios.yaml) foram executados com boot explícito e runner protegido. O primeiro retorno `no_drivers → Home` falhou honestamente na rodada v1 porque o seed persistia `bookingStatus: no_drivers`; isso foi corrigido para a semântica real do runtime (`idle` + deep link terminal), sem alterar regra financeira ou chamar backend.

Na revalidação v2, ambos passaram: [`no-drivers/MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-terminal-transitions-v2/no-drivers/MATRIX_REPORT.md) e [`cancelled/MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-terminal-transitions-v2/cancelled/MATRIX_REPORT.md) fecharam `1 PASS / 0 FAIL / 0 NOT_RUN`; os logs dos fluxos registram boot, assert inicial, ação terminal, Home visível e tela terminal ausente em [`TERMINAL_TRANSITION_VALIDATION_20260903.md`](./TERMINAL_TRANSITION_VALIDATION_20260903.md). Os dois casos são E2 isolados: não representam pagamento, estorno ou cancelamento integrado.

Após cada caso, a varredura encontrou zero processo residual de Maestro/XCUITest/runner. A geofence não participou da falha inicial: a resposta pública foi `GEOFENCE_ALLOWED`; o problema era a fixture e o auto-router, não o host.

## Transições de ciclo revalidadas

Além das recuperações terminais, foram validados dois caminhos reversíveis CURRENT no passageiro, sempre depois de um gate protegido do estado inicial:

1. `payment_failed → Home`: o retry voltou para `passenger-home-destination-input` e removeu a superfície de falha. O gate do estado passou `1 PASS / 0 FAIL / 0 NOT_RUN`; o fluxo e o vídeo H.264 normalizado estão documentados em [`LIFECYCLE_TRANSITION_VALIDATION_20260903.md`](./LIFECYCLE_TRANSITION_VALIDATION_20260903.md).
2. `accepted → Mais opções → cancelamento → Continuar corrida → trip`: a sheet de cancelamento abriu e foi fechada sem chamar o endpoint de cancelamento; o fluxo terminou com `passenger-trip-screen` visível e a tela de cancelamento ausente. O gate do estado passou `1 PASS / 0 FAIL / 0 NOT_RUN`, com capturas anterior/sheet/posterior e vídeo decodificável no mesmo relatório.

Esses casos são E2 de navegação e superfície. Não comprovam retry com cobrança confirmada, cancelamento real, reembolso, Socket.IO, replacement ou financeiro E3. As demais transições do ciclo continuam `REVALIDATE/BLOCKED` até haver backend sandbox e corrida correlacionada.
