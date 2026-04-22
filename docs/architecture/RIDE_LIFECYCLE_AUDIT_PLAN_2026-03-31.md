# Plano De Auditoria Total Do Ciclo De Vida Da Corrida

**Data:** 31/03/2026
**Escopo:** `prototype` atual, runtime oficial `VPS + Redis + Firestore + mobile prototype`

## Objetivo

Parar de validar a corrida apenas pelo backend e passar a validar o produto como um sistema único:

1. cadastro e autenticação de passageiro e motorista
2. ativação e prontidão operacional do motorista
3. cotação, pagamento e criação de booking
4. despacho e aceite
5. chegada, início e execução da viagem
6. finalização, recibo e avaliação
7. telas acompanhando cada transição real do backend

## Regra De Gate

Nenhum novo teste E2E com screenshot vale como evidência final se qualquer um destes itens ainda estiver pendente:

- contrato backend -> socket -> runtime -> navegação não auditado
- falta de teste unitário nos serviços críticos do estágio
- falta de teste de integração do contrato do estágio
- fallback local mascarando estado autoritativo do backend
- tela do `prototype` sem sincronização com o evento real correspondente

## Linha Do Tempo Canônica

### Fase 0. Cadastro E Autenticação

**Passageiro**
- UI:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/AuthFlow.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/PhoneInputStep.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/OTPStep.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/ProfileSelectionStep.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/ProfileDataStep.js`
- Serviços mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/AuthService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/UserAuthService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/runtime/registrationRuntimeBridge.js`
- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/routes/auth-routes.js`

**Motorista**
- Mesmo tronco de autenticação acima, com trilha complementar:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/DocumentStep.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/CredentialsStep.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/DriverEmailStep.js`

**Critério**
- sessão persistida localmente
- `uid` coerente entre Firebase Auth, Redux e runtime prototype
- perfil com `userType/usertype` consistente

## Fase 1. Ativação Do Motorista

- UI:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverActivationScreen.js`
- Runtime:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/DriverActivationService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/DriverOnboardingService.js`
- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/routes/driver-activation.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/driver-document-analysis-queue.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/driver-application-service.js`

**Contrato operacional**
- `canGoOnline` precisa ser derivado de documento, aplicação e status remoto
- o runtime não pode fingir `online` quando o backend negar ativação

## Fase 2. Motorista Online E Hot State

- Mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/WebSocketManager.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/home/DriverHomeOverlay.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js`
- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-driver-control-handlers.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-update-location-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/driver-eligibility-service.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.vps.js`

**Contrato operacional**
- `setDriverStatus` e `updateLocation` precisam materializar estado quente coerente
- categoria do carro deve vir do veículo ativo aprovado, não de campo stale do usuário
- `driver_locations_eligible` e perfil de elegibilidade precisam permanecer coerentes

## Fase 3. Cotação, PIX E Booking

- UI passageiro:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDestinationScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiBookingScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiPaymentScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/payment/WooviPaymentModal.js`
- Runtime:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/runtime/pricingQuoteService.js`
- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-create-booking-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-confirm-payment-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/commands/RequestRideCommand.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/fare-estimation-service.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/payment-service.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/payment-dispatch-service.js`

**Contrato operacional**
- quote e booking precisam usar fare server-authoritative
- `paymentConfirmed` não pode virar “sucesso visual” sem booking consistente
- booking criado precisa entrar em `SEARCHING` com snapshot autoritativo

## Fase 4. Dispatch E Aceite

- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/driver-notification-dispatcher.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/gradual-radius-expander.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-accept-ride-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/commands/AcceptRideCommand.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/driver-lock-manager.js`
- UI motorista:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverOfferScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js`
- Runtime:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/WebSocketManager.js`

**Contrato operacional**
- `newRideRequest` deve chegar ao motorista online elegível
- busca não pode expandir/cancelar cedo demais enquanto houver motorista notificado aguardando resposta
- `rideAccepted` precisa atualizar passageiro e motorista, não só o backend

## Fase 5. Chegada Ao Embarque

- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-active-ride-handlers.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-update-trip-location-handler.js`
- Mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiTripScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`

**Contrato operacional**
- motorista registra chegada
- passageiro recebe `driverArrived`
- janela de embarque e contagem regressiva precisam ser refletidas na UI

## Fase 6. Início Da Viagem

- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-start-trip-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/commands/StartTripCommand.js`
- Mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiTripScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js`

**Contrato operacional**
- `startTrip` só pode ocorrer com pagamento confirmado e estado válido
- `tripStarted` precisa mover ambos os lados para a superfície de viagem em curso

## Fase 7. Viagem Em Curso

- Runtime mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/PrototypeDriverTripAssistantService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/runtime/locationRouteBridge.js`
- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-update-location-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/trip-location-persistence-service.js`

**Contrato operacional**
- localização do motorista precisa atualizar backend e UI
- rota e ETA devem seguir o estado real, não snapshots locais stale

## Fase 8. Finalização E Recibo

- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-complete-trip-handler.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/commands/CompleteTripCommand.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/utils/trip-completion-payload.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/ride-settlement-service.js`
- UI:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiReceiptScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`

**Contrato operacional**
- `tripCompleted` deve carregar snapshot autoritativo
- recibo não pode depender de montagem local se o backend já tiver snapshot final

## Fase 9. Avaliação

- Backend:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/rating-service.js`
- UI:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiRatingScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/RatingService.js`

**Contrato operacional**
- avaliação precisa ser idempotente por `tripId + reviewerId`
- UI de rating precisa usar o recibo real da corrida concluída

## Achados Da Auditoria Inicial

### Achado 1. Cobertura crítica de elegibilidade do motorista estava ausente

O bug recente mostrou que categoria do carro stale no hot state pode derrubar o dispatch.
Arquivo crítico:
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/driver-eligibility-service.js`

