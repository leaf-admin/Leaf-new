# Prelaunch Validation Brasil

Este runbook implementa o plano de pre-lancamento do Leaf para App Store e Play Store no Brasil.

## Comandos principais

```bash
# Auditoria rapida: copy, stores, staging real-sandbox e observabilidade
npm run prelaunch:audit

# Rodada completa: testes, suporte, Maestro, builds release e 10 corridas
npm run prelaunch:full

# Somente as 10 corridas completas
npm run prelaunch:rides
```

Variaveis esperadas:

- `PRELAUNCH_API_BASE_URL`: API de staging real. Padrao: `https://api.62.169.31.231.sslip.io`.
- `PRELAUNCH_WS_URL`: socket de staging real. Padrao: `https://socket.62.169.31.231.sslip.io`.
- `PRELAUNCH_RIDE_SERVER_URL`: base usada pelo simulador de corrida para socket e telemetria.
- `PRELAUNCH_METRICS_URL`: endpoint Prometheus. Padrao: `${PRELAUNCH_API_BASE_URL}/api/metrics/prometheus`.
- `PRELAUNCH_METRICS_TOKEN`: bearer token admin/suporte para ler metricas, quando o login automatico nao for usado.
- `ADMIN_AUTH_EMAIL`/`ADMIN_AUTH_PASSWORD` ou `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD`: credenciais usadas para obter token admin automaticamente.
- `AUTO_LOGIN_ADMIN_TOKEN=false`: desativa o login automatico para metricas.
- `PRELAUNCH_EVIDENCE_FILE`: caminho do JSON preenchido a partir de `scripts/prelaunch/evidence-template.json`.
- `PRELAUNCH_RUN_ID`: identificador da rodada; se ausente, o runner gera um.

## Evidencias

Copie `scripts/prelaunch/evidence-template.json` para um arquivo da rodada, preencha as contas usadas e marque cada item manual validado. O runner considera a rodada **NO-GO** enquanto houver evidencia manual pendente.

Cada corrida deve preservar:

- `bookingId`, passageiro, motorista e veiculo ativo.
- saldo do motorista antes/depois.
- paymentId/chargeId sandbox.
- traceId/correlationId.
- status final em app, Firebase/RealtimeDB/Redis e dashboard.
- screenshot ou video do passageiro e do motorista.

## Gates automatizados

- Guard de copy do onboarding: bloqueia termos como "OTP" em textos visiveis.
- Guard de seletores E2E: bloqueia perda de `testID` nos fluxos de cadastro, corrida, suporte, veiculo e saque.
- Store preflight: links legais, configuracao Expo, endpoints, flags e permissoes.
- Backend real-sandbox: `/health/runtime-flags`.
- Observabilidade: `/health`, `/health/runtime-flags`, `/api/metrics/prometheus`, arquivos Prometheus/Tempo e metricas criticas.
- Testes mobile/backend e backend E2E.
- Suporte usuario/admin.
- Maestro core audit.
- Builds release Android/iOS.
- Instalacao e abertura dos builds release em Android (`ANDROID_SERIAL`) e iOS Simulator (`IOS_SIMULATOR_UDID`).
- Loop de 10 corridas completas via simulador real-core.

## Criterios de aceite

- 10/10 corridas completas sem falha.
- Nenhum gate P0/P1 falhando.
- Nenhuma divergencia entre app, backend, Redis/Firebase, ledger e dashboard.
- Suporte cobre ticket geral, ticket por corrida, reembolso e objeto perdido.
- Financeiro valida snapshot de tarifa, saldo, ledger, reembolso, multa e saque bloqueado/validado.
- Lojas: Data Safety, App Privacy, account deletion, background location disclosure, screenshots, assets e notas de revisao prontos.

## Fontes de politica de loja

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple App Privacy: https://developer.apple.com/app-store/app-privacy-details/
- Apple account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app
- Apple screenshot specs: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Google Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google background location: https://support.google.com/googleplay/android-developer/answer/9799150
- Google account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google preview assets: https://support.google.com/googleplay/android-developer/answer/1078870
