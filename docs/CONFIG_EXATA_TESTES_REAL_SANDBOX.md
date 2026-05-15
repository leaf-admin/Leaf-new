# Config Exata de Testes - Real Sandbox

Data de referência: **6 de maio de 2026**

## Objetivo
Executar smoke E2E com validação realista de fluxo de autenticação OTP e criação de corrida, **sem bypass implícito** e **sem custo financeiro em produção**.

## Identidades de teste (Firebase Test Phone Numbers)
- `+55 21 10293-8475` -> código `992111`
- `+55 21 12345-6789` -> código `992000`

Uso no app (campo com DDD, sem +55):
- `21102938475`
- `21123456789`

## Backend obrigatório (Plano 1: real-sandbox)
Todos os itens abaixo devem estar efetivos no runtime da Contabo:

- `WOOVI_ENVIRONMENT=sandbox`
- `WOOVI_BASE_URL` apontando para sandbox Woovi
- `REQUIRE_PAYMENT_BEFORE_BOOKING=true`
- `VERIFY_PAYMENT_BEFORE_BOOKING=true`
- `REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING=true`
- `APP_REVIEW=false`
- `MOCK_PAYMENT_FOR_TESTS=false`
- `ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING=false`
- `PAYMENT_BYPASS_ON_WOOVI_FAILURE=false`
- `PAYMENT_FORCE_BYPASS=false`
- `AUTH_TEST_OTP_BYPASS_ENABLED=false`
- `AUTH_REVIEW_OTP_BYPASS_ENABLED=false`

## Mobile obrigatório
- Não ativar flags de bypass:
  - `EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=false` (ou ausente)
  - `EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=false` (ou ausente)
  - `EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK=false` (ou ausente)
  - `EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=false`
  - `EXPO_PUBLIC_BYPASS_PAYMENTS=false`

## Preflight (sempre antes de rodar)
1. Validar runtime efetivo do backend:

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
npm run qa:backend:real-sandbox
```

Critério: `realSandbox.ready` deve ser `true`.

2. Se `realSandbox.ready=false`, corrigir blockers listados em `realSandbox.blockers`.

## Comando oficial de smoke real-sandbox

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
npm run test:e2e:stable
```

O script já valida automaticamente:
- `/health`
- handshake socket.io
- `/health/runtime-flags` com `realSandbox.ready=true`

## Por que às vezes passa hoje e falha em 1-2 dias
Principais causas de flapping:
- Drift de variáveis de ambiente entre deploys.
- Mudança de dados de usuário de teste (conta vira “existente com senha” e não segue OTP esperado).
- Ambiente mobile em estado sujo (sessão/cache antigo no device).
- Dependências externas instáveis (Firebase/Woovi/rede).

## Rotina mínima anti-flapping
1. Rodar preflight de runtime (`/health/runtime-flags`).
2. Rodar smoke com app em `clearState`.
3. Salvar artefatos (`.maestro/results/stable_guarded_*`) e comparar blockers quando falhar.
4. Se necessário, resetar usuário de teste antes do próximo run.

## Próxima etapa (após Plano 1 estável)
Canary real controlado:
- 1 corrida real/dia com valor mínimo.
- conta dedicada.
- reembolso automático/manual ao final.
- budget diário e alertas de desvio.