### Achado 2. Expansão gradual ainda era vulnerável a regressão de tempo de resposta

O expander já foi corrigido para respeitar a janela de resposta do motorista, mas faltava cobertura explícita.
Arquivo crítico:
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/gradual-radius-expander.js`

### Achado 3. Cobertura de comandos do lifecycle está incompleta

Existe teste para `RequestRideCommand`, mas não havia cobertura equivalente para aceite/início/finalização na mesma profundidade.

### Achado 4. Cobertura de integração real está abaixo do necessário

Os testes de integração atuais em `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/integration` ainda são superficiais e não provam o contrato real do ciclo de corrida.
Precisamos tratar isso como dívida explícita, não como validação suficiente.

### Achado 5. O `prototype` depende de dois níveis de sincronização

Não basta o backend emitir evento:

1. o `prototypeRideRuntime` precisa receber e mutar estado
2. a navegação/tela precisa reagir ao estado mutado

Arquivos centrais:
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/WebSocketManager.js`

## Plano De Execução

### Etapa A. Mapa canônico e contrato de telas
- consolidar matriz de estágio -> evento -> serviço -> tela
- listar contratos obrigatórios por estágio
- travar o fluxo ideal que o E2E final deve seguir

## Matriz Canônica Do Lifecycle

| Etapa | Backend autoritativo | Evento/socket esperado | Runtime `prototype` | Tela passageiro | Tela motorista | Cobertura atual |
| --- | --- | --- | --- | --- | --- | --- |
| Cadastro/auth | `routes/auth-routes.js` | auth bootstrap | `prototypeRideRuntime.bootstrapRuntime` | auth flow / home | auth flow / home | parcial |
| Ativação motorista | `routes/driver-activation.js` | `driverStatusUpdated` | `driverActivationRemote`, `driverCanGoOnline` | n/a | `RobotaxiDriverActivationScreen` | parcial |
| Online/hot state | `register-socket-driver-control-handlers.js`, `register-socket-update-location-handler.js`, `driver-eligibility-service.js` | `driverStatusUpdated`, `driverStatusError` | `setDriverOnline`, `driverOnline`, `driverOffers` | n/a | `RobotaxiHomeScreen`, `DriverHomeOverlay` | parcial |
| Quote/booking | `RequestRideCommand`, `register-socket-create-booking-handler.js` | `bookingCreated`, `bookingError`, `noDriversFound` | `bookingStatus=searching` | `RobotaxiBookingScreen`, `RobotaxiDriverSearchScreen` | n/a | média |
| Pagamento | `register-socket-confirm-payment-handler.js`, `payment-service.js` | `paymentConfirmed` | `paymentState` | `RobotaxiPaymentScreen`, `WooviPaymentModal` | n/a | média |
| Dispatch | `driver-notification-dispatcher.js`, `gradual-radius-expander.js` | `newRideRequest` | `driverOffers` | `RobotaxiDriverSearchScreen` | `RobotaxiDriverOfferScreen`, `DriverLiveRideOverlay` | frágil antes desta auditoria |
| Aceite | `AcceptRideCommand`, `register-socket-accept-ride-handler.js` | `rideAccepted` | `bookingStatus=accepted`, `driverActiveRide` | `RobotaxiTripScreen` | `RobotaxiDriverTripScreen` | frágil |
| Chegada | `register-socket-active-ride-handlers.js` | `driverArrived`, `boardingWindowExpired` | `bookingStatus=arrived` | `RobotaxiTripScreen` | `RobotaxiDriverTripScreen` | frágil |
| Início | `StartTripCommand`, `register-socket-start-trip-handler.js` | `tripStarted` | `bookingStatus=started` | `RobotaxiTripScreen` | `RobotaxiDriverTripScreen` | frágil |
| Em curso | `register-socket-update-trip-location-handler.js`, `trip-location-persistence-service.js` | `driverLocation` | `driverCoordinate`, rota ativa | `RobotaxiTripScreen` | `RobotaxiDriverTripScreen` | parcial |
| Finalização | `CompleteTripCommand`, `register-socket-complete-trip-handler.js`, `trip-completion-payload.js` | `tripCompleted` | `bookingStatus=completed`, `lastReceipt` | `RobotaxiReceiptScreen` | `RobotaxiReceiptScreen` | frágil |
| Avaliação | `rating-service.js` | `ratingReceived` ou submit API/socket | `markTripRating` | `RobotaxiRatingScreen` | `RobotaxiRatingScreen` | parcial |

