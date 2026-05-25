# Fase 1 - Runtime Validation

Data: 2026-03-25  
Ambiente validado: VPS DigitalOcean (`api.147.182.204.181.sslip.io` / `socket.147.182.204.181.sslip.io`)  
Usuários canônicos:
- Passageiro `11999999999` -> `OjML1wSzdNRaynjqMRlSW1Y0LVy2`
- Motorista `11888888888` -> `8vg2kxxqi3TYKlpD6eBlWgYseIq2`

## Escopo executado

1. Health e reachability da VPS
2. Auth WebSocket com usuários reais
3. Driver online/offline e `onlineRedis`
4. Pagamento antecipado (`/api/payment/advance`)
5. `createBooking` + dispatch + `newRideRequest`
6. `acceptRide` + `startTrip` + `completeTrip`
7. Reconnect com `syncActiveRide`
8. Validação da source of truth de role em RTDB/Firestore e no app

## Resultado resumido

- `PASS`: health HTTP/Redis/Firebase/WebSocket na VPS
- `PASS`: usuários canônicos existem e estão com role correta em RTDB/Firestore
- `PASS`: no host `socket...`, auth WebSocket, `setDriverStatus`, dispatch, aceite, início, conclusão e reidratação passaram
- `PASS`: bypass controlado de pagamento está ativo para o passageiro de teste
- `PASS`: `createBooking` sem pagamento prévio agora retorna `PAYMENT_REQUIRED` na VPS
- `PASS`: o `server.vps.js` servido no container foi alinhado ao arquivo local do workspace
- `PASS`: smoke de supersedência/rebooking passou após alinhar o teste ao contrato atual de pagamento antecipado
- `PASS`: configs móveis agora blindam o host de WebSocket para `socket...`, inclusive se o ambiente vier com `EXPO_PUBLIC_WS_URL` vazio ou apontando indevidamente para `api...`
- `PASS`: smokes oficiais da Fase 1 foram alinhados para `WS_URL=https://socket...` e para o contrato real de `POST /api/payment/advance`

## Evidências

### 1. Health da VPS

`GET https://api.147.182.204.181.sslip.io/health`

Resultado:
- status `healthy`
- Redis `healthy`
- Firestore `healthy`
- Realtime DB `healthy`
- WebSocket `healthy`

### 2. Role source real dos usuários de teste

Validação direta em RTDB e Firestore:

- Passageiro:
  - `usertype=customer`
  - `userType=customer`
  - `approved=true`
- Motorista:
  - `usertype=driver`
  - `userType=driver`
  - `approved=true`
  - `status=approved`

No app, a resolução de role hoje está alinhada com esse contrato:
- [AppNavigator.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js:427)
- [prototypeRideRuntime.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js:1905)

### 3. WebSocket: host correto vs host incorreto

Smoke com `WS_URL=https://api.147.182.204.181.sslip.io`:
- falhou com `Timeout ao autenticar` ou `STATUS_TIMEOUT` no `setDriverStatus`

Smoke com `WS_URL=https://socket.147.182.204.181.sslip.io`:
- auth ok
- `driver_online` ok
- `onlineRedis=true`
- dispatch ok

Conclusão:
- o runtime/smoke precisa usar `socket...` como host de WebSocket
- apontar socket para `api...` hoje é risco operacional real

Arquivos relevantes:
- [NetworkConfig.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/NetworkConfig.js:5)
- [WebSocketConfig.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/WebSocketConfig.js:4)
- [WebSocketManager.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/WebSocketManager.js:174)

### 4. Pagamento antecipado

`POST /api/payment/advance` retornou:
- `success=true`
- `bypass=true`
- `bypassReason=force_bypass_enabled`

Isso confirma que o ambiente de teste atual não exige Pix real para o passageiro canônico usado na validação.

### 5. Smoke runtime ponta-a-ponta

Foi executado um harness técnico controlado com:
- auth passageiro
- auth motorista
- online do motorista
- payment advance
- `createBooking`
- `newRideRequest`
- `acceptRide`
- `startTrip`
- reconnect passageiro
- reconnect motorista
- `syncActiveRide`
- `completeTrip`

Passes confirmados:
- `socket_connect`
- `socket_auth`
- `driver_online`
- `payment_advance`
- `create_booking_paid`
- `driver_received_offer`
- `accept_ride`
- `start_trip`
- `passenger_sync_active_ride_after_reconnect`
- `driver_sync_active_ride_after_reconnect`
- `complete_trip`

