# Validação direcionada de transições do ciclo — 2026-09-03

## Objetivo

Validar transições CURRENT que podem ser exercitadas sem alterar autoridade de booking, pagamento ou backend: falha de pagamento retornando à Home e entrada/saída reversível da confirmação de cancelamento a partir de `accepted`.

Esta é evidência `E2` física, com seed isolado. Não é aceite `E3` e não representa uma corrida real correlacionada.

## Gate de execução

Os dois casos passaram pelo runner protegido antes do fluxo de transição:

- device `Leaf iPhone 17 Dedicated` — `6BC9EC30-C939-4598-A85D-A9E071E90CE5`, `Booted`;
- app `br.com.leaf.ride` instalado e reativado;
- Metro `http://127.0.0.1:8097` e bundle iOS Debug disponíveis;
- localização QA aplicada em `-22.97104,-43.18349`;
- sessão QA Firebase e superfície operacional prontas;
- seed, rota e assert executados somente depois do gate;
- Java 17 Temurin e Maestro sob watchdog com process group.

## Resultados aceitos

| Transição | Gate do estado | Fluxo físico | Evidência audiovisual | Resultado |
| --- | --- | --- | --- | --- |
| `payment_failed → Home` | [`payment-failed-state/MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-transition-revalidation-v1/payment-failed-state/MATRIX_REPORT.md) — `1 PASS / 0 FAIL / 0 NOT_RUN` | [`commands-(passenger-payment-failed-retry-to-home-ios.yaml).json`](../../mobile-app/test-results/ux-lab/20260903T-passenger-transition-revalidation-v1/payment-failed-transition/2026-09-03_063217/commands-(passenger-payment-failed-retry-to-home-ios.yaml).json) — boot → falha visível → retry → Home → falha ausente | [`passenger-payment-failed-retry-normalized.mp4`](../../mobile-app/test-results/ux-lab/20260903T-passenger-transition-revalidation-v1/payment-failed-transition/passenger-payment-failed-retry-normalized.mp4) — H.264, 1206×2622, 72,5 s, decodificação limpa | `PASS` |
| `accepted → cancelamento → continuar → trip` | [`accepted-state-v3/MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-transition-revalidation-v1/accepted-state-v3/MATRIX_REPORT.md) — `1 PASS / 0 FAIL / 0 NOT_RUN` | [`commands-(passenger-accepted-cancel-dismiss-ios.yaml).json`](../../mobile-app/test-results/ux-lab/20260903T-passenger-transition-revalidation-v1/accepted-cancel-dismiss-transition-v3/2026-09-03_065051/commands-(passenger-accepted-cancel-dismiss-ios.yaml).json) — boot → trip compacto → Mais opções → cancelamento → Continuar corrida → trip expandido | [`passenger-accepted-cancel-dismiss-normalized.mp4`](../../mobile-app/test-results/ux-lab/20260903T-passenger-transition-revalidation-v1/accepted-cancel-dismiss-transition-v3/passenger-accepted-cancel-dismiss-normalized.mp4) — H.264, 1206×2622, 28,6 s, decodificação limpa | `PASS` |

Os arquivos de comandos registram `16/16` passos como `COMPLETED` no segundo caso e `0` falhas. As capturas do mesmo fluxo preservam os três pontos de revisão: estado anterior, sheet de decisão e estado posterior.

## Controle de falso positivo

- Os dois YAML começam com `launchApp` e `stopApp: false`.
- O estado inicial só foi aceito após o relatório protegido do cenário correspondente.
- `payment_failed` usou o ramo de retry sem `retryConfirmedBooking`; o comportamento observado é retorno à Home, sem materialização de nova cobrança.
- O fluxo `accepted` apenas abriu a sheet e acionou `Continuar corrida`; ele não abriu `Cancelar mesmo` e não chamou `cancelRideSearch`.
- A primeira tentativa do fluxo `accepted` falhou honestamente porque o botão estava dentro de `Mais opções`; foi corrigida para expandir a sheet antes do assert.
- A primeira captura audiovisual foi excluída: o recorder perdeu o cliente e deixou um sidecar com timestamps/NALs inválidos. A captura v3 foi feita em TTY e encerrada com Ctrl-C, conforme o protocolo do `simctl`.
- Depois da captura v3, não restaram Maestro, recorder, `xcodebuild`, `maestro-driver`, runner de matriz ou `simctl diagnose` do trabalho.

## Limite e próximo bloco

Estas transições fecham apenas os caminhos reversíveis E2. Permanecem abertas, corretamente, as transições que dependem de autoridade externa ou de efeitos irreversíveis:

- cancelamento real de uma corrida ativa e cálculo de reembolso;
- `operational_interrupted → searching_replacement → accepted` via Socket.IO;
- `started → completed → receipt → rating → disponibilidade` com snapshot financeiro final;
- quote/availability, Pix sandbox no backend público, ledger e reconciliação da mesma corrida;
- execução E3 bilateral com dois devices Leaf autorizados.

Nenhuma regra de negócio, configuração de produção, provider Woovi ou endpoint remoto foi alterado nesta rodada.