## Checklist De Auditoria Por Etapa

Cada etapa só pode ser considerada validada quando todos os itens abaixo estiverem verdes:

1. backend autoritativo identificado
2. evento/socket de transição identificado
3. mutação de estado no `prototypeRideRuntime` validada
4. tela correta validada para passageiro/motorista
5. teste unitário do serviço crítico existente
6. teste de integração/contrato existente
7. nenhuma evidência depende de fallback local ou intervenção manual

## Estado Atual Da Auditoria

### Verde
- entrypoints de auth e ativação do motorista mapeados e protegidos por contrato-fonte
- suíte mobile existente de auth/KYC viva para os blocos de cadastro e documentos
- `RequestRideCommand` com pricing autoritativo
- `driver-eligibility-service` para veículo ativo vs perfil stale
- `gradual-radius-expander` respeitando janela de resposta
- contrato fonte backend -> runtime -> rotas principais do `prototype`
- auto-roteamento do passageiro para `searching/trip/receipt`

### Amarelo
- `AcceptRideCommand`, `StartTripCommand` e `CompleteTripCommand` ainda precisavam de cobertura dedicada
- telas de offer/trip/receipt/rating ainda precisavam de testes automatizados focados no ciclo real
- integração ainda precisa ser tratada como contrato de lifecycle, não como smoke genérico

### Bateria Executada Nesta Wave

**Backend unitário**
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/unit/services/driver-eligibility-service.unit.test.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/unit/services/gradual-radius-expander.unit.test.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/unit/commands/AcceptRideCommand.unit.test.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/unit/commands/StartTripCommand.unit.test.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/unit/commands/CompleteTripCommand.unit.test.js`

**Backend integração/contrato**
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/integration/contracts/ride-lifecycle-contract.integration.test.js`

**Mobile auth/KYC**
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/__tests__/auth.test.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/__tests__/document-step.kyc.test.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/__tests__/kyc-service.liveness.test.js`

**Mobile lifecycle/telas**
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/__tests__/passenger-flow-routing.test.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/__tests__/prototype-ride-screens.test.js`

### Vermelho Antes De Novo E2E
- qualquer tela que permaneça na home/mapa inicial após `newRideRequest`, `rideAccepted`, `tripStarted` ou `tripCompleted`
- qualquer divergência entre `bookingStatus` no runtime e a superfície exibida
- qualquer driver elegível cujo `carType`/categoria dependa de dado stale
- qualquer cancelamento de busca que ignore janela de resposta de motorista já notificado

### Etapa B. Testes unitários backend
- elegibilidade do motorista
- dispatch e expansão gradual
- commands de aceite, início e finalização
- settlement e rating

### Etapa C. Testes de integração de contrato
- backend handlers expõem os eventos certos
- runtime `prototype` escuta os eventos certos
- rotas do app existem para cada estágio do fluxo

### Etapa D. Auditoria de UI
- confirmar que cada evento muda estado no runtime
- confirmar que cada mudança de estado abre a superfície correta
- eliminar qualquer tela que dependa de fallback local inconsistente

### Etapa E. E2E com evidência
- só depois da Etapa D
- screenshots obrigatórios:
  - auth ok
  - motorista online
  - quote
  - pagamento
  - searching
  - offer
  - accepted
  - arrived
  - started
  - trip en route
  - receipt
  - rating

## Gatilho De Aceite Final

Só podemos considerar o fluxo “auditado 100%” quando:

- backend e mobile compartilham o mesmo contrato de eventos
- cada estágio tem teste unitário dos serviços críticos
- cada contrato crítico tem teste de integração
- as telas acompanham o lifecycle real sem precisar de intervenção manual
- a corrida ponta a ponta reproduz screenshots coerentes com os estados reais
