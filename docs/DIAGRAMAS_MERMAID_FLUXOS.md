# 📊 DIAGRAMAS MERMAID - FLUXOS E INTERAÇÕES

**Data:** 2025-01-29  
**Objetivo:** Diagramas visuais dos fluxos de corrida, interações WebSocket e lógicas de decisão

---

## 📋 ÍNDICE

1. [Flowchart - Fluxo Completo de Corrida](#flowchart-fluxo-completo)
2. [Sequence Diagram - Interações WebSocket](#sequence-interacoes)
3. [Flowchart - Lógica de Decisão do Motorista](#flowchart-logica-motorista)
4. [Flowchart - Lógica de Decisão do Passageiro](#flowchart-logica-passageiro)
5. [Sequence Diagram - Fluxo de Pagamento](#sequence-pagamento)
6. [Flowchart - Estados da Corrida](#flowchart-estados)
7. [Sequence Diagram - Sistema de Filas e Matching](#sequence-filas)
8. [Flowchart - Tratamento de Erros](#flowchart-erros)

---

## 🔄 1. FLOWCHART - FLUXO COMPLETO DE CORRIDA {#flowchart-fluxo-completo}

```mermaid
flowchart TD
    Start([Início]) --> Auth{Autenticação}
    Auth -->|Passageiro| PassengerFlow[Passageiro: Tela Principal]
    Auth -->|Motorista| DriverFlow[Motorista: Tela Principal]
    
    %% FLUXO DO PASSAGEIRO
    PassengerFlow --> SelectOrigin[Selecionar Origem]
    SelectOrigin --> SelectDest[Selecionar Destino]
    SelectDest --> SelectCarType[Selecionar Tipo de Veículo]
    SelectCarType --> CreateBooking[createBooking]
    CreateBooking -->|Sucesso| BookingCreated[bookingCreated]
    CreateBooking -->|Erro| BookingError[bookingError]
    BookingCreated --> WaitDriver[Aguardar Motorista]
    WaitDriver -->|Motorista Aceita| RideAccepted[rideAccepted]
    WaitDriver -->|Timeout| Timeout[Cancelar Corrida]
    RideAccepted --> ConfirmPayment[confirmPayment]
    ConfirmPayment -->|Sucesso| PaymentConfirmed[paymentConfirmed]
    ConfirmPayment -->|Erro| PaymentError[paymentError]
    PaymentConfirmed --> DriverEnRoute[Motorista a Caminho]
    DriverEnRoute -->|Motorista Chegou| DriverArrived[driverArrived]
    DriverArrived --> TripStarted[tripStarted]
    TripStarted --> TripInProgress[Viagem em Andamento]
    TripInProgress --> TripCompleted[tripCompleted]
    TripCompleted --> SubmitRating[submitRating]
    SubmitRating --> RatingSubmitted[ratingSubmitted]
    RatingSubmitted --> EndPassenger([Fim])
    
    %% FLUXO DO MOTORISTA
    DriverFlow --> SetOnline[Ficar Online]
    SetOnline -->|setDriverStatus| DriverOnline[Motorista Online]
    DriverOnline --> UpdateLocation[updateLocation]
    UpdateLocation --> WaitRide[Aguardar Corrida]
    WaitRide -->|Nova Corrida| NewRideRequest[newRideRequest]
    NewRideRequest --> DriverDecision{Decisão do Motorista}
    DriverDecision -->|Aceitar| AcceptRide[acceptRide]
    DriverDecision -->|Rejeitar| RejectRide[rejectRide]
    AcceptRide -->|Sucesso| RideAcceptedDriver[rideAccepted]
    AcceptRide -->|Erro| AcceptRideError[acceptRideError]
    RejectRide -->|Sucesso| RideRejected[rideRejected]
    RejectRide -->|Erro| RejectRideError[rejectRideError]
    RideAcceptedDriver --> GoToPickup[Ir para Origem]
    GoToPickup --> ArrivePickup[Chegar na Origem]
    ArrivePickup --> StartTrip[startTrip]
    StartTrip -->|Sucesso| TripStartedDriver[tripStarted]
    StartTrip -->|Erro| TripStartError[tripStartError]
    TripStartedDriver --> TripInProgressDriver[Viagem em Andamento]
    TripInProgressDriver --> CompleteTrip[completeTrip]
    CompleteTrip -->|Sucesso| TripCompletedDriver[tripCompleted]
    CompleteTrip -->|Erro| TripCompleteError[tripCompleteError]
    TripCompletedDriver --> PaymentDistributed[paymentDistributed]
    PaymentDistributed --> SubmitRatingDriver[submitRating]
    SubmitRatingDriver --> RatingSubmittedDriver[ratingSubmitted]
    RatingSubmittedDriver --> EndDriver([Fim])
    
    %% CANCELAMENTO
    WaitDriver -->|Cancelar| CancelRide[cancelRide]
    GoToPickup -->|Cancelar| CancelRide
    TripInProgress -->|Cancelar| CancelRide
    CancelRide --> RideCancelled[rideCancelled]
    RideCancelled --> EndPassenger
    
    %% ESTILOS
    classDef passengerFlow fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef driverFlow fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef event fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef decision fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class PassengerFlow,SelectOrigin,SelectDest,SelectCarType,CreateBooking,BookingCreated,WaitDriver,RideAccepted,ConfirmPayment,PaymentConfirmed,DriverEnRoute,DriverArrived,TripStarted,TripInProgress,TripCompleted,SubmitRating,RatingSubmitted passengerFlow
    class DriverFlow,SetOnline,DriverOnline,UpdateLocation,WaitRide,NewRideRequest,AcceptRide,RideAcceptedDriver,GoToPickup,ArrivePickup,StartTrip,TripStartedDriver,TripInProgressDriver,CompleteTrip,TripCompletedDriver,PaymentDistributed,SubmitRatingDriver,RatingSubmittedDriver driverFlow
    class CreateBooking,BookingCreated,RideAccepted,TripStarted,TripCompleted,NewRideRequest,AcceptRide,StartTrip,CompleteTrip event
    class Auth,DriverDecision decision
    class BookingError,PaymentError,AcceptRideError,RejectRideError,TripStartError,TripCompleteError,Timeout,CancelRide,RideCancelled error
```

---

## 📡 2. SEQUENCE DIAGRAM - INTERAÇÕES WEBSOCKET {#sequence-interacoes}

```mermaid
sequenceDiagram
    participant P as Passageiro App
    participant S as Servidor WebSocket
    participant R as Redis
    participant D as Motorista App
    participant Q as QueueWorker
    participant F as Firestore
    
    Note over P,F: FASE 1: AUTENTICAÇÃO
    P->>S: authenticate({uid, userType})
    S->>R: Verificar autenticação
    R-->>S: Dados do usuário
    S->>S: Registrar socket em room
    S-->>P: authenticated({uid, userType, status})
    
    Note over P,F: FASE 2: MOTORISTA FICA ONLINE
    D->>S: setDriverStatus({status: 'available', isOnline: true})
    S->>R: Salvar status do motorista
    S->>R: Adicionar ao GEO (driver_locations)
    R-->>S: Confirmação
    S-->>D: driverStatusUpdated({success: true})
    
    D->>S: updateLocation({lat, lng, heading, speed})
    S->>R: Atualizar localização no GEO
    R-->>S: Confirmação
    S-->>D: locationUpdated({success: true})
    
    Note over P,F: FASE 3: PASSAGEIRO CRIA CORRIDA
    P->>S: createBooking({pickupLocation, destinationLocation, estimatedFare, paymentMethod})
    S->>S: Validar dados (rate limit, geofence)
    S->>R: Criar booking:{bookingId}
    S->>R: Adicionar à fila regional (ride_queue:{region}:pending)
    S->>R: Atualizar estado (PENDING → SEARCHING)
    R-->>S: Confirmação
    S-->>P: bookingCreated({bookingId, status: 'SEARCHING'})
    
    Note over P,F: FASE 4: QUEUE WORKER PROCESSA
    Q->>R: Buscar próxima corrida da fila
    R-->>Q: bookingId
    Q->>R: Mover para fila ativa (ride_queue:{region}:active)
    Q->>R: Buscar motoristas próximos (GEO search)
    R-->>Q: Lista de motoristas disponíveis
    
    Note over P,F: FASE 5: NOTIFICAR MOTORISTAS
    loop Para cada motorista próximo
        Q->>S: Notificar motorista
        S->>R: Verificar se motorista está online e disponível
        R-->>S: Status do motorista
        alt Motorista disponível
            S->>S: Emitir para room driver_{driverId}
            S-->>D: newRideRequest({bookingId, pickupLocation, destinationLocation, estimatedFare, timeout: 15s})
        end
    end
    
    Note over P,F: FASE 6: MOTORISTA ACEITA
    D->>S: acceptRide({bookingId})
    S->>R: Verificar se booking ainda está disponível
    R-->>S: Status do booking
    alt Booking disponível
        S->>R: Atualizar booking (driverId, status: ACCEPTED)
        S->>R: Atualizar estado (SEARCHING → ACCEPTED)
        S->>R: Remover da fila ativa
        S->>R: Bloquear motorista (driver lock)
        R-->>S: Confirmação
        S->>S: Emitir para rooms
        S-->>D: rideAccepted({bookingId, customerId, pickupLocation})
        S-->>P: rideAccepted({bookingId, driverId, driverInfo})
    else Booking já aceito
        S-->>D: acceptRideError({error: 'Corrida já foi aceita'})
    end
    
    Note over P,F: FASE 7: PASSAGEIRO CONFIRMA PAGAMENTO
    P->>S: confirmPayment({bookingId, paymentData})
    S->>F: Processar pagamento (Woovi)
    F-->>S: Resultado do pagamento
    alt Pagamento aprovado
        S->>R: Atualizar booking (paymentStatus: CONFIRMED)
        S->>S: Emitir para rooms
        S-->>P: paymentConfirmed({bookingId, paymentId})
    else Pagamento recusado
        S-->>P: paymentError({error: 'Pagamento recusado'})
    end
    
    Note over P,F: FASE 8: MOTORISTA VAI PARA ORIGEM
    D->>S: updateLocation({lat, lng})
    S->>R: Atualizar localização
    S->>S: Calcular distância até origem
    alt Motorista chegou na origem
        S->>S: Emitir para customer room
        S-->>P: driverArrived({bookingId, driverLocation})
    end
    
    Note over P,F: FASE 9: MOTORISTA INICIA VIAGEM
    D->>S: startTrip({bookingId, startLocation})
    S->>R: Atualizar booking (status: STARTED, startLocation)
    S->>R: Atualizar estado (ACCEPTED → STARTED)
    R-->>S: Confirmação
    S->>S: Emitir para rooms
    S-->>D: tripStarted({bookingId, startTime})
    S-->>P: tripStarted({bookingId, startTime})
    
    Note over P,F: FASE 10: ATUALIZAÇÃO DE LOCALIZAÇÃO DURANTE VIAGEM
    loop Durante a viagem
        D->>S: updateTripLocation({bookingId, lat, lng})
        S->>R: Atualizar localização
        S->>S: Calcular distância até destino
        S->>S: Emitir para customer room
        S-->>P: tripLocationUpdated({bookingId, driverLocation, distanceToDestination})
    end
    
    Note over P,F: FASE 11: MOTORISTA FINALIZA VIAGEM
    D->>S: completeTrip({bookingId, endLocation, distance, fare})
    S->>R: Atualizar booking (status: COMPLETED, endLocation, distance, fare)
    S->>R: Atualizar estado (STARTED → COMPLETED)
    S->>F: Calcular valores (bruto, líquido, taxa operacional)
    S->>F: Distribuir pagamento (saldo do motorista)
    F-->>S: Pagamento distribuído
    S->>S: Emitir para rooms
    S-->>D: tripCompleted({bookingId, netAmount, operationalCost})
    S-->>P: tripCompleted({bookingId, totalFare, paymentStatus})
    
    Note over P,F: FASE 12: AVALIAÇÕES
    P->>S: submitRating({bookingId, rating, comment})
    S->>F: Salvar avaliação do passageiro
    S->>S: Emitir para driver room
    S-->>D: ratingSubmitted({bookingId, rating, comment})
    
    D->>S: submitRating({bookingId, rating, comment})
    S->>F: Salvar avaliação do motorista
    S->>S: Emitir para customer room
    S-->>P: ratingSubmitted({bookingId, rating, comment})
```

---

## 🚗 3. FLOWCHART - LÓGICA DE DECISÃO DO MOTORISTA {#flowchart-logica-motorista}

```mermaid
flowchart TD
    Start([Motorista Online]) --> WaitRide[Aguardar Corrida]
    WaitRide --> ReceiveRequest{Recebe newRideRequest?}
    ReceiveRequest -->|Sim| ShowCard[Mostrar Card de Corrida]
    ReceiveRequest -->|Não| WaitRide
    
    ShowCard --> DisplayInfo[Exibir: Origem, Destino, Valor, Distância]
    DisplayInfo --> StartTimer[Iniciar Timer 15s]
    StartTimer --> Decision{Decisão do Motorista}
    
    Decision -->|Aceitar| CheckAvailability{Disponível?}
    Decision -->|Rejeitar| RejectRide[rejectRide]
    Decision -->|Timeout| AutoReject[Rejeição Automática]
    
    CheckAvailability -->|Sim| SendAccept[acceptRide]
    CheckAvailability -->|Não| ShowError[Erro: Indisponível]
    
    SendAccept --> WaitResponse{Aguardar Resposta}
    WaitResponse -->|Sucesso| RideAccepted[rideAccepted]
    WaitResponse -->|Erro| AcceptError[acceptRideError]
    
    AcceptError -->|Corrida já aceita| WaitRide
    AcceptError -->|Outro erro| ShowErrorMsg[Mostrar Mensagem de Erro]
    ShowErrorMsg --> WaitRide
    
    RideAccepted --> LockVehicle[Bloquear Veículo]
    LockVehicle --> NavigateToPickup[Navegar para Origem]
    NavigateToPickup --> UpdateLocation[updateLocation contínuo]
    UpdateLocation --> CheckDistance{Distância até Origem}
    
    CheckDistance -->|> 100m| UpdateLocation
    CheckDistance -->|<= 100m| ArrivePickup[Chegou na Origem]
    
    ArrivePickup --> NotifyArrival[notificationAction: 'arrived']
    NotifyArrival --> WaitPassenger[Aguardar Passageiro]
    WaitPassenger --> PassengerReady{Passageiro Pronto?}
    
    PassengerReady -->|Sim| StartTrip[startTrip]
    PassengerReady -->|Não| WaitPassenger
    
    StartTrip --> WaitStartResponse{Aguardar Resposta}
    WaitStartResponse -->|Sucesso| TripStarted[tripStarted]
    WaitStartResponse -->|Erro| StartError[tripStartError]
    
    StartError --> ShowStartError[Mostrar Erro]
    ShowStartError --> StartTrip
    
    TripStarted --> UpdateTripLocation[updateTripLocation contínuo]
    UpdateTripLocation --> CheckDestination{Distância até Destino}
    
    CheckDestination -->|> 50m| UpdateTripLocation
    CheckDestination -->|<= 50m| ArriveDestination[Chegou no Destino]
    
    ArriveDestination --> CompleteTrip[completeTrip]
    CompleteTrip --> WaitCompleteResponse{Aguardar Resposta}
    WaitCompleteResponse -->|Sucesso| TripCompleted[tripCompleted]
    WaitCompleteResponse -->|Erro| CompleteError[tripCompleteError]
    
    CompleteError --> ShowCompleteError[Mostrar Erro]
    ShowCompleteError --> CompleteTrip
    
    TripCompleted --> ReceivePayment[Receber paymentDistributed]
    ReceivePayment --> ShowRating[Mostrar Modal de Avaliação]
    ShowRating --> SubmitRating[submitRating]
    SubmitRating --> RatingSubmitted[ratingSubmitted]
    RatingSubmitted --> UnlockVehicle[Desbloquear Veículo]
    UnlockVehicle --> WaitRide
    
    RejectRide --> WaitResponseReject{Aguardar Resposta}
    WaitResponseReject -->|Sucesso| RideRejected[rideRejected]
    WaitResponseReject -->|Erro| RejectError[rejectRideError]
    
    RideRejected --> WaitRide
    RejectError --> ShowRejectError[Mostrar Erro]
    ShowRejectError --> WaitRide
    
    AutoReject --> WaitRide
    
    %% CANCELAMENTO
    NavigateToPickup -->|Cancelar| CancelRide[cancelRide]
    WaitPassenger -->|Cancelar| CancelRide
    UpdateTripLocation -->|Cancelar| CancelRide
    CancelRide --> RideCancelled[rideCancelled]
    RideCancelled --> UnlockVehicle
    
    %% ESTILOS
    classDef process fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef decision fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef event fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef success fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    
    class WaitRide,ShowCard,DisplayInfo,StartTimer,NavigateToPickup,UpdateLocation,ArrivePickup,WaitPassenger,UpdateTripLocation,ArriveDestination,ShowRating,UnlockVehicle process
    class ReceiveRequest,Decision,CheckAvailability,WaitResponse,CheckDistance,PassengerReady,WaitStartResponse,CheckDestination,WaitCompleteResponse,WaitResponseReject decision
    class RejectRide,SendAccept,RideAccepted,NotifyArrival,StartTrip,TripStarted,CompleteTrip,TripCompleted,ReceivePayment,SubmitRating,RatingSubmitted,RideRejected,CancelRide,RideCancelled event
    class AcceptError,StartError,CompleteError,RejectError,ShowError,ShowErrorMsg,ShowStartError,ShowCompleteError,ShowRejectError error
    class TripCompleted,RatingSubmitted,UnlockVehicle success
```

---

## 👤 4. FLOWCHART - LÓGICA DE DECISÃO DO PASSAGEIRO {#flowchart-logica-passageiro}

```mermaid
flowchart TD
    Start([Tela Principal]) --> SelectOrigin[Selecionar Origem]
    SelectOrigin --> SelectDest[Selecionar Destino]
    SelectDest --> SelectCarType[Selecionar Tipo de Veículo]
    SelectCarType --> ShowEstimate[Mostrar Estimativa de Preço]
    ShowEstimate --> UserDecision{Deseja Continuar?}
    
    UserDecision -->|Não| Start
    UserDecision -->|Sim| CreateBooking[createBooking]
    
    CreateBooking --> WaitBookingResponse{Aguardar Resposta}
    WaitBookingResponse -->|Sucesso| BookingCreated[bookingCreated]
    WaitBookingResponse -->|Erro| BookingError[bookingError]
    
    BookingError --> ShowBookingError[Mostrar Erro]
    ShowBookingError --> UserDecision
    
    BookingCreated --> ShowSearching[Mostrar: Buscando Motorista...]
    ShowSearching --> WaitDriver[Aguardar Motorista]
    
    WaitDriver --> CheckTimeout{Timeout?}
    CheckTimeout -->|Sim| Timeout[Cancelar Corrida]
    CheckTimeout -->|Não| CheckResponse{Recebeu Resposta?}
    
    CheckResponse -->|rideAccepted| RideAccepted[rideAccepted]
    CheckResponse -->|noDriversAvailable| NoDrivers[Sem Motoristas Disponíveis]
    CheckResponse -->|Nada| WaitDriver
    
    NoDrivers --> UserRetry{Reintentar?}
    UserRetry -->|Sim| CreateBooking
    UserRetry -->|Não| Start
    
    RideAccepted --> ShowDriverInfo[Mostrar Info do Motorista]
    ShowDriverInfo --> ShowPayment[Mostrar Tela de Pagamento]
    ShowPayment --> ProcessPayment[confirmPayment]
    
    ProcessPayment --> WaitPaymentResponse{Aguardar Resposta}
    WaitPaymentResponse -->|Sucesso| PaymentConfirmed[paymentConfirmed]
    WaitPaymentResponse -->|Erro| PaymentError[paymentError]
    
    PaymentError --> ShowPaymentError[Mostrar Erro]
    ShowPaymentError --> ShowPayment
    
    PaymentConfirmed --> DriverEnRoute[Mostrar: Motorista a Caminho]
    DriverEnRoute --> UpdateDriverLocation[Atualizar Localização do Motorista]
    UpdateDriverLocation --> CheckArrival{Motorista Chegou?}
    
    CheckArrival -->|driverArrived| DriverArrived[driverArrived]
    CheckArrival -->|Não| UpdateDriverLocation
    
    DriverArrived --> ShowArrival[Mostrar: Motorista Chegou]
    ShowArrival --> WaitStart{Aguardar Início da Viagem}
    WaitStart --> CheckStart{Recebeu tripStarted?}
    
    CheckStart -->|Sim| TripStarted[tripStarted]
    CheckStart -->|Não| WaitStart
    
    TripStarted --> ShowTrip[Mostrar: Viagem em Andamento]
    ShowTrip --> UpdateTripLocation[Atualizar Localização Durante Viagem]
    UpdateTripLocation --> CheckComplete{Recebeu tripCompleted?}
    
    CheckComplete -->|Não| UpdateTripLocation
    CheckComplete -->|Sim| TripCompleted[tripCompleted]
    
    TripCompleted --> ShowComplete[Mostrar: Viagem Finalizada]
    ShowComplete --> ShowReceipt[Mostrar Recibo]
    ShowReceipt --> ShowRating[Mostrar Modal de Avaliação]
    ShowRating --> SubmitRating[submitRating]
    
    SubmitRating --> WaitRatingResponse{Aguardar Resposta}
    WaitRatingResponse -->|Sucesso| RatingSubmitted[ratingSubmitted]
    WaitRatingResponse -->|Erro| RatingError[ratingError]
    
    RatingSubmitted --> End([Fim - Voltar para Tela Principal])
    RatingError --> ShowRatingError[Mostrar Erro]
    ShowRatingError --> ShowRating
    
    %% CANCELAMENTO
    WaitDriver -->|Cancelar| CancelRide[cancelRide]
    DriverEnRoute -->|Cancelar| CancelRide
    ShowTrip -->|Cancelar| CancelRide
    
    CancelRide --> WaitCancelResponse{Aguardar Resposta}
    WaitCancelResponse -->|Sucesso| RideCancelled[rideCancelled]
    WaitCancelResponse -->|Erro| CancelError[rideCancellationError]
    
    RideCancelled --> CheckRefund{Reembolso?}
    CheckRefund -->|Sim| PaymentRefunded[paymentRefunded]
    CheckRefund -->|Não| End
    
    PaymentRefunded --> ShowRefund[Mostrar: Reembolso Processado]
    ShowRefund --> End
    
    CancelError --> ShowCancelError[Mostrar Erro]
    ShowCancelError --> End
    
    Timeout --> CancelRide
    
    %% CHAT
    DriverEnRoute -->|Abrir Chat| OpenChat[Abrir Chat]
    ShowTrip -->|Abrir Chat| OpenChat
    OpenChat --> SendMessage[sendMessage]
    SendMessage --> ReceiveMessage[newMessage]
    ReceiveMessage --> OpenChat
    
    %% ESTILOS
    classDef process fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef decision fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef event fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef success fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    
    class SelectOrigin,SelectDest,SelectCarType,ShowEstimate,ShowSearching,WaitDriver,ShowDriverInfo,ShowPayment,DriverEnRoute,UpdateDriverLocation,ShowArrival,WaitStart,ShowTrip,UpdateTripLocation,ShowComplete,ShowReceipt,ShowRating,OpenChat process
    class UserDecision,WaitBookingResponse,CheckTimeout,CheckResponse,UserRetry,WaitPaymentResponse,CheckArrival,CheckStart,CheckComplete,WaitRatingResponse,WaitCancelResponse,CheckRefund decision
    class CreateBooking,BookingCreated,RideAccepted,ProcessPayment,PaymentConfirmed,DriverArrived,TripStarted,TripCompleted,SubmitRating,RatingSubmitted,CancelRide,RideCancelled,PaymentRefunded,SendMessage,ReceiveMessage event
    class BookingError,PaymentError,RatingError,CancelError,ShowBookingError,ShowPaymentError,ShowRatingError,ShowCancelError,Timeout,NoDrivers error
    class PaymentConfirmed,TripCompleted,RatingSubmitted,PaymentRefunded success
```

---

## 💳 5. SEQUENCE DIAGRAM - FLUXO DE PAGAMENTO {#sequence-pagamento}

```mermaid
sequenceDiagram
    participant P as Passageiro App
    participant S as Servidor WebSocket
    participant V as Woovi API
    participant R as Redis
    participant F as Firestore
    
    Note over P,F: FASE 1: PASSAGEIRO SOLICITA CORRIDA
    P->>S: createBooking({pickupLocation, destinationLocation, estimatedFare, paymentMethod: 'pix'})
    S->>R: Criar booking:{bookingId}
    S->>R: Estado: PENDING
    R-->>S: Confirmação
    S-->>P: bookingCreated({bookingId})
    
    Note over P,F: FASE 2: MOTORISTA ACEITA
    S->>P: rideAccepted({bookingId, driverId})
    
    Note over P,F: FASE 3: PASSAGEIRO CONFIRMA PAGAMENTO
    P->>S: confirmPayment({bookingId, paymentData})
    S->>S: Validar dados do pagamento
    S->>V: Criar cobrança PIX (Woovi)
    V-->>S: chargeId, qrCode, status: 'pending'
    S->>R: Atualizar booking (paymentId: chargeId, paymentStatus: 'pending')
    S->>F: Salvar transação de pagamento
    S-->>P: paymentConfirmed({bookingId, qrCode, status: 'pending'})
    
    Note over P,F: FASE 4: PASSAGEIRO PAGA (Woovi Webhook)
    V->>S: Webhook: payment.paid ({chargeId, status: 'paid'})
    S->>R: Atualizar booking (paymentStatus: 'paid')
    S->>F: Atualizar transação (status: 'paid')
    S->>R: Criar hold de pagamento (payment_hold:{bookingId})
    S->>F: Registrar hold no saldo do passageiro
    
    Note over P,F: FASE 5: VIAGEM EM ANDAMENTO
    S->>P: tripStarted({bookingId})
    
    Note over P,F: FASE 6: MOTORISTA FINALIZA VIAGEM
    P->>S: completeTrip({bookingId, endLocation, distance, fare})
    S->>F: Calcular valores
    Note right of S: Valor Bruto: R$ 25,50<br/>Taxa Operacional: R$ 2,55 (10%)<br/>Valor Líquido: R$ 22,95
    
    S->>F: Liberar hold de pagamento
    S->>F: Debitar do saldo do passageiro (valor bruto)
    S->>F: Creditar no saldo do motorista (valor líquido)
    S->>F: Registrar taxa operacional
    
    S->>R: Atualizar booking (paymentStatus: 'distributed')
    S->>S: Emitir eventos
    S-->>P: tripCompleted({bookingId, totalFare: 25.50})
    S-->>D: paymentDistributed({bookingId, netAmount: 22.95, operationalCost: 2.55})
    
    Note over P,F: FASE 7: CANCELAMENTO (Cenário Alternativo)
    alt Corrida Cancelada ANTES do Pagamento
        P->>S: cancelRide({bookingId})
        S->>R: Verificar paymentStatus
        R-->>S: paymentStatus: 'pending'
        S->>V: Cancelar cobrança PIX
        V-->>S: Cobrança cancelada
        S->>R: Atualizar booking (status: 'CANCELLED', paymentStatus: 'cancelled')
        S-->>P: rideCancelled({bookingId, refund: false})
    else Corrida Cancelada APÓS Pagamento (antes da viagem)
        P->>S: cancelRide({bookingId})
        S->>R: Verificar paymentStatus
        R-->>S: paymentStatus: 'paid'
        S->>V: Criar reembolso PIX
        V-->>S: refundId, status: 'pending'
        S->>F: Liberar hold de pagamento
        S->>F: Registrar reembolso
        S->>R: Atualizar booking (status: 'CANCELLED', paymentStatus: 'refunded')
        S-->>P: rideCancelled({bookingId, refund: true})
        S-->>P: paymentRefunded({bookingId, refundId, amount: 25.50})
    else Corrida Cancelada DURANTE Viagem
        P->>S: cancelRide({bookingId})
        S->>R: Verificar paymentStatus e estado
        R-->>S: paymentStatus: 'paid', state: 'STARTED'
        S->>F: Calcular reembolso parcial (50%)
        S->>V: Criar reembolso parcial
        V-->>S: refundId, status: 'pending', amount: 12.75
        S->>F: Liberar hold parcial
        S->>F: Creditar reembolso no saldo do passageiro
        S->>F: Creditar valor líquido no saldo do motorista (50% do líquido)
        S->>R: Atualizar booking (status: 'CANCELLED', paymentStatus: 'partially_refunded')
        S-->>P: rideCancelled({bookingId, refund: true, partial: true})
        S-->>P: paymentRefunded({bookingId, refundId, amount: 12.75})
    end
```

---

## 🔄 6. FLOWCHART - ESTADOS DA CORRIDA {#flowchart-estados}

```mermaid
stateDiagram-v2
    [*] --> PENDING: createBooking
    
    PENDING --> SEARCHING: QueueWorker processa
    PENDING --> CANCELLED: cancelRide (antes de processar)
    
    SEARCHING --> ACCEPTED: acceptRide
    SEARCHING --> CANCELLED: cancelRide (sem motorista)
    SEARCHING --> TIMEOUT: Timeout (sem motorista)
    
    ACCEPTED --> STARTED: startTrip
    ACCEPTED --> CANCELLED: cancelRide (antes de iniciar)
    
    STARTED --> COMPLETED: completeTrip
    STARTED --> CANCELLED: cancelRide (durante viagem)
    
    COMPLETED --> RATED: submitRating (ambos)
    RATED --> [*]
    
    CANCELLED --> [*]
    TIMEOUT --> [*]
    
    note right of PENDING
        Estado inicial
        Corrida criada
        Aguardando processamento
    end note
    
    note right of SEARCHING
        Em busca de motorista
        Notificando motoristas próximos
        Expandindo raio de busca
    end note
    
    note right of ACCEPTED
        Motorista aceitou
        Aguardando pagamento
        Motorista a caminho da origem
    end note
    
    note right of STARTED
        Viagem iniciada
        Motorista e passageiro no veículo
        Atualizando localização
    end note
    
    note right of COMPLETED
        Viagem finalizada
        Pagamento distribuído
        Aguardando avaliações
    end note
    
    note right of CANCELLED
        Corrida cancelada
        Processar reembolso se necessário
    end note
```

---

## 🎯 7. SEQUENCE DIAGRAM - SISTEMA DE FILAS E MATCHING {#sequence-filas}

```mermaid
sequenceDiagram
    participant P as Passageiro
    participant S as Servidor
    participant R as Redis
    participant Q as QueueWorker
    participant G as GradualRadiusExpander
    participant D as Motorista
    
    Note over P,D: FASE 1: CRIAÇÃO DE BOOKING
    P->>S: createBooking({pickupLocation, destinationLocation})
    S->>R: Criar booking:{bookingId}
    S->>R: Calcular regionHash (GeoHash precisão 5)
    S->>R: ZADD ride_queue:{regionHash}:pending {timestamp} {bookingId}
    S->>R: SET booking_state:{bookingId} PENDING
    S-->>P: bookingCreated({bookingId})
    
    Note over P,D: FASE 2: QUEUE WORKER PROCESSA (a cada 3s)
    Q->>R: ZRANGE ride_queue:{regionHash}:pending 0 0
    R-->>Q: bookingId
    Q->>R: ZREM ride_queue:{regionHash}:pending {bookingId}
    Q->>R: ZADD ride_queue:{regionHash}:active {timestamp} {bookingId}
    Q->>R: SET booking_state:{bookingId} SEARCHING
    
    Note over P,D: FASE 3: GRADUAL RADIUS EXPANDER
    Q->>G: processBooking({bookingId, pickupLocation})
    G->>R: GEORADIUS driver_locations {pickupLocation} {radius} km
    R-->>G: Lista de motoristas próximos
    
    alt Motoristas encontrados
        G->>G: Filtrar motoristas (isOnline: true, status: AVAILABLE)
        G->>S: Notificar motoristas (newRideRequest)
        S-->>D: newRideRequest({bookingId, ...})
        
        D->>S: acceptRide({bookingId})
        S->>R: Verificar se booking ainda está em SEARCHING
        R-->>S: Estado: SEARCHING
        S->>R: ZREM ride_queue:{regionHash}:active {bookingId}
        S->>R: SET booking_state:{bookingId} ACCEPTED
        S->>R: HSET booking:{bookingId} driverId {driverId}
        S-->>D: rideAccepted({bookingId})
        S-->>P: rideAccepted({bookingId, driverId})
    else Nenhum motorista encontrado
        G->>G: Expandir raio (incrementar 500m)
        G->>G: Verificar se raio < 5km
        alt Raio < 5km
            G->>R: GEORADIUS driver_locations {pickupLocation} {newRadius} km
            R-->>G: Nova lista de motoristas
            G->>S: Notificar motoristas encontrados
        else Raio >= 5km
            G->>R: SET booking_state:{bookingId} NO_DRIVERS
            G->>S: Emitir noDriversAvailable
            S-->>P: noDriversAvailable({bookingId, message})
        end
    end
    
    Note over P,D: FASE 4: TIMEOUT (se nenhum motorista aceitar em 60s)
    Q->>R: Verificar bookings em SEARCHING há mais de 60s
    R-->>Q: Lista de bookings expirados
    loop Para cada booking expirado
        Q->>R: SET booking_state:{bookingId} TIMEOUT
        Q->>R: ZREM ride_queue:{regionHash}:active {bookingId}
        Q->>S: Emitir timeout
        S-->>P: bookingTimeout({bookingId})
    end
    
    Note over P,D: FASE 5: CANCELAMENTO
    P->>S: cancelRide({bookingId})
    S->>R: GET booking_state:{bookingId}
    R-->>S: Estado atual
    alt Estado: PENDING ou SEARCHING
        S->>R: ZREM ride_queue:{regionHash}:pending {bookingId}
        S->>R: ZREM ride_queue:{regionHash}:active {bookingId}
        S->>R: SET booking_state:{bookingId} CANCELLED
        S-->>P: rideCancelled({bookingId})
    else Estado: ACCEPTED ou STARTED
        S->>R: SET booking_state:{bookingId} CANCELLED
        S->>S: Processar reembolso
        S-->>P: rideCancelled({bookingId, refund: true})
    end
```

---

## ⚠️ 8. FLOWCHART - TRATAMENTO DE ERROS {#flowchart-erros}

```mermaid
flowchart TD
    Start([Operação Iniciada]) --> Validate{Validação}
    Validate -->|Dados Inválidos| ValidationError[Erro de Validação]
    Validate -->|OK| RateLimit{Rate Limit}
    
    RateLimit -->|Excedido| RateLimitError[Erro: Rate Limit Excedido]
    RateLimit -->|OK| Geofence{Geofence}
    
    Geofence -->|Fora da Região| GeofenceError[Erro: Fora da Região Permitida]
    Geofence -->|OK| Auth{Autenticação}
    
    Auth -->|Não Autenticado| AuthError[Erro: Não Autenticado]
    Auth -->|OK| Process[Processar Operação]
    
    Process --> Redis{Redis Disponível?}
    Redis -->|Não| RedisError[Erro: Redis Indisponível]
    Redis -->|Sim| Firestore{Firestore Disponível?}
    
    Firestore -->|Não| FirestoreError[Erro: Firestore Indisponível]
    Firestore -->|Sim| BusinessLogic{Lógica de Negócio}
    
    BusinessLogic -->|Erro| BusinessError[Erro de Negócio]
    BusinessLogic -->|Sucesso| Success[Operação Bem-Sucedida]
    
    %% TRATAMENTO DE ERROS
    ValidationError --> LogError[Log de Erro]
    RateLimitError --> LogError
    GeofenceError --> LogError
    AuthError --> LogError
    RedisError --> LogError
    FirestoreError --> LogError
    BusinessError --> LogError
    
    LogError --> AuditLog[Registrar em Auditoria]
    AuditLog --> EmitError[Emitir Evento de Erro]
    EmitError --> UserNotification[Notificar Usuário]
    UserNotification --> End([Fim])
    
    Success --> LogSuccess[Log de Sucesso]
    LogSuccess --> AuditSuccess[Registrar em Auditoria]
    AuditSuccess --> EmitSuccess[Emitir Evento de Sucesso]
    EmitSuccess --> End
    
    %% TIPOS DE ERRO
    ValidationError --> ErrorType{Tipo de Erro}
    RateLimitError --> ErrorType
    GeofenceError --> ErrorType
    AuthError --> ErrorType
    RedisError --> ErrorType
    FirestoreError --> ErrorType
    BusinessError --> ErrorType
    
    ErrorType -->|Recuperável| Retry{Tentar Novamente?}
    ErrorType -->|Não Recuperável| EmitError
    
    Retry -->|Sim| Wait[Aguardar e Retry]
    Wait --> Start
    Retry -->|Não| EmitError
    
    %% ESTILOS
    classDef process fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef decision fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef success fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef log fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    
    class Start,Process,Wait,End process
    class Validate,RateLimit,Geofence,Auth,Redis,Firestore,BusinessLogic,ErrorType,Retry decision
    class ValidationError,RateLimitError,GeofenceError,AuthError,RedisError,FirestoreError,BusinessError,EmitError,UserNotification error
    class Success,LogSuccess,AuditSuccess,EmitSuccess success
    class LogError,AuditLog log
```

---

## 📊 9. RESUMO DOS DIAGRAMAS

### **Diagramas Criados:**

1. ✅ **Flowchart - Fluxo Completo de Corrida** - Visão geral de todo o processo
2. ✅ **Sequence Diagram - Interações WebSocket** - Detalhamento de todas as mensagens
3. ✅ **Flowchart - Lógica de Decisão do Motorista** - Fluxo completo do motorista
4. ✅ **Flowchart - Lógica de Decisão do Passageiro** - Fluxo completo do passageiro
5. ✅ **Sequence Diagram - Fluxo de Pagamento** - Processamento de pagamentos e reembolsos
6. ✅ **Flowchart - Estados da Corrida** - Máquina de estados da corrida
7. ✅ **Sequence Diagram - Sistema de Filas e Matching** - Processamento de filas e busca de motoristas
8. ✅ **Flowchart - Tratamento de Erros** - Tratamento de erros e recuperação

### **Como Usar:**

1. **Visualizar no GitHub/GitLab:** Os diagramas Mermaid são renderizados automaticamente
2. **Visualizar Online:** Copiar código para [Mermaid Live Editor](https://mermaid.live/)
3. **Integrar em Documentação:** Usar em README.md ou documentação do projeto

---

**Documento criado em:** 2025-01-29  
**Versão:** 1.0

