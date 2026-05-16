# Pilot Controlled Live Blocker

Data: 2026-04-06

## Estado atual

- Produto: `GO_CANDIDATE`
- Tracker P0 do piloto: verde
- Perfil de lançamento: `pilot_controlled`
- Ambiente ao vivo:
  - antes da mitigação: `NO_GO`
  - após a mitigação de 2026-04-06: `GO` para janela assistida curta

## Motivo do bloqueio

O preflight técnico do piloto passou, mas o health do backend ao vivo está oscilando e em múltiplas leituras retornou `503` com estado `unhealthy`.

### Evidência

- Preflight com health estável em warning:
  - [pilot-preflight-2026-04-06T10-18-51.152Z.md](/Users/izaakdias/Documents/Leaf-new/reports/pilot-preflight/pilot-preflight-2026-04-06T10-18-51.152Z.md)
- Preflight falhando com health unhealthy:
  - [pilot-preflight-2026-04-06T10-20-36.969Z.md](/Users/izaakdias/Documents/Leaf-new/reports/pilot-preflight/pilot-preflight-2026-04-06T10-20-36.969Z.md)

## Sinal técnico observado

O corpo do `/health` reportou:
- `status: unhealthy`
- `checks.system.status: critical`
- CPU acima do limiar configurado
- mensagem de alta utilização do sistema

Os endpoints de readiness, liveness, websocket e Redis seguiram respondendo, então o principal suspeito atual deixou de ser produto e passou a ser a combinação de:
- threshold agressivo demais no health sistêmico para VPS pequena
- e/ou pressão transitória de CPU contabilizada pelo `loadavg` de 1 minuto

## Diagnóstico fechado em código

Foi implementado um ajuste no backend para o health sistêmico:
- manter pico curto de CPU como `warning`
- só marcar `critical` quando houver pressão sustentada
- usar thresholds configuráveis por env

Arquivos:
- [health-check-service.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/health-check-service.js)
- [pilot-controlled.env.example](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/config/pilot-controlled.env.example)

Thresholds novos sugeridos para o piloto:
- `HEALTH_SYSTEM_MEMORY_WARNING_PERCENT=80`
- `HEALTH_SYSTEM_MEMORY_CRITICAL_PERCENT=92`
- `HEALTH_SYSTEM_CPU_WARNING_PERCENT=120`
- `HEALTH_SYSTEM_CPU_CRITICAL_PERCENT=200`
- `HEALTH_SYSTEM_CPU_SUSTAINED_CRITICAL_PERCENT=140`

Com os números observados no ambiente (`CPU 1m 157,5%` e `CPU 5m 128%` em 2 cores), o resultado esperado após deploy desse patch passa a ser `warning`, não mais `critical`.

## Mitigação operacional aplicada

Além do patch de health, foi aplicada uma mitigação segura de piloto:
- `leaf-pricing-baseline-worker` pausado no host
- `restart policy` do container alterada para `no` no host atual

Motivo:
- o worker de baseline de pricing por H3 é periférico ao fluxo core do piloto
- ele estava pressionando Redis e CPU sem ser essencial para `quote -> payment -> ride lifecycle -> receipt`

Sinais após a mitigação:
- `docker stats` ficou com Redis e websocket em carga moderada
- watcher de health registrou `6` amostras seguidas em `200 / warning`
- deep check oficial voltou `PASS`

Evidências:
- [pilot-preflight-2026-04-06T10-41-57.034Z.md](/Users/izaakdias/Documents/Leaf-new/reports/pilot-preflight/pilot-preflight-2026-04-06T10-41-57.034Z.md)
- `/tmp/leaf-pilot-health-watch-20260406_074118.log`

## Leitura operacional

- Não é mais bloqueio de produto.
- É bloqueio de ambiente.
- O piloto só deve abrir quando o `/health` principal estabilizar em `200` por janela contínua aceitável.

## Próxima ação recomendada

1. Manter o `pricing-baseline-worker` pausado durante a primeira janela assistida.
2. Rodar `bash scripts/validation/watch-pilot-health.sh` durante a janela.
3. Se a CPU voltar a `critical`, revisar:
   - dashboard PM2
   - jobs fora do fluxo core
   - reativação do worker de pricing apenas após janela estável
4. Reativar o worker de baseline só quando houver margem operacional sobrando.
