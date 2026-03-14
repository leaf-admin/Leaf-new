# Publish Ready - 2026-03-06

## Entregas aplicadas

1. Pagamento review-safe no backend
- Arquivo: `leaf-websocket-backend/services/payment-service.js`
- Se Woovi falhar e `PAYMENT_BYPASS_ON_WOOVI_FAILURE=true`, o backend retorna sucesso controlado com `chargeId` mock (`mock_review_*`).
- `GET /api/payment/status/:chargeId` reconhece mock e retorna `in_holding`.

2. Cancelamento review-safe
- Arquivo: `leaf-websocket-backend/routes/woovi.js`
- `POST /api/woovi/cancel-charge/:chargeId` retorna sucesso local para `mock_review_*`.

3. Mobile sem chave Woovi hardcoded no serviço legado
- Arquivo: `mobile-app/src/services/paymentService.js`
- Removido uso direto de credenciais Woovi no app.
- Fluxo legado agora bate no backend (`/api/payment/*` e `/api/woovi/*`).

4. WooviService mobile ajustado para backend-first
- Arquivo: `mobile-app/src/services/WooviService.js`
- `listPayments` e `cancelPayment` via backend.
- `cancelPayment` suporta mock local.

5. Config Woovi mobile sanitizada
- Arquivo: `mobile-app/config/WooviConfig.js`
- Removidos valores sensíveis hardcoded.

6. Screenshots para stores via ADB (sem Maestro)
- Script: `mobile-app/scripts/capture-store-screenshots-adb.sh`
- NPM script: `npm run screenshots:adb`
- Saída: `mobile-app/screenshots-for-stores/android/phone/`

## Validações executadas

- `POST /api/payment/advance` com Woovi indisponível -> `success=true` em modo bypass
- `GET /api/payment/status/mock_review_*` -> `in_holding`
- `POST /api/woovi/cancel-charge/mock_review_*` -> sucesso
- Captura ADB: 6 arquivos PNG gerados em `screenshots-for-stores/android/phone`

## Flags para manter no review

Backend `.env`:
- `PAYMENT_BYPASS_ON_WOOVI_FAILURE=true`

## Flags para produção real (depois do review)

Quando Woovi liberar split/subconta e fluxo final estiver pronto:
- `PAYMENT_BYPASS_ON_WOOVI_FAILURE=false`

