# Validação de transições terminais — 2026-09-03

## Diagnóstico

A falha inicial de `passenger-no-drivers → Home` não foi causada pela geofence nem por um processo preso. A geofence pública respondeu `GEOFENCE_ALLOWED` para a origem e o destino da fixture. A inspeção antes e depois das execuções não encontrou `maestro`, `xcodebuild`, `maestro-driver`, `simctl diagnose` ou runner de matriz residual.

O primeiro fluxo falhou de forma legítima depois do tap de retry: a tela permaneceu em `Nenhum motorista encontrado`. A causa foi a fixture persistir `bookingStatus: no_drivers`, enquanto o handler real `handleNoDriversFound` reconcilia o evento terminal para `bookingStatus: idle` e abre a superfície terminal por rota explícita. Ao voltar para Home, o auto-router lia novamente `no_drivers` e devolvia a tela terminal.

## Correção aplicada

- As fixtures iOS e Android de `passenger-no-drivers` agora persistem `bookingStatus: idle`, sem corrida ativa, mantendo a rota explícita `leafapp://robotaxi/no-drivers?...` para a superfície terminal.
- Os dois fluxos de transição começam com `launchApp` e `stopApp: false`, para não aceitarem uma execução sem boot explícito do app.
- O contrato unitário exige a semântica `idle + rota no-drivers` nos dois seeders e exige boot nos dois fluxos.
- Nenhum pagamento, cancelamento remoto, Woovi ou mutação de backend foi executado.

## Evidência física

| Caso | Gate protegido | Transição física | Resultado |
| --- | --- | --- | --- |
| `passenger-no-drivers` | [`MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-terminal-transitions-v2/no-drivers/MATRIX_REPORT.md) — seed, boot/app-ready e estado terminal | [`maestro.log`](../../mobile-app/test-results/ux-lab/20260903T-passenger-terminal-transitions-v2/no-drivers-transition/maestro-debug/.maestro/tests/2026-09-03_061709/maestro.log) — boot → assert terminal → retry → Home → terminal ausente | `PASS` |
| `passenger-cancelled-refund` | [`MATRIX_REPORT.md`](../../mobile-app/test-results/ux-lab/20260903T-passenger-terminal-transitions-v2/cancelled/MATRIX_REPORT.md) — seed, boot/app-ready e estado terminal | [`maestro.log`](../../mobile-app/test-results/ux-lab/20260903T-passenger-terminal-transitions-v2/cancelled-transition/maestro-debug/.maestro/tests/2026-09-03_062122/maestro.log) — boot → assert cancelamento → Voltar ao mapa → Home → terminal ausente | `PASS` |

Os dois gates protegidos fecharam `1 PASS / 0 FAIL / 0 NOT_RUN`, e os fluxos físicos terminaram com código `0`. A varredura pós-teardown ficou limpa em ambos os casos.

## Evidência audiovisual adicional

As duas transições foram regravadas depois de um novo seed isolado, reload do Dev Client e aprovação do fluxo `boot-app-ready-ios`; a rota só foi aberta depois desse gate. Os fluxos Maestro terminaram com código `0` e a revisão de quadros confirmou a superfície terminal e o retorno à Home canônica.

| Caso | Comandos e quadros | Vídeo aceito |
| --- | --- | --- |
| `no_drivers → Home` | [`commands JSON`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/no-drivers/transition/2026-09-03_070832/commands-(passenger-no-drivers-retry-to-home-ios.yaml).json) — 7/7 `COMPLETED`; [`terminal`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/review-frames/no-drivers-terminal.png), [`final Home`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/review-frames/no-drivers-final.png) | [`passenger-no-drivers-retry-to-home-normalized.mp4`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/no-drivers/transition/passenger-no-drivers-retry-to-home-normalized.mp4) — H.264, 1206×2622, 24,15 s, decodificação limpa |
| `canceled/refunded → Home` | [`commands JSON`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/cancelled-refund/transition/2026-09-03_071337/commands-(passenger-cancelled-return-to-home-ios.yaml).json) — 7/7 `COMPLETED`; [`terminal`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/review-frames/cancelled-terminal.png), [`final Home`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/review-frames/cancelled-final.png) | [`passenger-cancelled-refund-return-to-home-normalized.mp4`](../../mobile-app/test-results/ux-lab/20260903T-terminal-transition-video-v1/cancelled-refund/transition/passenger-cancelled-refund-return-to-home-normalized.mp4) — H.264, 1206×2622, 23,97 s, decodificação limpa |

Os arquivos brutos do `simctl` apresentaram somente avisos de timestamps não monotônicos; eles não são a evidência aceita. Os derivados normalizados foram gerados separadamente e passaram `ffmpeg -v error` sem saída. A gravação continua sendo E2 com seed local e `--skip-socket-token`: ela prova a transição visual, não disponibilidade, reembolso Woovi ou uma corrida E3.

## Limite da prova

Esta rodada é `E2` de superfície/transição usando seed isolado e `--skip-socket-token`. Ela prova o retorno visual à Home e a ausência de loop de rota; não prova disponibilidade real, Socket.IO, reembolso Woovi, quote ou corrida `E3`.
