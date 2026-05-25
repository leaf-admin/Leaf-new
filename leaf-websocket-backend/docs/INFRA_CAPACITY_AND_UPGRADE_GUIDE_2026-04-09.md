# Infra Capacity And Upgrade Guide

## Resumo Executivo
Hoje a Contabo atual está em um ponto bom para operação do stack ativo.

Leitura prática:
- `250`: forte
- `300`: com margem
- `400`: limpo
- `600`: forte
- `800`: viável sem colapso, mas ainda abaixo de `100%` de sustentação de pico

O limitador que sobrou não é memória.
Também não é Redis.
O limitador real no topo do envelope atual é **CPU total do host realtime**.

## Infra Atual
- Host: `62.169.31.231`
- Plano: `6 vCPU`, `~11.7 GiB RAM`
- endpoint ativo:
  - `https://api.62.169.31.231.sslip.io`
  - `https://socket.62.169.31.231.sslip.io`

Runtime ativo validado:
- `leaf-websocket`: `5.50 CPUs`, `6 GiB`
- `leaf-redis`: `2.00 CPUs`, `3 GiB`
- `leaf-sideeffects-worker`: `1.25 CPU`, `2 GiB`
- `leaf-billing-worker`: `1.00 CPU`, `1.25 GiB`

## Pico Atual Confirmado
Melhor leitura forte e limpa do envelope atual:

### `400`
Referência:
- [contabo-headroom-400-long-sslip-retune-v5-wavewait-harnessmax-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-400-long-sslip-retune-v5-wavewait-harnessmax-20260409.json)

Resultado:
- `80/80` completadas
- `failedStarts: 0`
- `createBooking p95: 828ms`
- `bookingToDispatch p95: 1433ms`
- `acceptRide p95: 1082ms`
- `peak avg active: 68.52 / 80`
- `peak max active: 80 / 80`
- `peak targetHitPct: 85.65%`
- `emptyWaveAttemptCount: 0`

### `600`
Referência:
- [contabo-headroom-600-long-sslip-retune-v1-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-600-long-sslip-retune-v1-20260409.json)

Resultado:
- `120/120` completadas
- `failedStarts: 0`
- `createBooking p95: 951ms`
- `bookingToDispatch p95: 2750ms`
- `acceptRide p95: 1592ms`
- `peak avg active: 97.99 / 120`
- `peak max active: 120 / 120`
- `peak targetHitPct: 81.66%`

### `800`
Melhor `single-node` atual:
- [contabo-headroom-800-long-sslip-retune-v3-bootstrapmax-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-800-long-sslip-retune-v3-bootstrapmax-20260409.json)

Resultado:
- `160/160` completadas
- `failedStarts: 0`
- `createBooking p95: 1380ms`
- `bookingToDispatch p95: 2435ms`
- `acceptRide p95: 1689ms`
- `peak avg active: 124.98 / 160`
- `peak max active: 160 / 160`
- `peak targetHitPct: 78.11%`

## O Que O “Pico Atual” Significa
Se a pergunta for “qual é o maior envelope que a infra atual segura sem colapso?”:
- hoje a resposta é `800`, com `0` falhas de start e `100%` de completion

Se a pergunta for “qual é o maior envelope que a infra atual segura com folga operacional boa?”:
- hoje a resposta conservadora é `400`
- e `600` já é forte, mas com menos folga de sustentação que `400`

## Quando Fazer Upgrade Da VPS Atual
Faça upgrade da VPS atual quando você quiser qualquer uma destas metas:

1. `800` com `targetHitPct >= 90%`
2. headroom real acima de `800`
3. mais folga para bursts de conexão/auth sem depender de ramp-up cuidadoso
4. mais segurança para manter dashboard/ops e realtime no mesmo cluster operacional

Na prática, o gatilho técnico mais honesto é:
- se `800` virar meta operacional frequente
- ou se `600` precisar virar “padrão confortável” e não só “passa forte”

## O Que Dizem As Métricas
Durante `800`, os sinais foram:
- realtime CPU no limite do host
- Redis saudável
- memória longe de saturação

Resumo observado:
- `leaf-websocket`: `~654% CPU`, `~1.95 GiB / 6 GiB`
- `leaf-redis`: `~70% CPU`, `~53 MiB / 3 GiB`
- `leaf-sideeffects-worker`: pico alto, mas não limitador principal

Leitura:
- **RAM não pede upgrade**
- **Redis não pede upgrade**
- **CPU total do host pede upgrade/topologia nova**

## Qual Ganho Esperar Do Upgrade
### Opção A — VPS maior, mesmo desenho
Se subir para uma VPS com mais vCPU reais, o ganho esperado é:
- melhor `targetHitPct` em `800`
- menor `bookingToDispatch p95` no topo
- menos disputa entre handshake/auth/realtime/dispatch

Ganho esperado:
- `800` deve sair da faixa atual de `~78%` para algo mais perto de `85%+`
- ainda assim, não é garantia automática de `100%`, porque parte do ganho também depende de topologia e da rampa do cenário

### Opção B — segundo host realtime
Esse é o melhor ganho por arquitetura.

Ganho esperado:
- aliviar CPU do gateway principal
- repartir handshake/auth/socket fan-out
- preservar Redis central
- aumentar a chance de `800` ficar perto de `90%+`

### Opção C — VPS maior + segundo host realtime
Esse é o caminho para buscar `800` perto de `100%` com honestidade.

## Recomendação
Hoje eu seguiria assim:

1. operar a VPS atual como base oficial
2. tratar `400` como envelope muito confortável
3. tratar `600` como envelope forte
4. se `800` precisar virar meta real de operação, fazer um destes:
   - subir para host maior
   - ou adicionar segundo host realtime

## Decisão Rápida
- quer estabilidade ótima até `400/600`:
  - pode ficar na VPS atual
- quer `800` com folga real:
  - faça upgrade de CPU/topologia
- quer perseguir `100%` em `800`:
  - considere **segundo host realtime ou VPS maior**
