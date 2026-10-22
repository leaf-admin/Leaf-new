# Notificações ao passageiro por estado da corrida

Data: 2026-10-22
Tipo: levantamento somente leitura (nenhum código alterado, nenhum commit).
Repositório: `/Users/izaakdias/Documents/leaf-wave`
Branch lida: `feat/driver-passenger-wave`. Os arquivos de notificação do passageiro são idênticos aos de `main` (`git diff main` nesses arquivos só mostra ajustes de token FCM em `services/fcm-service.js`, que não mudam os textos).

## 1. Resumo

- O passageiro já recebe alerta visível em **aceite** ("Corrida Aceita!") e em **chegada do motorista** ("Seu motorista chegou", com nome e veículo).
- **Início da viagem, conclusão e cancelamento** só chegam ao passageiro como push silencioso (`data` + `content-available`). Não aparece nada na bandeja. Os textos "Viagem iniciada" e "Viagem concluída" que existem em `createTripNotification` nunca são chamados.
- O aviso de aceite não tem nome, carro, placa nem previsão, embora esses dados já estejam no Redis no momento do aceite.
- O aviso de chegada não mostra o horário limite de embarque, embora `boardingDeadlineAt` já seja gravado.
- Bug de toque: o push de chegada envia `screen: RobotaxiPrototype`, que abre a home e não a tela da corrida (`RobotaxiPrototypeTrip`).
- Em iOS há Live Activity do passageiro (APNs) com textos por fase. No Android há notificação persistente `ride_status`, mas o caminho de início dela para o passageiro parece inativo; precisa de teste em aparelho.

## 2. Mapa atual por transição (backend)

Caminhos relativos a `leaf-websocket-backend/`.

| Transição | Push visível ao passageiro | Push silencioso (data) | Texto atual | Onde |
|---|---|---|---|---|
| Aceite | Sim | Não | "Corrida Aceita!" / "Um motorista aceitou sua corrida. Em breve ele estará a caminho." | `listeners/onRideAccepted.sendPush.js:87-89`, envio em `:98`. Listener registrado em `bootstrap/setup-eventbus-workers.js:48, 62` |
| Motorista chegou | Sim | Sim (`sendRideStatusUpdate`) | Título "Seu motorista chegou". Corpo "{Nome} está no local de embarque · {Modelo} · {Placa}" | `services/ride-passenger-status-push.js:52-66` (builder), `:88-111` (orquestração), `:103-105` (alerta). Chamado em `bootstrap/register-socket-driver-control-handlers.js:393` |
| Viagem iniciada | Não | Sim | Nenhum texto visível | `bootstrap/register-socket-start-trip-handler.js:562-568` (`status: 'started'`) |
| Concluída | Não | Sim | Nenhum texto visível | `bootstrap/register-socket-complete-trip-handler.js:743-750` |
| Cancelada | Não | Sim | Nenhum texto visível. O passageiro também recebe `rideCancelled` por socket | `bootstrap/register-socket-cancel-ride-handler.js:618-628` |

Pontos de apoio:

- Texto de aceite fica em `onRideAccepted.sendPush.js:86-96` (objeto `notification`). O listener só recebe `customerId`, `bookingId`, `driverId` (`:80-86`).
- Push silencioso: `services/fcm-service.js:743-812` (`sendRideStatusUpdate`). Monta `data` com `type: 'ride_status_update'`, `status`, `driverName`, `estimatedTime`, `distance`, `fare`, `pickup`, `destination`. Também atualiza a Live Activity (`:756`, `:806`).
- Push visível genérico: `services/fcm-service.js:340` (`sendNotificationToUser`). Envia `notification` com `android.notification.channelId = notification.channelId || 'default'` (`:527-531`).
- Textos de `createTripNotification` (`services/fcm-service.js:834-894`): "Motorista chegou!", "Viagem iniciada!", "Viagem concluída!". `sendTripNotification` (`:822`) não tem chamador no código. Esses textos são código morto hoje.
- Push "A caminho do destino" (`start-trip-handler.js:650-668`) vai para o **motorista**, não para o passageiro.
- Chegada: os eventos de socket `arrivedAtPickup`, `driverArrived` e `activeRideSync` (`driver-control-handlers.js:388-389`, `:398-412`) só chegam com o app aberto ou em conexão ativa.

## 3. Como o app do passageiro trata (mobile-app)

Canal e categoria:

