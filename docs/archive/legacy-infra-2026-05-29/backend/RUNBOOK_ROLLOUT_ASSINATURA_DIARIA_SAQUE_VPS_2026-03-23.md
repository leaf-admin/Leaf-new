# Runbook: Rollout Assinatura Diária + Cobrança no Saque (VPS)

Data: 23/03/2026
Escopo: backend na VPS provedor anterior, com diretório remoto em `/opt/leaf`, `/opt/leaf/leaf-websocket-backend` ou `/opt/leaf-app`.

## 1) Objetivo do rollout

- Cobrança diária por plano/onda passa a **acumular pendência** em `subscriptions/{driverId}.pendingFeeCents`.
- Liquidação da pendência acontece no **saque**.
- Split punitivo por corrida fica **desligado por padrão**.
- Valores iniciais Leaf Plus por onda:
`wave_1=R$ 9,90`, `wave_2=R$ 12,90`, `wave_3=R$ 14,90`.

## 2) Arquivos alterados (backend)

- `services/daily-subscription-service.js`
- `services/payment-service.js`
- `routes/payment.js`
- `routes/dashboard.js`
- `server.js`

## 3) Variáveis de ambiente obrigatórias

```env
SUBSCRIPTION_SETTLE_ON_WITHDRAW=true
SUBSCRIPTION_SPLIT_RETENTION_ENABLED=false
SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY=false
SUBSCRIPTION_BILLING_CONFIG_PATH=subscription_billing/config
SUBSCRIPTION_PLUS_WAVE_1_DAILY_CENTS=990
SUBSCRIPTION_PLUS_WAVE_2_DAILY_CENTS=1290
SUBSCRIPTION_PLUS_WAVE_3_DAILY_CENTS=1490
SUBSCRIPTION_PLUS_DAILY_CENTS=1490
SUBSCRIPTION_ELITE_DAILY_CENTS=0
```

## 4) Deploy automatizado (recomendado)

Executar no host local (raiz do projeto):

```bash
bash leaf-websocket-backend/scripts/ops/rollout-daily-subscription-withdraw-vps.sh
```

Opcional (forçar diretório remoto específico):

```bash
REMOTE_BACKEND_DIR=/opt/leaf \
bash leaf-websocket-backend/scripts/ops/rollout-daily-subscription-withdraw-vps.sh
```

O script faz:
1. valida sintaxe local,
2. backup remoto,
3. upload dos arquivos,
4. upsert das variáveis de ambiente,
5. restart (`pm2`/`systemctl`),
6. smoke de endpoints.

## 5) Smoke pós-deploy (manual complementar)

Na VPS:

```bash
curl -sS http://localhost:3001/health
curl -sS http://localhost:3001/api/payment/driver-balance/smoke_driver
curl -sS "http://localhost:3001/api/subscriptions/drivers?limit=3"
```

Validações esperadas:
- `/driver-balance` retorna `subscriptionPendingFeeCents`.
- `/subscriptions/drivers` retorna diária, pendência e onda.

## 6) Ajuste operacional de onda/isenção (sem redeploy)

Endpoint:

`PATCH /api/drivers/:driverId/subscription`

Campos suportados:
- `waveId` (`wave_1`, `wave_2`, `wave_3`, etc)
- `dailyFeeCents`
- `feeExemptUntil` (ISO8601)
- `isFeeExempt` (`true/false`)
- `collectionMode` (`withdrawal` ou `balance`)

## 7) Rollback rápido

O script cria backup remoto em:

`$REMOTE_BACKEND_DIR/backups/subscription-withdraw-rollout-YYYYMMDD-HHMMSS`

Rollback:
1. restaurar arquivos do backup,
2. reiniciar processo (`pm2 restart ... --update-env`),
3. validar `/health`.

## 8) Riscos conhecidos

- Se a VPS estiver executando runtime divergente do local, aplicar também o fluxo de paridade:
`leaf-websocket-backend/scripts/ops/check-vps-runtime-parity.sh`.
- Se Redis estiver indisponível durante smoke local, logs de reconexão podem aparecer sem impedir validação dos endpoints HTTP.
