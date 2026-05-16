# Pilot Controlled Go Checklist

Data: 2026-04-05
Objetivo: decidir `GO` ou `NO-GO` para piloto controlado com escopo congelado no fluxo core.

## Perfil de lancamento

- Launch profile: `pilot_controlled`
- App mobile:
  - `EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS=false`
  - `EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS=false`
  - `EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT=false`
  - `EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS=false`
- Backend:
  - `ENABLE_DRIVER_WITHDRAWALS=false`
  - `ENABLE_REFERRAL_PROGRAMS=false`
  - `ENABLE_SOFT_BAN_ENFORCEMENT=false`
  - `ENABLE_ADMIN_MUTATIONS=false`

## Gate tecnico

- Rodar `node scripts/validation/check-pilot-go.cjs --tracker <tracker.md>`
- Resultado deve ser `GO_CANDIDATE`
- Preflight operacional rapido:
  - `bash scripts/validation/run-pilot-controlled-preflight.sh`
  - para checar `/health` junto: `LEAF_HEALTH_URL=https://<host>/health bash scripts/validation/run-pilot-controlled-preflight.sh`
- Deep check de launch-day:
  - `bash scripts/validation/run-pilot-controlled-deep-check.sh`
  - com token admin opcional para endpoints protegidos:
    - `LEAF_ADMIN_BEARER_TOKEN=<token> bash scripts/validation/run-pilot-controlled-deep-check.sh`
    - sem token exportado, o `healthcheck-vps.sh` tenta login admin automático com as credenciais padrão do ambiente
- Nenhum P0 aberto em:
  - cadastro e onboarding
  - KYC e ativacao
  - geofence e elegibilidade
  - quote, pagamento, corrida, reconnect, recibo e rating

## Gate operacional

- Backend `/health` verde
- Thresholds de health sistêmico ajustados para a VPS do piloto:
  - `HEALTH_SYSTEM_MEMORY_WARNING_PERCENT=80`
  - `HEALTH_SYSTEM_MEMORY_CRITICAL_PERCENT=92`
  - `HEALTH_SYSTEM_CPU_WARNING_PERCENT=120`
  - `HEALTH_SYSTEM_CPU_CRITICAL_PERCENT=200`
  - `HEALTH_SYSTEM_CPU_SUSTAINED_CRITICAL_PERCENT=140`
- Websocket autenticando
- Redis acessivel
- Logs de booking e ride lifecycle legiveis
- Monitoracao minima disponivel para:
  - rides ativas
  - noDriversFound
  - webhook Woovi atrasado
  - stuck booking

## Gate de piloto

- 1 cidade ativa
- 1 ou 2 categorias homologadas
- 2 motoristas homologados e validados
- 2 passageiros de teste confirmados
- saque operado manualmente fora do app
- convites desativados
- dashboard usado em modo observacao/operacao minima

## Janela de ativacao

- Code freeze aplicado
- Rerun curto dos P0 concluido no mesmo build
- Credenciais e env reais conferidos
- Time de operacao com canal de comunicacao pronto
- Janela inicial de monitoramento: 2 a 4 horas

## Regras de NO-GO imediato

- qualquer bug P0 sem mitigacao
- pagamento duplicado ou charge inconsistente
- ride zumbi ou stuck booking
- reconnect nao deterministico em corrida ativa
- geofence permitindo dispatch indevido
- motorista ficando online fora das regras de KYC/ativacao