- Não há categoria (`categoryIdentifier`) para o passageiro. Os botões de ação só existem no push do motorista (`driver_actions`, `InteractiveNotificationService.js:160`).
- O backend envia `channelId` `trip_updates` nos alertas do passageiro (`fcm-service.js:853-890`). O canal `trip_updates` está definido em `config/FCMConfig.js:29-37`, mas não encontrei `setNotificationChannelAsync` para ele no código do app. Se o canal não existir no aparelho, o Android cai no canal padrão. Confirmar no aparelho.
- Canal `ride_status` (Android, alta prioridade, sticky): `src/services/PersistentRideNotificationService.js:138`.

Toque na notificação:

- `src/services/FCMNotificationService.js:831-846` (`resolveNotificationNavigationTarget`). `RobotaxiPrototype` está em `ALLOWED_NOTIFICATION_ROUTES` (`:22`), então `screen: 'RobotaxiPrototype'` vence e o toque abre a home. O correto para o push de chegada seria `RobotaxiPrototypeTrip` (que também está na lista, `:23`).

Supressão com app aberto:

- Chegada (`driver_arrived`) é ignorada em primeiro plano (`FCMNotificationService.js:681-684`), porque a tela de viagem já mostra o aviso.
- Aceite (`RIDE_ACCEPTED`) não está na lista de supressão. Cai no `handleDefaultNotification` (`:~740-770`), que agenda notificação local mesmo com o app aberto. Pode ser ruído. Decidir se é intencional.
- Em segundo plano, o handler só salva na fila (`src/services/FCMBackgroundMessageHandler.js:13-19`, `BackgroundNotificationQueue.js`). O OS mostra o bloco `notification` do push.

Notificação persistente (Android):

- `PersistentRideNotificationService.js:209-233` registra o handler de `ride_status_update` na inicialização (`src/components/AuthProvider.js:153`). Esse handler roda para qualquer usuário. Se a notificação não estiver ativa, `updateRideNotification` chama `showRideNotification` (`:344-348`).
- Textos do passageiro em `PersistentRideNotificationService.js:428-497` (ramo `customer`): "Motorista encontrado!" / "{Nome} está a caminho • N min"; "Motorista chegou!" / "{Nome} está no local de embarque"; "Viagem em andamento" / "A caminho de {destino}"; "Viagem finalizada" / "Valor: {fare}".
- Ponto a confirmar: `RideLocationManager.startRide` (que mostra a notificação persistente inicial) não tem importador em `src/`. Ou seja, a notificação do passageiro só aparece quando um push `ride_status_update` chega. Confirmar no aparelho antes de mexer.

## 4. Live Activity e notificação contínua

- iOS: existe Live Activity do passageiro. Backend: `services/ride-live-activity-service.js:169-192`. Título e corpo por fase:
  - Aceito: título = ETA ou "Motorista a caminho"; corpo "Acompanhe a chegada pelo app."
  - Chegou: título "Motorista chegou"; corpo "Dirija-se ao local de embarque."
  - Iniciada: título "Viagem em andamento"; corpo "A caminho de {destino}."
  - Terminal: encerra a atividade.
  - Mobile: `src/services/RideLiveActivityService.js`, plugin `plugins/withLeafRideLiveActivity.js`.
- Android: notificação persistente `ride_status` (ver seção 3). Não é Live Activity; o passageiro depende do push `ride_status_update`.
- Não é preciso criar nada novo para a Live Activity. Ela já é atualizada pelas transições de aceite, chegada e início (via `sendRideStatusUpdate`). O aviso visível precisa de alerta próprio.

## 5. Dados disponíveis por transição

Dados gravados no hash `booking:{id}` (Redis) e enviados em `bookingData`.

