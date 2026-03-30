# Ride Lifecycle Evidence - 2026-03-29

## 1. Backend reports
### Corrida normal
- [normal-ride-smoke-vps-1774753364124.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/normal-ride-smoke-vps-1774753364124.json)

### Extensão + early end
- [ride-lifecycle-smoke-vps-1774753389691.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/ride-lifecycle-smoke-vps-1774753389691.json)

### Interrupção operacional + continuação
- [operational-reassignment-smoke-vps-1774751630780.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/operational-reassignment-smoke-vps-1774751630780.json)

### Custos por janela
- [scenario-service-window-summary-1774753771638.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/scenario-service-window-summary-1774753771638.json)

## 2. Visual evidence
### Passageiro
- Home `iPhone 17 Pro`: ![Passenger home 17 Pro](/tmp/leaf_validation_shots/passenger-17pro-home.png)

### Motorista
- Home `iPhone 16e`: ![Driver home 16e](/tmp/leaf_validation_shots/driver-16e-home.png)
- Aceite / a caminho do embarque: ![Driver accepted](/tmp/leaf-ios-smoke-accepted-after-cache-clear.png)
- Passageiro em embarque: ![Driver arrived](/tmp/leaf_ios_driver_cards_smoke_clean/arrived.png)
- Viagem em andamento: ![Driver started](/tmp/leaf_ios_driver_cards_smoke_clean/started.png)
- Recibo final do motorista: ![Driver receipt](/tmp/leaf-ios-receipt-compact-final-v5.png)

## 3. Limites honestos da evidência visual desta rodada
- As telas do passageiro para `rideExtensionPendingPayment`, `rideOperationalInterruption` e `receipt` ainda não ficaram reproduzíveis por seed automático no iOS Simulator.
- Motivo: o runtime do passageiro reidrata o estado e normaliza a sessão para `idle` durante o boot, sobrescrevendo o seed antes da captura.
- Isso não bloqueou a validação de negócio, porque os contratos e snapshots autoritativos foram provados nos relatórios backend acima.

## 4. Evidência de smoke funcional
### Corrida normal
- `completionType=COMPLETED`
- `authoritativeSnapshot=true`
- `financialSnapshotSource=backend_final`

### Extensão + early end
- extensão confirmada: `CONFIRMED`
- extensão rejeitada: `DRIVER_DECLINED`
- extensão expirada: `EXPIRED`
- early end: `EARLY_ENDED_BY_RIDER`
- refund estimado: `R$ 20,62`

### Reassign operacional
- oferta de continuação recebida pelo motorista 2: `true`
- término da continuação: `COMPLETED`
- `rideLegs=2`
- encerramento sem continuação: `INTERRUPTED_OPERATIONAL_ENDED`
- refund do encerramento: `R$ 27,50`
