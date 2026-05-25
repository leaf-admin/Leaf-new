# Pilot Controlled Launch Hour Runbook

Data: 2026-04-06
Objetivo: abrir a primeira janela assistida do piloto controlado com a menor superfície de risco possível.

## Estado atual

- Produto: `GO_CANDIDATE`
- Tracker P0: verde
- Preflight: verde
- Deep check: verde
- Mitigação ativa no host:
  - `leaf-pricing-baseline-worker` pausado

## Comando único recomendado

```bash
WINDOW_MINUTES=15 INTERVAL_SECONDS=15 bash /Users/izaakdias/Documents/Leaf-new/scripts/validation/run-pilot-launch-hour.sh
```

Esse comando:
- roda preflight
- roda deep check
- observa o `/health` por uma janela curta
- devolve um relatório único de `GO` ou `HOLD`

## Sequência operacional

### T-15 minutos

1. Confirmar que o `pricing-baseline-worker` continua parado no host atual.
2. Rodar o comando de launch-hour curta.
3. Conferir o relatório gerado em `reports/pilot-launch-hour/.../summary.md`.

### T-10 minutos

1. Confirmar:
   - 2 motoristas homologados online
   - 2 passageiros de teste disponíveis
   - canal operacional aberto
2. Relembrar o time:
   - saque fica fora do app
   - convites continuam desligados
   - qualquer anomalia de pagamento vira contingência imediata

### T-0

1. Abrir a praça/categorias homologadas.
2. Manter acompanhamento ao vivo com:

```bash
bash /Users/izaakdias/Documents/Leaf-new/scripts/validation/watch-pilot-health.sh https://api.147.182.204.181.sslip.io
```

3. Acompanhar:
   - `/health`
   - rides ativas
   - `noDriversFound`
   - webhook Woovi
   - stuck booking

## Critério de continuidade

Manter a janela aberta se:
- `/health` permanecer `200`
- `health` permanecer em `healthy` ou `warning`
- `system` não voltar para `critical`
- rides estiverem completando
- não houver charge duplicado
- não houver ride zumbi

## Critério de pausa imediata

Pausar a janela se ocorrer qualquer um destes:
- `/health` voltar para `503`
- `system=critical` em amostras repetidas
- pagamento duplicado
- stuck booking
- dispatch indevido para motorista inelegível
- reconnect quebrando corrida ativa

## Runbooks relacionados

- checklist de go/no-go:
  - [PILOT_CONTROLLED_GO_CHECKLIST_2026-04-05.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_GO_CHECKLIST_2026-04-05.md)
- rollback:
  - [PILOT_CONTROLLED_ROLLBACK_RUNBOOK_2026-04-05.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_ROLLBACK_RUNBOOK_2026-04-05.md)
- blocker operacional e mitigação:
  - [PILOT_CONTROLLED_LIVE_BLOCKER_2026-04-06.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_LIVE_BLOCKER_2026-04-06.md)