| Dado | Aceite | Chegada | Início | Conclusão | Cancelamento | Origem |
|---|---|---|---|---|---|---|
| Nome do motorista (`driverName`) | Sim, gravado no aceite | Sim | Sim | Sim | Sim | `register-socket-accept-ride-handler.js:462-472` |
| Modelo, placa, cor (`vehicleModel`, `vehiclePlate`, `vehicleColor`) | Sim | Sim | Sim | Sim | Sim | mesmo bloco de `:462-472` |
| ETA até o embarque (`estimatedArrivalToPickupMin`) | Sim, calculado no aceite | Gravado, não usado no push | n/a | n/a | n/a | `commands/AcceptRideCommand.js:740-777` |
| Horário limite de embarque (`boardingDeadlineAt`, janela `DRIVER_BOARDING_WINDOW_SECONDS`, padrão 120 s, mínimo 30 s) | n/a | Sim, gravado na chegada | Sim (já gravado) | n/a | n/a | `register-socket-driver-control-handlers.js:38-40`, `:314-316`, gravado no hash em `:330-352` |
| Endereço de embarque e destino (JSON em `pickupLocation`, `destinationLocation`) | Sim | Sim | Sim | Sim | Sim | `services/ride-passenger-status-push.js:36-37` |
| ETA até o destino | Não gravado no hash | Não | Não gravado. Há cálculo aproximado por Haversine só para o motorista (`start-trip-handler.js:630-646`, 35 km/h) | Duração real em `routeDurationSecs` (persistência, `ride-persistence-service.js:392`) | n/a | |
| Valor (`estimatedFare` na reserva; `finalFare` na conclusão) | Sim | Sim | Sim | Sim (`complete-trip-handler.js:743-745`) | Reembolso em `refundSummary` (`cancel-ride-handler.js:618-628`) | |
| Distância | Não | Não | Não | Sim (`resultDistance`) | n/a | |
| Quem cancelou | n/a | n/a | n/a | n/a | Sim (`initiatorType`, `cancel-ride-handler`) | |

Observações:

- ETA de embarque existe; ETA de viagem, não. Não prometer tempo de viagem sem cálculo novo.
- O valor no push deve ser o bruto pago pelo passageiro. As regras de negócio do AGENTS dizem que a UI do passageiro mostra o valor bruto. Confirmar qual campo entra (`finalFare` pode ser o líquido do motorista em algum caminho).
- Horário limite: o `boardingDeadlineAt` é ISO em UTC. Para mostrar "HH:MM" é preciso converter para o fuso de Brasília.

## 6. Propostas de texto (curtos, sem promessa)

Os textos entre chaves usam os dados da seção 5. Se o dado não existir, o trecho some (não colocar "null" nem "calculando").

**Aceite (alerta visível, substitui "Corrida Aceita!")**
- Título: `{Nome} está a caminho`
- Corpo: `{Modelo} · {Cor} · {Placa}` + ` · Previsão de chegada: ~{N} min` (só se `estimatedArrivalToPickupMin` existir)
- Fallback sem dados do motorista: "Um motorista aceitou sua corrida."

**Chegada (alerta visível, já existe; acrescentar horário)**
- Título: `Seu motorista chegou` (manter)
- Corpo: `{Nome} está no local de embarque · {Modelo} · {Placa}`
- Linha extra: `Embarque até {HH:MM}` (de `boardingDeadlineAt`, fuso de Brasília)
- Pendência de produto: confirmar que o passageiro pode ver o horário limite sem efeito operacional que ele não conheça.

**Viagem iniciada (alerta visível, novo; hoje é silencioso)**
- Título: `Viagem iniciada`
- Corpo: `A caminho de {destino}`

**Chegada ao destino / conclusão (alerta visível, novo; hoje é silencioso)**
- Título: `Você chegou ao destino`
- Corpo: `Obrigado por viajar com a Leaf. Valor: {valor bruto}` (confirmar campo)

**Cancelamento (alerta visível, novo; hoje é silencioso)**
- Título: `Corrida cancelada`
- Corpo: `Veja os detalhes no app.` Sem prometer reembolso ou prazo. Se houver reembolso registrado, pode aparecer `Reembolso registrado: R$ {valor}`, desde que a regra já esteja aprovada.

## 7. Onde implementar

Backend (`leaf-websocket-backend`), reaproveitando `FCMService` e `notifyPassengerRideStatus`:

1. `services/ride-passenger-status-push.js`
   - Criar builders `buildRideAcceptedPush`, `buildTripStartedPush`, `buildTripCompletedPush`, `buildRideCancelledPush`, no mesmo padrão de `buildDriverArrivedPush` (`:52-66`).
   - Em `notifyPassengerRideStatus` (`:88-111`), enviar o alerta para `started`, `completed` e `cancelled` com `sendNotificationToUser`. Hoje só `arrived` envia alerta.
   - Acrescentar `Embarque até HH:MM` em `buildDriverArrivedPush` a partir de `bookingData.boardingDeadlineAt`.
   - Usar `collapseKey` por booking, como já é feito para a chegada (`:59`).
