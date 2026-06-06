# Canonical Runtime Services Slice - 2026-05-30

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

Atualizacao 2026-06-06 (`LEA-32`):

- Primeira extracao interna pequena concluida.
- Busca/cache/normalizacao de destino saiu de `prototypeRideRuntime.js` para `src/screens/prototype/prototypeDestinationSearchRuntime.js`.
- A extracao preserva comportamento: coordenadas continuam aceitas apenas quando numericas, cache segue curto, token de sessao segue com janela de idle.
- Segunda extracao interna pequena concluida.
- Quote lock, normalizacao de coordenadas/rota e budget de Directions por booking sairam de `prototypeRideRuntime.js` para `src/screens/prototype/prototypeQuoteRuntime.js`.
- A extracao preserva comportamento: quote lock segue com TTL, chave por coordenada arredondada, rota limitada e bloqueio local quando o booking excede o limite de requisicoes de Directions.
- Nenhuma regra de socket, pagamento, corrida ativa, UI ou lifecycle foi alterada.

Responsabilidades reais identificadas no arquivo:

- bootstrap e persistencia de sessao runtime.
- socket/realtime lifecycle.
- estado passageiro/motorista.
- busca de destino e quote lock via helpers dedicados.
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

Comandos adicionais executados em 2026-06-06 para `LEA-32`:

- `npm --prefix mobile-app run test:unit -- --runTestsByPath __tests__/prototype-destination-search-runtime.test.js __tests__/prototype-ride-runtime-financial-snapshot.test.js --runInBand`
- `npm --prefix mobile-app run test:unit -- --runTestsByPath __tests__/prototype-destination-search-runtime.test.js __tests__/prototype-quote-runtime.test.js __tests__/prototype-ride-runtime-financial-snapshot.test.js --runInBand`
- `npm --prefix mobile-app run qa:production-guards`
- `git diff --check`
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`

Resultado 2026-06-06: PASS.

## Proximas Fatias Seguras

1. Extrair telemetria de custo/context binding para um service dedicado.
2. Extrair heartbeat de localizacao por papel para um service dedicado.
3. Extrair chat/notificacoes persistidas para um service dedicado.
4. Depois disso, reduzir `common-local` restante dentro das fachadas, uma por dominio.
