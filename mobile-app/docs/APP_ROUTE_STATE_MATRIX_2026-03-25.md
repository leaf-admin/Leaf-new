# App Route + State Matrix (2026-03-25)

## Como usar
- Cada tela abaixo deve ser validada em pelo menos os estados `loading`, `success`, `empty`, `error`, `blocked` e `back navigation`, quando aplicavel.
- Para telas de corrida ou operacao em tempo real, adicionar `reconnect`, `background`, `kill/reopen` e `deep link return`.
- Para qualquer rota legacy ou alias, a validacao deve responder: `ainda pode ser acessada?`, `faz sentido manter?`, `abre UI correta ou legacy?`.

## Grupo A - Publico e autenticacao
- `Splash`: cold start, sessao valida, sessao invalida, backend lento, role indefinida.
- `Legal`: abrir sem login, link funcional, scroll, retorno.
- `PrivacyPolicy`: abrir sem login, link funcional, scroll, retorno.
- `WelcomeScreen`: reachability, copy final, proximo passo correto.
- `ProfileSelectionScreen` / `ProfileSelection`: selecao de role, persistencia, retorno.
- `CompleteRegistration`: campos obrigatorios, validacao, retorno.
- `DriverTerms`: aceite, recusa, retorno.
- `CNHUploadScreen` / `CNHUpload`: upload, erro, retorno, persistencia.
- `CRLVUploadScreen` / `CRLVUpload`: upload, erro, retorno, persistencia.
- `OTP`: codigo valido, codigo invalido, expiracao, retry.
- `PhoneInputScreen` / `PhoneScreen` / `Login` / `AuthScreen`: mascara, validacao, estado loading, erro e navegacao seguinte.

## Grupo B - Passageiro core (prototipo)
- `Map` / `RobotaxiPrototype`: home correta por role, localizacao, recentralizacao, retorno de sessoes e overlays.
- `RobotaxiPrototypeDestination`: busca, voz, vazio, erro, selecao de destino, volta.
- `RobotaxiPrototypeBooking`: quote, categoria, tarifas e bloqueio de CTA.
- `RobotaxiPrototypePayment`: pix, retry, erro, cancelamento, transicao para sucesso/falha.
- `RobotaxiPrototypePaymentSuccess`: estado final, avancar para busca, retorno seguro.
- `RobotaxiPrototypePaymentFailed`: retry, cancelar, voltar para quote.
- `RobotaxiPrototypeDriverSearch`: timer, waiting state, cancelamento, no drivers, aceite remoto.
- `RobotaxiPrototypeTrip`: motorista aceito, chegada, boarding, inicio, tracking, reconnect.
- `RobotaxiPrototypeChat`: criar sessao, enviar, receber, erro, retry, retorno.
- `RobotaxiPrototypeSupport`: ticket, incidente, chat, retorno.
- `RobotaxiPrototypeReceipt`: breakdown financeiro, status final, retorno.
- `RobotaxiPrototypeCancellation`: motivo, valores, retorno.
- `RobotaxiPrototypeRating`: avaliacao, item obrigatorio, envio e pos-envio.
- `RobotaxiPrototypeComplain`: motivo, envio, retorno.
- `RobotaxiPrototypeNoDrivers`: mensagem, retry e fallback.

## Grupo C - Motorista core (prototipo)
- `Map` / `RobotaxiPrototype` em role `driver`: card operacional, estado online/offline, erro de ativacao e reconnect.
- `RobotaxiPrototypeDriverPanel`: home operacional, saldo, CTA, retorno.
- `RobotaxiPrototypeDriverActivation`: checklist, upload, status remoto, falha, aprovacao.
- `RobotaxiPrototypeDriverOffer`: recebimento, timeout, aceite, recusa e bloqueios.
- `RobotaxiPrototypeDriverTrip`: chegada, inicio, navegacao, conclusao, erro de status.
- `EarningsReport`: periodo, loading, vazio, erro, consistencia com saldo.

## Grupo D - Perfil, menu e configuracoes (prototipo)
- `RobotaxiPrototypeProfile`: dados corretos por role, campos, retorno.
- `RobotaxiPrototypeSettings`: toggles, persistencia, role safety, retorno.
- `RobotaxiPrototypeMenu`: itens corretos por role, navegacao e safe area.
- `RobotaxiMenuEditProfile`: reachability, formulario, salvar, voltar.
- `RobotaxiMenuTripHistory`: lista, vazio, item, retorno.
- `RobotaxiMenuMessages`: lista, badge, abrir conversa.
- `RobotaxiMenuHelp`: ajuda, ticket, retorno.

## Grupo E - Telas compartilhadas/legacy ainda registradas
- `Search`, `Chat`, `Notifications`, `Settings`, `Help`, `About`, `Rides`, `Profile`, `Support`.
- `Dashboard`, `Trips`, `DriverBalance`, `DriverRating`, `DriverSearch`, `DriverIncome`, `WeeklyPayment`, `SubscriptionManagement`.
- `EditProfile`, `EditProfileScreen`, `PersonalData`, `UserInfo`.
- `AddVehicle`, `MyVehicles`, `CarEdit`, `Cars`, `VehicleRegistration`.
- `BookedCab`, `TripTracking`, `RideDetails`, `Receipt`, `Cancellation`, `Feedback`, `Complain`.
- `PaymentSuccess`, `PaymentFailed`, `SelectGateway`, `PaymentDetails`, `AddPaymentMethod`, `AddMoney`, `WithdrawMoney`, `WalletDetails`.
- `SupportTicket`, `SupportChat`, `WaitList`, `WooviDriverBalance`, `DriverDocuments`.

## Grupo F - Aliases de compatibilidade que exigem auditoria
- `Messages`
- `RideListScreen`
- `MyEarning`
- `AccountSettings`
- `AccountStatement`
- `BookingConfirmation`
- `CancellationSuccess`
- `MapScreen`
- `SettingsScreen`
- `HelpScreen`
- `DriverDashboard`
- `DriverTrips`
- `CarEditScreen`
- `MyVehiclesScreen`
- `PlanSelection`
- `ReferralScreen`
- `BaaSAccountScreen`
- `PaymentSuccessScreen`
- `PixPayment`
- `TabRoot`
- `TransactionHistory`
- `TransferMoney`
- `TripTrackingScreen`
- `TripDetails`
- `ReceiptDetails`
- `UpdateBankInfo`
- `WeeklyPaymentScreen`
- `EarningsReportScreen`
- `addMoney`
- `paymentMethod`
- `onlineChat`

## Estados obrigatorios por tela
- `loading`: tela responde com feedback claro e sem travar navegacao.
- `success`: dados corretos, CTA coerente, texto final consistente.
- `empty`: mensagem adequada e CTA util.
- `error`: mensagem clara, retry ou retorno seguro.
- `blocked`: sem permissao, sem docs, sem internet, sem pagamento ou sem role.
- `reconnect`: retomada sem estado impossivel.
- `back navigation`: pilha consistente, sem voltar para tela proibida.

## Riscos prioritarios da estrutura atual
- O navigator mistura fluxo principal, fluxo legacy, aliases e prototipo no mesmo stack privado.
- Ha varias rotas diferentes apontando para o mesmo componente, o que aumenta o risco de entrada por caminho antigo.
- O `Map` sempre aponta para `RobotaxiPrototypeScreen`, logo o runtime de role precisa ser validado com extremo cuidado.
- O app ainda precisa responder formalmente quais telas legacy continuam suportadas e quais devem ser tornadas inacessiveis.
