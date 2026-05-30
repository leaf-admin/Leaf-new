# Fase 3 - Validacao Tecnica do Motorista (2026-03-25)

## Escopo
- Fluxo critico do motorista na VPS real:
  - `home -> online -> oferta -> aceite -> chegada -> inicio -> conclusao -> retorno ao pool -> offline`
- Usuarios de teste oficiais:
  - passageiro `11999999999` -> UID `OjML1wSzdNRaynjqMRlSW1Y0LVy2`
  - motorista `11888888888` -> UID `8vg2kxxqi3TYKlpD6eBlWgYseIq2`
- Backend alvo:
  - API `https://api.147.182.204.181.sslip.io`
  - WS `https://socket.147.182.204.181.sslip.io`

## Hotfixes aplicados
### 1. Maquina de estados canonica com `ARRIVED`
- [ride-state-manager.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/ride-state-manager.js:15)
- Ajustes:
  - adiciona `ARRIVED`
  - troca `ACCEPTED -> IN_PROGRESS` por `ACCEPTED -> ARRIVED`
  - adiciona `ARRIVED -> IN_PROGRESS`

### 2. Lock de `startTrip` antes da chegada
- [StartTripCommand.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/commands/StartTripCommand.js:104)
- Ajuste:
  - se a corrida ainda estiver em `ACCEPTED`, retorna erro explicito:
    - `A corrida só pode ser iniciada após registrar chegada ao embarque.`

### 3. Handler de chegada usando a state machine
- [server.vps.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.vps.js:7561)
- Ajuste:
  - `arrived_at_pickup` passa a gravar `ARRIVED` pela propria `RideStateManager`
  - remove a escrita inconsistente de estado inexistente

### 4. Enriquecimento canonico do payload de `rideAccepted`
- Helper compartilhado: [accept-ride-payload.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/utils/accept-ride-payload.js:1)
- Command: [AcceptRideCommand.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/commands/AcceptRideCommand.js:18)
- Handler websocket: [server.vps.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.vps.js:6001)
- Listener do motorista: [onRideAccepted.notifyDriver.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/listeners/onRideAccepted.notifyDriver.js:1)
- Ajustes:
  - normaliza `pickupLocation`, `destinationLocation`, `estimatedFare`, `driverDistanceToPickupKm` e `estimatedArrivalToPickupMin`
  - garante breakdown estimado no aceite (`estimatedOperationalFee`, `estimatedPaymentIntermediationFee`, `estimatedTotalFees`, `estimatedDriverNetAmount`)
  - alinha command, gateway e listener para o mesmo contrato

## Deploy
- Hotfix publicado na VPS em `/opt/leaf-app`
- Rebuild realizado para `websocket` e `sideeffects-worker`
- Validacao de health concluida apos rebuild

## Harness usado
- Smoke tecnico: [phase3_driver_validation.cjs](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tmp/phase3_driver_validation.cjs)
- O harness agora:
  - faz cleanup automatico de corrida residual dos usuarios de teste
  - valida o bloqueio de `startTrip` antes da chegada
  - exige payload enriquecido em `accept_booking_1_payload_enriched` e `accept_booking_2_payload_enriched`

## Resultado final do rerun
- `PASS` socket connect
- `PASS` auth de passageiro e motorista
- `PASS` cleanup de residual ativo quando existente
- `PASS` `setDriverStatus` online com `onlineRedis=true`
- `PASS` oferta recebida
- `PASS` aceite da oferta
- `PASS` payload enriquecido de `rideAccepted`
- `PASS` `startTrip` bloqueado antes da chegada
- `PASS` chegada ao embarque notificada para passageiro e confirmada para motorista
- `PASS` `startTrip` apos chegada
- `PASS` `tripStarted` para passageiro
- `PASS` `completeTrip`
- `PASS` `tripCompleted` para passageiro
- `PASS` retorno do motorista ao pool apos conclusao
- `PASS` `setDriverStatus` offline com ack coerente

## Evidencia chave
### Lock antes da chegada
```json
{
  "name": "start_before_arrived_blocked",
  "ok": true,
  "event": "tripStartError",
  "payload": {
    "error": "A corrida só pode ser iniciada após registrar chegada ao embarque."
  }
}
```

### Payload enriquecido no aceite
```json
{
  "name": "accept_booking_2_payload_enriched",
  "ok": true,
  "payload": {
    "destinationLocation": {
      "lat": -22.9121,
      "lng": -43.1825
    },
    "estimatedFare": 8.5,
    "driverDistanceToPickupKm": 0.03,
    "estimatedArrivalToPickupMin": 1,
    "estimatedDriverNetAmount": 7.01
  }
}
```

### Retorno ao pool
```json
{
  "name": "driver_returned_to_idle_pool",
  "ok": true
}
```

## Causa raiz adicional identificada
- So recriar container nao bastava para publicar alteracoes de codigo, porque a aplicacao roda a partir da imagem Docker.
- O listener `onRideAccepted.notifyDriver` tambem nao roda no container `websocket`; ele roda no `sideeffects-worker`.
- Por isso, o deploy correto para hotfix de contrato neste fluxo exigiu:
  - copiar codigo para `/opt/leaf-app`
  - rebuild de `websocket`
  - rebuild de `sideeffects-worker`

## Veredito da Fase 3
- `GO` para a trilha tecnica do motorista.
- `P0` fechado.
- `P1` de payload de `rideAccepted` fechado e validado em execucao real na VPS.
- Sem bloqueio residual aberto nesta fase.
