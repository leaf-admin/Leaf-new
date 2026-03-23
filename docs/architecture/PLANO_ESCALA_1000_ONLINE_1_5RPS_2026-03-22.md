# Plano de Escala - 1000+ Online e >1.5 Corridas/s

**Data:** 2026-03-22  
**Ambiente alvo:** VPS atual (`2 vCPU / 8GB RAM`, backend + redis em docker)  
**Objetivo:** elevar capacidade estável para:
- `>= 1000` usuários online simultâneos (motoristas + passageiros)
- `>= 1.5` corridas completas por segundo com taxa de sucesso alta e previsível

---

## 1) Baseline observado (estado atual)

- Presença online:
  - `800` online: sucesso de conexão/autenticação `100%`
  - `1000` online: sucesso `91.2%`
  - `1200` online: sucesso `76.33%`
- Corridas completas:
  - cenário médio: ~`0.97` corridas/s
  - acima disso surgem timeouts de `newRideRequest` (gargalo de dispatch sob burst)

---

## 2) Causa raiz dominante

O principal gargalo para throughput de corrida completa não é CPU bruta isolada, e sim:
- latência/instabilidade no caminho de **dispatch** (`booking -> seleção -> envio newRideRequest`)
- acoplamento excessivo entre hot-path da corrida e tarefas secundárias
- ausência de proteção forte de backpressure por estágio

---

## 3) Entrega crítica (ordem obrigatória)

## Fase A - Dispatch determinístico (P0)

1. Criar pipeline único de seleção de motorista elegível com índice quente no Redis.
2. Tornar claim do motorista **atômico** por booking (Lua/CAS), mantendo regra de 1 vencedor.
3. Separar claramente:
   - hot-path: `createBooking -> dispatch -> accept`
   - side-path: recibo, analytics detalhado, notificações secundárias
4. Definir timeout de dispatch curto por wave com retry progressivo (sem bloquear thread principal).

**Aceite da fase A**
- timeout de `newRideRequest` abaixo de `5%` no cenário de 60 corridas/30 concorrência
- p95 de dispatch abaixo de `800ms` no mesmo cenário

## Fase B - Desacoplamento de tarefas pesadas (P0)

1. Mover para worker assíncrono:
   - geração de recibo/PDF
   - persistências não críticas para decisão de corrida
   - notificações não bloqueantes
2. Garantir idempotência por `bookingId` em cada job.
3. Implementar DLQ simples com reprocessamento manual.

**Aceite da fase B**
- `completeTrip` não bloqueia resposta do socket por tarefas secundárias
- p95 de `completeTrip` reduzido em pelo menos `25%`

## Fase C - Backpressure e limites de segurança (P0)

1. Limitar concorrência por estágio:
   - autenticação
   - createBooking
   - dispatch
   - start/complete
2. Fila curta por usuário e rejeição amigável quando saturado.
3. Rate limiting com janela curta para picos artificiais.

**Aceite da fase C**
- ausência de degradação em cascata (sem explosão de timeout em onda)
- taxa de erro global < `3%` no cenário-alvo

## Fase D - Socket scaling no mesmo host (P1)

1. Ajustar `ulimit`/`nofile` do container e host.
2. Ajustar opções de Socket.IO (ping interval/timeout e buffer).
3. Ativar processo adicional do backend (modo cluster/PM2) com sticky adequado.

**Aceite da fase D**
- `>=1000` conexões online sustentadas com sucesso > `97%`
- estabilidade de conexão por 10 minutos contínuos

---

## 4) Mudanças de configuração recomendadas (produção)

- `UV_THREADPOOL_SIZE=32`
- `NODE_OPTIONS=--max-old-space-size=2048`
- conexão Redis com pool controlado + keepalive
- timeouts explícitos por operação (sem waits indefinidos)
- `DEBUG` desligado em produção

---

## 5) SLOs e alarmes obrigatórios

- Dispatch timeout rate (`newRideRequest`) > `3%` por 5 min -> alerta crítico
- p95 `createBooking->newRideRequest` > `1200ms` -> alerta alto
- taxa de queda de conexão websocket > `2%` por 5 min -> alerta alto
- CPU > `80%` por 10 min ou memória > `75%` por 10 min -> alerta capacidade

---

## 6) Plano de validação (sem mock)

1. **Race condition**
   - competição de aceite: 12 drivers x 12 rodadas
   - esperado: sempre 1 aceite vencedor
2. **Presença online**
   - degraus: 800 -> 1000 -> 1200
   - hold mínimo 10s por degrau
3. **Corrida completa**
   - degraus: 40/20, 60/30, 80/40
   - medir sucesso, p95 dispatch e corridas/s

Scripts:
- `tmp/socket-presence-capacity-vps.cjs`
- `tmp/capacity-fullflow-vps.cjs`
- `tmp/leaf_full_flow_check.cjs`

---

## 7) Meta de saída (Go/No-Go)

**Go para escala maior somente se:**
- presença online `>= 1000` com sucesso `>= 97%`
- corridas completas `>= 1.5/s` com sucesso `>= 90%`
- dispatch timeout `< 3%`
- sem regressão no fluxo crítico (create -> accept -> start -> complete)

**No-Go se qualquer item acima falhar em 2 execuções consecutivas.**

---

## 8) Próxima execução prática (ordem)

1. Implementar Fase A (dispatch determinístico)  
2. Implementar Fase B (desacoplamento de side-effects)  
3. Rodar validação em degraus  
4. Aplicar Fase C e D apenas se ainda necessário para bater alvo