2. `listeners/onRideAccepted.sendPush.js:86-96`
   - Trocar o texto genérico por `buildRideAcceptedPush`. Como o listener só recebe ids, ler `booking:{bookingId}` no Redis (já há `redisPool` no arquivo) ou incluir `driverName`, `vehicleModel`, `vehiclePlate`, `vehicleColor` e `estimatedArrivalToPickupMin` no evento `ride.accepted` (`register-socket-accept-ride-handler.js:302-336`).
3. `bootstrap/register-socket-start-trip-handler.js:562-568`
   - Chamar o alerta `started` (o `notifyPassengerRideStatus` já é chamado; só falta o alerta).
4. `bootstrap/register-socket-complete-trip-handler.js:743-750`
   - Passar o alerta `completed` com o valor bruto. Chamar `notifyPassengerRideStatus` com `status: 'completed'` (hoje só `sendRideStatusUpdate`).
5. `bootstrap/register-socket-cancel-ride-handler.js:618-628`
   - Idem, `status: 'cancelled'`, sem prometer reembolso.
6. `services/fcm-service.js:834-894`
   - `createTripNotification` pode ser reaproveitado ou removido, mas hoje é código morto. Não remover sem `rg` provando que não há uso (AGENTS).

Mobile (`mobile-app`), pequenas mudanças:

7. `src/services/FCMNotificationService.js:22-23, 831-846`
   - Ajustar `screen` do push de chegada para `RobotaxiPrototypeTrip` (no backend, `ride-passenger-status-push.js:60-64`), ou mapear `driver_arrived` no `NOTIFICATION_SCREEN_ALIASES` (`:42-69`).
8. `src/services/FCMNotificationService.js:668-690`
   - Decidir se `RIDE_ACCEPTED` deve ser suprimido em primeiro plano, como `driver_arrived`.
9. Canal `trip_updates`: criar no app (`setNotificationChannelAsync`) ou trocar para um canal que exista, e validar no aparelho.

Live Activity: nenhuma mudança obrigatória. Se os textos mudarem, ajustar `ride-live-activity-service.js:169-192` e o espelho em `RideLiveActivityService.js`.

## 8. Testes e validação sugeridos

- Backend: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` (memória do projeto: rodar com `config/jest.unit.config.js`, senão aparecem falhas falsas). Existe `tests/unit/services/ride-passenger-status-push.unit.test.js` para estender.
- Config: `npm --prefix leaf-websocket-backend run config:validate`.
- Mobile: `npm --prefix mobile-app run test:unit -- --runInBand` e `npm --prefix mobile-app run qa:production-guards`.
- Em aparelho real, com corrida de teste: aceite, chegada, início, conclusão e cancelamento, app em primeiro plano, em segundo plano e fechado (iOS e Android). Verificar o texto, o toque (tela certa) e se a notificação persistente aparece.
- Não apresentar mock como evidência de produção (AGENTS).

## 9. Riscos e pendências

- Valor no push de conclusão: definir se é o bruto do passageiro (regra do AGENTS).
- Horário limite de embarque exibido ao passageiro: confirmar com produto.
- Alerta de início/conclusão/cancelamento aumenta o volume de push. Não há custo de API paga; o FCM segue o limite já existente em `checkRateLimit`.
- Não encontrei em `leaf-websocket-backend` nenhum serviço que mande Live Activity fora do que já existe.
- Não verifiquei em aparelho se a notificação persistente do passageiro aparece hoje (seção 3).
- Mudança só de backend não exige build de loja. Mudança de toque ou de supressão no app é JS, mas precisa de OTA ou nova versão conforme a política de release.

## 10. Rollback

- Backend: reverter o commit que altera `ride-passenger-status-push.js`, `onRideAccepted.sendPush.js`, e os três handlers. Os pushes silenciosos continuam, e o aviso de chegada volta ao texto atual.
- Mobile: reverter a mudança de `screen` ou de supressão em `FCMNotificationService.js`.
- Sem migração de dados: nada é gravado novo no Redis, só lido.

## 11. Fora de escopo deste levantamento

- Nenhum arquivo foi alterado. Nenhum commit. Nenhum deploy.
- Não mexi em regras de taxa, reembolso ou janela de embarque. A janela de 2 minutos é a configuração atual (`DRIVER_BOARDING_WINDOW_SECONDS`, padrão 120).
- Push do motorista (`start-trip-handler.js:650-668`) e pushes de KYC, pagamento e avaliação ficaram fora.