O `tripCompleted` retornou breakdown financeiro final no payload:
- `operationalFee`
- `paymentIntermediationFee`
- `totalFees`
- `driverNetAmount`

### 6. Lock de pagamento prévio validado após deploy alinhado

Na primeira rodada da Fase 1 houve drift de deploy: a VPS estava servindo um `server.vps.js` diferente do workspace, então o guard de pagamento prévio não estava ativo.

Após alinhar o arquivo da VPS e recriar o container, a bateria foi rerodada e o estágio:
- `create_booking_without_payment_blocked`

passou com o retorno esperado:
- evento `bookingError`
- `code=PAYMENT_REQUIRED`
- mensagem `Finalize o pagamento PIX antes de solicitar a corrida.`

Guard validado em:
- [server.vps.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.vps.js:4309)

### 7. Drift de deploy corrigido na VPS

O container agora está rodando o mesmo `server.vps.js` do workspace:

- local sha256:
  - `f4edf220018e8c7255b3049135d661e923452dc4e4c093d1597680230ec2d128`
- remoto sha256 depois do rebuild:
  - `f4edf220018e8c7255b3049135d661e923452dc4e4c093d1597680230ec2d128`

Conclusão objetiva:
- a paridade local vs VPS foi restabelecida
- o lock de pagamento prévio agora está ativo no ambiente real validado

### 8. Supersedência e rebooking

O smoke legado de supersedência falhou inicialmente porque ainda gerava `chargeId` fictício localmente. Isso ficou incompatível com a regra atual de pagamento antecipado validado pelo backend.

O script foi alinhado para chamar `POST /api/payment/advance` antes de cada `createBooking`, e a validação passou:
- primeiro booking: ack `853ms`
- segundo booking supersedente: ack `442ms`
- segundo `newRideRequest` no motorista: `464ms`

Script alinhado:
- [supersede-rebooking-smoke.cjs](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/tests/supersede-rebooking-smoke.cjs)

### 9. Hardening de WebSocket no mobile e nos smokes oficiais

Os pontos oficiais que ainda podiam cair no host `api...` como WebSocket foram endurecidos:

- [NetworkConfig.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/NetworkConfig.js)
- [WebSocketConfig.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/WebSocketConfig.js)
- [ApiConfig.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/ApiConfig.js)
- [ApiConfig.cjs](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/ApiConfig.cjs)
- [preflight-dual-ios-vps.sh](/Users/izaakdias/Documents/Leaf-new/mobile-app/scripts/qa/preflight-dual-ios-vps.sh)
- [smoke-driver-ready-booking.cjs](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/tests/smoke-driver-ready-booking.cjs)
- [measure-new-ride-request-latency.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/tests/measure-new-ride-request-latency.js)
- [measure-new-ride-request-latency-stable-driver.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/tests/measure-new-ride-request-latency-stable-driver.js)
- [batch-new-ride-request-latency.js](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/tests/batch-new-ride-request-latency.js)

Validações executadas:
- `ApiConfig.cjs` retorna `https://socket.147.182.204.181.sslip.io` mesmo quando:
  - só `EXPO_PUBLIC_API_URL` está definido
  - `EXPO_PUBLIC_WS_URL` vem errado apontando para `https://api...`
- smoke oficial `smoke-driver-ready-booking.cjs` passou na VPS com:
  - `onlineRedis=true`
  - dois bookings sequenciais entregando oferta ao motorista
  - `WS_URL=https://socket.147.182.204.181.sslip.io`

## Achados priorizados

### P1 residual

1. Scripts ad hoc e temporários fora da trilha oficial ainda podem existir com defaults antigos
- Impacto: baixo para release, mas pode gerar falso diagnóstico manual no futuro
- Mitigação: os scripts oficiais de regressão da Fase 1 já foram corrigidos; eventuais `tmp/*` e testes exploratórios devem ser alinhados sob demanda

## Status da Fase 1

Situação atual:
- Runtime principal de corrida e reconnect: `validado`
- Role source: `validado`
- Breakdown financeiro no fluxo de corrida: `validado`
- Lock de pagamento prévio: `validado`
- Paridade local vs VPS: `validada`
- Supersedência/rebooking: `validado`
- Blindagem de WebSocket no mobile e nos smokes oficiais: `validada`

## Próxima ação recomendada

1. seguir para a revisão funcional/manual da Fase 2
2. manter a bateria técnica atual como smoke padrão de regressão da VPS
3. alinhar scripts exploratórios fora da trilha oficial apenas quando forem reutilizados
