# Soft Release Runbook - Zona Sul - 2026-04-09

## Objetivo
Abrir a operação da Zona Sul com oferta suficiente para sustentar até `250` corridas simultâneas com qualidade aceitável no stack ativo atual rodando na Contabo.

Infra base:
- host: Contabo principal, definido pelos segredos operacionais
- endpoint ativo:
  - `https://api.leaf.app.br`
  - `https://socket.leaf.app.br`

## O Que Foi Validado
### Cenário saturado: `250` corridas simultâneas com `250` motoristas
Referência:
- [contabo-headroom-250-simultaneous-long-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-250-simultaneous-long-20260409.json)

Resultado:
- `readyDrivers: 250`
- `connectedPassengers: 320`
- `peak target: 250`
- `peak avg active: 236.08`
- `peak max active: 250`
- `peak targetHitPct: 94.43%`
- `failedStarts: 7`
- `failedCompletes: 2`
- `peak bookingToDispatch p95: 21984 ms`
- `emptyWaveAttemptCount: 77`

Leitura:
- o sistema consegue chegar em `250/250`
- mas esse desenho é saturado
- a cauda de dispatch abre demais
- não deve ser usado como baseline saudável

### Cenário operacional: `250` corridas simultâneas com `300` motoristas
Referência:
- [contabo-headroom-250-simultaneous-drivers300-v4-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-250-simultaneous-drivers300-v4-20260409.json)

Resultado:
- `readyDrivers: 300`
- `connectedPassengers: 320`
- `failedStarts: 0`
- `failedCompletes: 0`
- `completionRate: 100%`
- `createBooking p95: 895 ms`
- `bookingToDispatch p95: 742 ms`
- `acceptRide p95: 1072 ms`
- `peak max active: 250`
- `peak targetHitPct: 84.90%`
- `emptyWaveAttemptCount: 0`

Leitura:
- já é cenário operacional bom
- o sistema zera falhas de start e complete
- a latência de dispatch volta para patamar saudável

### Cenário operacional com folga extra: `250` corridas simultâneas com `350` motoristas
Referência:
- [contabo-headroom-250-simultaneous-drivers350-v1-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-250-simultaneous-drivers350-v1-20260409.json)

Resultado:
- `readyDrivers: 349`
- `connectedPassengers: 320`
- `failedStarts: 0`
- `failedCompletes: 0`
- `completionRate: 100%`
- `createBooking p95: 989 ms`
- `bookingToDispatch p95: 1248 ms`
- `acceptRide p95: 1411 ms`
- `peak max active: 250`
- `peak targetHitPct: 84.22%`
- `topErrors: driver_connect_or_auth_failed = 1`
- `emptyWaveAttemptCount: 0`

Leitura:
- também sustenta `250`
- entrega folga melhor de oferta
- tolera um ruído pequeno de bootstrap sem degradar a operação

## Decisão Recomendada
Abrir com:
- `350` motoristas liberados na Zona Sul controlada

Racional:
- `250` motoristas sustentam `250` rides só no limite
- `300` já ficam bons
- `350` dão margem extra para absorver variação de oferta, readiness e concentração espacial

## Faixas Operacionais
### Verde
- `corridas ativas <= 200`
- `createBooking p95 <= 1.5 s`
- `bookingToDispatch p95 <= 2 s`
- `acceptRide p95 <= 2 s`
- `failedStarts = 0`
- `completionRate >= 99%`

Leitura:
- operação confortável
- pode manter abertura normal

### Amarelo
- `corridas ativas entre 200 e 230`
- `createBooking p95 entre 1.5 s e 3 s`
- `bookingToDispatch p95 entre 2 s e 5 s`
- `failedStarts` pontuais

Leitura:
- continuar operando
- congelar nova expansão
- monitorar concentração por subárea

### Vermelho
- `corridas ativas > 230` por período sustentado
- `createBooking p95 > 3 s`
- `bookingToDispatch p95 > 5 s`
- `failedStarts` recorrentes
- `completionRate < 99%`

Leitura:
- pausar expansão imediatamente
- entrar em contenção
- decidir se reduz oferta aberta ou se prepara aumento de capacidade

## Plano de Abertura
### Etapa 1
- liberar `100` motoristas
- observar `30-60 min`

Critérios para seguir:
- sem falhas anormais de login
- `failedStarts = 0`
- dispatch estável

### Etapa 2
- subir para `200` motoristas
- observar `30-60 min`

Critérios para seguir:
- `bookingToDispatch p95` continua baixo
- `createBooking p95` continua baixo
- oferta distribuída sem bolsões secos

### Etapa 3
- subir para `350` motoristas
- manter esta wave como baseline inicial

Critérios de manutenção:
- operação continua verde ou amarelo leve
- sem crescimento consistente de cauda

## Checklist Pré-Abertura
1. Confirmar health:
   - `https://api.leaf.app.br/health`
2. Confirmar containers `healthy`:
   - `leaf-websocket`
   - `leaf-nginx`
   - `leaf-redis`
   - `leaf-sideeffects-worker`
   - `leaf-billing-worker`
3. Confirmar pool operacional:
   - motoristas realmente online e prontos
   - não apenas logados
4. Confirmar que não há backlog operacional incomum:
   - dispatch
   - retries de pagamento
   - falhas de readiness
5. Confirmar observabilidade mínima:
   - corridas ativas
   - p95 de `createBooking`
   - p95 de `bookingToDispatch`
   - p95 de `acceptRide`
   - `failedStarts`

## O Que Monitorar Durante a Wave
- corridas ativas simultâneas
- motoristas prontos
- ocupação por subárea
- `createBooking p95`
- `bookingToDispatch p95`
- `acceptRide p95`
- `failedStarts`
- `completionRate`
- quantidade de corridas sem aceite ou com expansão longa

## Quando Aumentar
Subir para a próxima wave só depois de pelo menos um bloco real consistente em que:
- `failedStarts` fique zerado ou praticamente zerado
- `completionRate` fique `>= 99%`
- `bookingToDispatch p95` continue em patamar verde ou amarelo leve
- a frota continue com folga operacional

## Plano de Expansão
### De `350` para `450`
Fazer quando:
- a região controlada estabilizar
- pico real ficar abaixo de `200-220` ativas na maior parte do tempo
- sem crescimento consistente de cauda

Meta técnica:
- rerodar prova de `250 simultâneas` com pool maior apenas para confirmar folga

### De `450` para `600`
Fazer quando:
- houver demanda consistente acima da capacidade confortável da wave atual
- a equipe quiser absorver mais pico sem entrar em amarelo com frequência

Meta técnica:
- revisar se o envelope real desejado começa a se aproximar de `300+` corridas ativas
- se sim, já preparar expansão de infraestrutura

## Quando Fazer Upgrade de Infra
Prepare upgrade quando qualquer uma destas virar realidade:
- `250+` corridas ativas sustentadas com frequência
- a operação pedir envelope confortável acima de `250`
- a cauda de dispatch voltar a crescer de forma recorrente
- o release sair da Zona Sul controlada para área maior sem aumento proporcional de oferta

Próximo passo honesto de infraestrutura:
1. host maior com mais vCPU reais
2. ou segundo host realtime em outra VPS

## Recomendação Final
Hoje:
- `GO` para soft release com `350` motoristas na Zona Sul controlada

Guardrail:
- tratar `250` corridas simultâneas como teto operacional validado da wave
- não como baseline infinito de conforto

Melhor leitura:
- `350` é um ponto inicial saudável para abrir
- `300` já funcionaria
- `250` funciona no limite, mas não deve ser o desenho escolhido
