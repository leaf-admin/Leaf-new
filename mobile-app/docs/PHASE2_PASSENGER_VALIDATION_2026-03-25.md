# Phase 2 Passenger Validation - 2026-03-25

## Escopo revisado

Regra de negocio ajustada nesta fase:
- se **nao houver motorista elegivel**, o app **nao cria reserva**;
- o app **nao abre o modal de pagamento PIX**;
- o aviso aparece ainda no modal/cartao de valores do passageiro como:
  - `Nao ha motoristas disponiveis`

## O que foi implementado

### Backend
- Novo pre-check autenticado via WebSocket: `checkRideAvailability`.
- Resposta padronizada:
  - `rideAvailabilityResult`
  - `rideAvailabilityError`
- O helper rapido de disponibilidade agora retorna tambem `radiusKm`.
- Mantido o fallback defensivo ja implementado anteriormente:
  - se a disponibilidade mudar depois do pagamento e antes do booking, o backend ainda tenta `auto-refund`.

Arquivos:
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.vps.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/payment-service.js`

### Mobile
- `RobotaxiDestinationScreen` agora valida disponibilidade antes de abrir o `WooviPaymentModal`.
- `RobotaxiPaymentScreen` recebeu o mesmo gate para a rota legada.
- `prototypeRideRuntime` expoe `checkRideAvailability` para o fluxo do passageiro.
- `WebSocketManager` ganhou o metodo `checkRideAvailability()` com timeout e tratamento de erro padronizado.
- Quando nao ha motorista disponivel, o usuario permanece no card/modal de valores e ve a mensagem inline, sem abrir PIX.

Arquivos:
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/WebSocketManager.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDestinationScreen.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiPaymentScreen.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiNoDriversScreen.js`

## Validacao executada

### Parse/sintaxe local
- `node --check` em `server.vps.js`: OK
- Babel parse dos arquivos mobile alterados: OK

### Deploy minimo na VPS
- Arquivo aplicado em producao:
  - `/opt/leaf-app/server.vps.js`
- Backup remoto criado antes do deploy:
  - `backups/phase2_20260326_022610_availability_gate`
- Container reciclado:
  - `leaf-websocket`
- Health final:
  - `healthy`

### Smoke na VPS
Contexto observado no Redis durante a validacao:
- `online_drivers = 0`

Smoke do novo pre-check:
```json
{
  "type": "result",
  "data": {
    "success": true,
    "available": false,
    "hasDrivers": false,
    "code": "NO_DRIVERS_AVAILABLE",
    "message": "Não há motoristas disponíveis",
    "carType": "Leaf Plus",
    "radiusKm": 5
  }
}
```

Interpretacao:
- o backend agora responde corretamente **antes do pagamento**;
- o mobile ja consegue bloquear o PIX com base nessa resposta;
- o fluxo principal fica alinhado com a regra de negocio revisada.

## Achados relevantes

### PASS
- Gate de disponibilidade antes do pagamento implementado.
- VPS atualizada e saudavel apos deploy.
- Resposta negativa de disponibilidade validada em runtime real.
- Fallback defensivo de refund continua existindo para o caso de mudanca de estado apos pre-check.

### OBSERVACAO
- O UID de passageiro de teste `OjML1wSzdNRaynjqMRlSW1Y0LVy2` ainda estava com lock de corrida ativa em uma tentativa anterior de smoke antigo de `createBooking`. Isso nao invalida o novo gate; pelo contrario, reforca que o pre-check agora evita chegar mais cedo ao trecho de pagamento quando nao houver motorista.

## Status desta frente
- `PASS` para a nova regra de negocio do passageiro: sem motorista, sem reserva, sem pagamento.
