# Canonical Runtime Services Slice - 2026-05-30

> Atualização de 2026-08-03: a fachada `rideService`, seus bridges e as actions Redux de booking/estimate/rating/trip foram retirados depois que a análise de alcançabilidade comprovou que apenas um dispatch sem reducer ainda os carregava. A avaliação ativa continua pelo `RatingService`, WebSocket e persistência local; a criação de corrida ativa continua pelo `WebSocketManager` e backend canônico.

## Escopo

Primeira fatia segura dos cards `LEA-30`, `LEA-31` e `LEA-32`.

Objetivo: reduzir acoplamento direto entre superficies de runtime e `common-local`, sem remover legado vivo e sem mudar regra de negocio.

## O Que Foi Consolidado

Criada a pasta `mobile-app/src/services/canonical` como fachada canonica para os dominios ainda dependentes de legado vivo:

- `sessionService`: Firebase context, Firebase provider e tipos de sessao.
- `profileService`: acoes de perfil/conta.
- `rideService`: booking, estimate, rating e trip actions.
- `driverService`: chamadas do driver vindas do client API legado.
- `registrationService`: signup, paises, referral e validacao de referenciador.
- `locationService`: autocomplete/geocode/directions, distancia, pedagio e trip tracking.
- `localizationService`: chave de traducao.
- `typographyService`: tipografia herdada.
- `legacyApiService`: unico boundary explicito para o `api` legado.
- `paymentService`: Pix, Woovi, bypass controlado, saldo e saque.

## O Que Foi Migrado

Os bridges em `mobile-app/src/services/runtime` deixaram de importar `common-local` diretamente e passaram a importar as fachadas canonicas.

Tambem foram migradas superficies de pagamento/saldo que ainda chamavam arquivos diretos:

- `PixPayment`
- `PixPaymentBottomSheet`
- `PixPaymentModal`
- `PixPaymentScreen`
- `WooviPaymentModal`
- `PassengerUI`
- `DriverUI`
- `WithdrawMoney`
- `EarningsReportScreen`
- `ProfileScreen`

## prototypeRideRuntime

`prototypeRideRuntime.js` ainda e um arquivo grande e vivo. Nesta fatia, nao houve extracao agressiva de funcoes internas. A reducao de risco foi feita pela dependencia indireta: o runtime continua usando `services/runtime/locationRouteBridge`, mas esse bridge agora aponta para a fachada canonica `locationService`.

Responsabilidades reais identificadas no arquivo:

- bootstrap e persistencia de sessao runtime.
- socket/realtime lifecycle.
- estado passageiro/motorista.
- busca de destino e quote lock.
- pagamento e estado de confirmacao.
- corrida ativa, chegada, embarque, inicio e conclusao.
- tracking de localizacao passageiro/motorista.
- chat e notificacoes persistidas.
- onboarding/ativacao do motorista.
- playback/mock route para QA.
- recuperacao de crash/transicao de app state.

## Boundary Atual

`common-local` segue como legado vivo, mas agora fica concentrado em:

- `mobile-app/src/services/canonical/*`
- `mobile-app/src/state/appStore.js`

Isso prepara `LEA-33` para reduzir/remover imports restantes por dominio, com rollback simples por fachada.

## Validacao

Comandos executados nesta fatia:

- `npm --prefix mobile-app test -- --runTestsByPath __tests__/woovi-payment-modal.test.js __tests__/driver-balance-service-pilot.test.js --runInBand`
- `npm --prefix mobile-app test -- --runTestsByPath __tests__/runtime-access-policy.test.js __tests__/google-api-functions.test.js --runInBand`
- `npm --prefix mobile-app run qa:production-guards`
- `cd mobile-app && npx expo export --platform android --output-dir /tmp/leaf-export-check`
- `cd mobile-app && npx expo export --platform ios --output-dir /tmp/leaf-export-check-ios`
- `cd mobile-app && EAS_BUILD_PROFILE=production npx expo config --type prebuild --json`
- `git diff --check`

Resultado: PASS.

## Proximas Fatias Seguras

1. Extrair busca de destino/cache de `prototypeRideRuntime` para um service dedicado.
2. Extrair quote lock e telemetria de custo para um service dedicado.
3. Extrair heartbeat de localizacao por papel para um service dedicado.
4. Extrair chat/notificacoes persistidas para um service dedicado.
5. Depois disso, reduzir `common-local` restante dentro das fachadas, uma por dominio.
