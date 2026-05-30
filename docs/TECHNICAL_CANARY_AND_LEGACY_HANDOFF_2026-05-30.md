# Technical Canary And Legacy Handoff - 2026-05-30

## Objetivo

Registrar a rodada técnica executada após a sanitização do projeto, com foco em:

- Resolver o ambiente iOS local.
- Executar canary técnica sem device físico obrigatório.
- Preservar a decisão de não mexer em RTDB agora.
- Mapear legado ativo, legado isolado e candidatos de remoção futura.
- Dar aos novos devs o caminho das pedras para reproduzir a validação sem reconstruir contexto histórico.

Esta documentação não representa mudança funcional. Ela registra estado, comandos, evidências e próximos cuidados.

## Decisão Sobre RTDB

RTDB fica no projeto por enquanto.

Motivo:

- Ainda existem dependências diretas em backend, dashboard, suporte, KYC, scripts operacionais e algumas superfícies mobile.
- A remoção completa exigiria migração por domínio, com verificação de dados e compatibilidade.
- O caminho seguro é encapsular por repository/adapter, um domínio por vez, antes de qualquer migração para Firestore ou Redis.

Regra atual:

- Não remover RTDB direto globalmente.
- Não migrar RTDB para Firestore em lote.
- Não trocar rotinas vivas de dashboard/suporte/documentos sem teste do domínio.
- Priorizar primeiro retirar RTDB da superfície crítica mobile quando houver adapter pronto.

## Correção Do iOS Local

### Sintoma

A build/canary iOS local vinha falhando em passos de Xcode/simulator e Pods.

### Causa Encontrada

O problema era de ambiente local/artefatos gerados, não uma regressão funcional do app:

- Alguns comandos diretos estavam usando `/Library/Developer/CommandLineTools` em vez do Xcode completo.
- Artefatos ignorados de iOS (`ios/Pods`, `ios/build`, workspace e lock) estavam contaminados por uma tentativa anterior de instalação/build.
- O estado local de Pods não estava no caminho canônico esperado do projeto.

### Ação Executada

Foram limpos apenas artefatos ignorados pelo git:

```bash
rm -rf mobile-app/ios/Pods \
  mobile-app/ios/build \
  mobile-app/ios/Leaf.xcworkspace \
  mobile-app/ios/Podfile.lock
```

Depois a build foi rodada explicitando o Xcode completo:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
IOS_SIMULATOR_CONFIGURATION=Debug \
npm --prefix mobile-app run build:local:ios:simulator
```

Resultado:

- `** BUILD SUCCEEDED **`
- App iOS simulator gerado em `mobile-app/ios/build`.
- `CFBundleVersion`: `23`.
- Expo config embutida conferida.
- `NSMicrophoneUsageDescription` presente.

### Warnings Conhecidos Do iOS

Warnings observados e não bloqueantes nesta rodada:

- Build phases sem outputs em alguns Pods/scripts.
- Pods com deployment target antigo.
- `MODULEMAP_FILE has no effect if DEFINES_MODULE is not set` em `react-native-maps`/`react-native-google-maps`.

Esses warnings devem entrar em backlog técnico, mas não bloquearam a build.

## Canary Técnica Executada

### Guardrails E Configuração

Comandos executados:

```bash
npm --prefix mobile-app run qa:production-guards
npm --prefix leaf-websocket-backend run check:no-active-vps-runtime
npm --prefix leaf-websocket-backend run config:validate:real-sandbox
npm --prefix leaf-websocket-backend run smoke:woovi-sandbox
git diff --check
node scripts/maintenance/security/scan-secrets.cjs --tracked-only
bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh
```

Resultado:

- Mobile production guards: PASS.
- Runtime antigo `vps` fora dos composes ativos: PASS.
- Woovi sandbox validado como sandbox: PASS.
- Woovi smoke: PASS, cobrança `ACTIVE`, QR presente, cleanup OK.
- Whitespace diff: PASS.
- Scanner de secrets tracked-only: PASS.
- Hardcoded secret guard: PASS.

Observação:

- `config:validate:real-sandbox` alerta corretamente que `NODE_ENV=production` está usando Woovi sandbox e que biometria estrita está desligada. Isso é esperado para canary sandbox.

### Testes Mobile

Comando alvo:

```bash
cd mobile-app
npx jest --config jest.config.js --runInBand --runTestsByPath \
  __tests__/realtime-connection-orchestrator.test.js \
  __tests__/websocket-manager-auth.test.js \
  __tests__/websocket-manager-driver-status.test.js \
  __tests__/driver-online-location-seed.test.js \
  __tests__/live-route-timing.test.js \
  __tests__/runtime-crash-recovery.test.js \
  __tests__/ride-card-contract.test.js \
  __tests__/driver-live-ride-overlay.test.js \
  __tests__/passenger-flow-routing.test.js \
  __tests__/prototype-map-route.test.js
```

Resultado:

- 10 suites PASS.
- 52 tests PASS.

Observação:

- Jest reportou handle aberto ao final. Não falhou a suite, mas deve ser saneado em uma frente própria para reduzir ruído de QA.

### Testes Backend

Comando alvo:

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js --runInBand --runTestsByPath \
  tests/unit/repositories/support-legacy-rtdb-repository.unit.test.js \
  tests/unit/services/support-ticket-service-rtdb-adapter.unit.test.js \
  tests/unit/services/financial-ledger-service.unit.test.js \
  tests/unit/services/ride-settlement-service.unit.test.js \
  tests/unit/services/driver-activation-state-service.unit.test.js \
  tests/unit/services/driver-eligibility-service.unit.test.js \
  tests/unit/services/campaign-center-service.unit.test.js \
  tests/unit/routes/campaign-center-routes.unit.test.js \
  tests/unit/services/referral-program-state-service.unit.test.js \
  tests/unit/services/waitlist-notification-service.unit.test.js \
  tests/unit/bootstrap/register-socket-authenticate-handler.unit.test.js \
  tests/unit/services/trip-location-persistence-service.unit.test.js \
  tests/unit/services/pricing-h3-read-model-service.unit.test.js
```

Resultado:

- 13 suites PASS.
- 52 tests PASS.

### Dashboard

Comandos:

```bash
npm run lint:dashboard
npm run build:dashboard
```

Resultado:

- Lint PASS.
- Build PASS.

Warnings conhecidos:

- Next.js inferiu workspace root por múltiplos lockfiles.
- Convenção `middleware` deprecated em favor de `proxy`.

### Canary Preflight Geral

Comando:

```bash
npm run canary:preflight:non-device
```

Resultado:

- Status final: GO.
- Relatório: `reports/canary-preflight/canary-preflight-20260530T014610Z/report.md`.

Gates com PASS:

- Git diff sem whitespace inválido.
- Backend sensitive route guards.
- Woovi Pix sandbox real.
- Backend unit + integration.
- Mobile onboarding copy.
- Mobile testIDs essenciais.
- Mobile unit tests.
- Mobile release preflight estático.
- Dashboard lint.
- Dashboard build.
- Support orchestrator syntax check.
- Dry-run limpeza financeira de teste.
- Reconciliação financeira live.

### Runtime Smoke

Comandos:

```bash
npm --prefix leaf-websocket-backend run smoke:runtime-full-ride-flow
npm --prefix leaf-websocket-backend run smoke:runtime-critical-events
npm --prefix leaf-websocket-backend run smoke:runtime-redis-adapter
```

Resultado:

- Full ride flow PASS em runtime `vps` e `modular`.
- Critical events PASS em runtime `vps` e `modular`.
- Redis adapter PASS.

Evidências:

- `test-results/runtime-full-ride-flow/runtime-full-ride-flow-smoke-1780106112883.json`
- `test-results/runtime-critical-events/runtime-critical-events-smoke-1780106100119.json`
- `test-results/runtime-redis-adapter/runtime-redis-adapter-smoke-1780106100074.json`

Pontos validados pelo full ride flow:

- Autenticação passenger/driver.
- Driver online.
- Booking criado.
- Pagamento confirmado.
- Motorista notificado.
- Corrida aceita.
- Chegada no embarque.
- Início de viagem.
- Atualizações de localização.
- Conclusão.
- Distribuição financeira.
- Limpeza das chaves ativas no Redis.

## Evidências Visuais De Simulador

Evidências geradas:

- `test-results/technical-canary/ios-debug-clean-launch-20260530T0150.png`
- `test-results/technical-canary/android-debug-clean-auth-dismissed-20260530T0205.png`
- `test-results/technical-canary/android-debug-clean-launch-20260530T0201.png`
- `test-results/technical-canary/ios-debug-launch-20260530T0148.png`
- `test-results/technical-canary/ios-debug-prototype-home-20260530T0202.png`
- `test-results/technical-canary/ios-debug-prototype-home-late-20260530T0203.png`

### iOS

O app abriu corretamente após reinstalação limpa do bundle no simulator.

Observação:

- Antes da limpeza do container, o simulator abriu em uma corrida antiga persistida. Isso era contaminação de estado local do simulador, não comportamento da build.
- Após uninstall/install limpo, abriu no onboarding/telefone.

### Android

O AVD `Leaf_API_35` subiu com o SDK explícito:

```bash
/Users/izaakdias/Android/Sdk/emulator/emulator -avd Leaf_API_35
```

O APK debug existente foi instalado e abriu no emulator:

```bash
/Users/izaakdias/Android/Sdk/platform-tools/adb install -r mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
/Users/izaakdias/Android/Sdk/platform-tools/adb reverse tcp:8081 tcp:8081
```

Observação:

- A primeira abertura exibiu o developer menu, esperado em dev build.
- Após dismiss, o onboarding/telefone ficou consistente com iOS.

## Achados Técnicos

### 1. Firebase Namespaced API Ainda Gera Muitos Warnings

No Android, Metro mostrou vários warnings:

- `React Native Firebase namespaced API ... will be removed in the next major release`.
- Métodos citados: `getApp`, `ref`, `orderByChild`, `onAuthStateChanged`, `onMessage`, `getInitialNotification`, `setBackgroundMessageHandler`, etc.

Diagnóstico:

- É legado ativo de API RNFirebase namespaced.
- Não quebrou build nem canary técnica.
- Deve virar frente planejada de migração modular RNFirebase, separada de RTDB/data migration.

### 2. common-local Ainda Inicializa Muitas Referências RTDB

Durante o boot Android, apareceram logs de inicialização para caminhos como:

- `users`
- `bookings`
- `settings`
- `cartypes`
- `vehicles`
- `promos`
- `notifications`
- `locations`
- `withdraws`
- `payment_settings`
- `sos`
- `complain`

Diagnóstico:

- Mesmo com UI nova, `common-local` e `firebase-refs` ainda materializam parte grande da superfície RTDB.
- Isso não significa que todos os fluxos usem esses paths em runtime crítico, mas indica acoplamento de boot.

Recomendação futura:

- Primeiro lazy-load/encapsular refs por domínio.
- Depois remover imports diretos de `common-local`.
- Só depois discutir remoção/migração de paths RTDB.

### 3. Deeplink Publico Para Prototype Sem Auth Ficou Em Skeleton

Ao abrir `leafapp://robotaxi/home?qaAutomation=1&role=customer` no iOS sem sessão autenticada, a tela ficou com skeleton em `RobotaxiPrototype`.

Diagnóstico:

- Não representa o fluxo normal de usuário limpo.
- É um indício de que a rota prototype pública/QA depende de estado que não está hidratado sem auth.

Recomendação:

- Não usar esse deeplink público como evidência visual definitiva.
- Validar prototype UI com sessão QA autenticada ou fluxo real.
- Se essa rota pública precisar existir, criar estado mock/QA explícito ou bloquear acesso sem auth.

### 4. Android/iOS Debug São Consistentes Na Tela Limpa

Após limpar estado local:

- iOS abriu onboarding/telefone.
- Android abriu onboarding/telefone.

Diferença esperada:

- Android dev build pode exibir developer menu na primeira abertura.

## Legado Ativo - Nao Remover Sem Plano

### Mobile

- `mobile-app/src/common-local`
  - Ainda usado por runtime bridges e store.
  - Deve ser migrado gradualmente para serviços canônicos.

- `mobile-app/src/firebase-refs.js`
  - Centraliza refs RTDB legadas no mobile.
  - Ainda é usado indiretamente por fluxos antigos/bridges.

- `mobile-app/src/screens/prototype/*`
  - Apesar do nome `prototype`, é a UI atual/canônica do ciclo de corrida.
  - Não renomear/remover agora.

- Rotas `RobotaxiPrototype*`
  - São nomes vivos para navegação, deep links e FCM.
  - Não renomear sem camada de aliases e janela de compatibilidade.

- `MapScreen` e `TabRoot`
  - Aliases de compatibilidade em `AppNavigator`.
  - Mantidos porque telas antigas ainda podem navegar para eles.

- `NewMapScreen`
  - Fallback quando prototype UI não está habilitado.
  - Não remover enquanto existir flag/fallback.

- `SupportChat`, `TripTracking`, `DriverDocuments`, `DriverIncome`, `SubscriptionManagement`, `AddVehicle`, `MyVehicles`, `CarEdit`, `Cars`, `DriverDashboard`
  - Ainda registrados no `AppNavigator`.
  - Podem estar fora do fluxo principal novo, mas são reachable.
  - Exigem inventário de navegação antes de remover.

### Backend

- `leaf-websocket-backend/server.js`
  - Runtime modular atual.

- `leaf-websocket-backend/server.vps.js`
  - Runtime legado/rollback.
  - Não está ativo nos composes validados, mas segue como rollback documentado.

- RTDB em suporte/documentos/driver/user/payment scripts
  - Vários serviços e scripts ainda leem/escrevem RTDB.
  - Migrar apenas por domínio.

- `IntegratedKYCService`, `routes/kyc-routes.js`, `aws-face-liveness-service`, `device-face-embedding-verification-service`, `biometric-face-client`
  - Caminho KYC atual.

- `services/face-compare-service`
  - Serviço atual de face compare.

- Ledger, ride settlement, withdrawals, Woovi sandbox/prod config
  - Vivos e críticos.
  - Não alterar sem teste de idempotência/ledger.

### Dashboard

- Páginas de campanhas, usuários, suporte, documentos, financeiro e waitlist seguem vivas.
- Dashboard build passou; não há indicação de superfície quebrada nesta rodada.

## Legado Isolado Ou Candidato De Remocao Futura

### KYC Antigo

- `leaf-websocket-backend/services/kyc-service.js`
  - Isolado.
  - Teste `kyc-legacy-boundary` garante que `IntegratedKYCService` não volte a chamá-lo diretamente.
  - Não remover ainda sem decisão final.

- `services/kyc-service/`
  - Python antigo.
  - Documentado como legado temporário.
  - Forte candidato a remoção se `face-compare-service` cobrir tudo em produção/canary.

### Financeiro/Plano/Wallet Legados

Rotas que já apontam para indisponível/piloto ou substituição:

- `FreeTrial`
- `PlanSelection`
- `AddMoney`
- `WalletDetails`
- `AccountStatement`
- `addMoney`
- `WeeklyPayment`
- `WeeklyPaymentScreen`

Rotas BaaS:

- `BaaSAccount`
- `BaaSAccountScreen`

Hoje apontam para entry de payout/placeholder, não para a superfície BaaS antiga.

Cuidados:

- Não remover nomes ainda se existirem deep links, histórico de navegação ou FCM que apontam para eles.
- Remover primeiro imports/componentes mortos, depois aliases, com uma release de compatibilidade.

### Docs E Patches Antigos

Existem docs/patches antigos que citam telas e nomes legados.

Regra:

- Não usar docs antigos como prova de runtime ativo.
- Runtime ativo deve ser comprovado por `rg`, `AppNavigator`, FCM routes, deep links e testes.

## Caminho Seguro Para Novos Devs

Antes de mexer em legado:

1. Rodar `git status --short`.
2. Provar uso/ausência com `rg`.
3. Confirmar se o nome aparece em:
   - `mobile-app/src/navigation/AppNavigator.js`
   - `mobile-app/src/services/FCMNotificationService.js`
   - `mobile-app/src/screens/prototype/robotaxiMenuConfig.js`
   - rotas backend
   - scripts operacionais
4. Se tocar mobile:
   - `npm --prefix mobile-app run qa:production-guards`
   - `cd mobile-app && npx expo config --json`
   - Jest alvo do domínio.
5. Se tocar backend:
   - Jest alvo do domínio.
   - `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`
   - `npm --prefix leaf-websocket-backend run config:validate:real-sandbox`
6. Se tocar dashboard:
   - `npm run lint:dashboard`
   - `npm run build:dashboard`
7. Se tocar pagamento:
   - `npm --prefix leaf-websocket-backend run smoke:woovi-sandbox`
   - testes de ledger/idempotência.
8. Se tocar ciclo de corrida:
   - `npm --prefix leaf-websocket-backend run smoke:runtime-full-ride-flow`
   - testes mobile de ride card/runtime/mapa.

## Comandos De Reproducao Rápida

### iOS Debug Simulator

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
IOS_SIMULATOR_CONFIGURATION=Debug \
npm --prefix mobile-app run build:local:ios:simulator
```

Instalar no simulator bootado:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcrun simctl install booted mobile-app/ios/build/Build/Products/Debug-iphonesimulator/Leaf.app
```

### Android Debug Emulator

```bash
/Users/izaakdias/Android/Sdk/emulator/emulator -avd Leaf_API_35
/Users/izaakdias/Android/Sdk/platform-tools/adb install -r mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
/Users/izaakdias/Android/Sdk/platform-tools/adb reverse tcp:8081 tcp:8081
```

### Metro Para Debug

```bash
cd mobile-app
EXPO_PUBLIC_E2E_TEST=1 \
EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=1 \
EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=1 \
EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK=1 \
LEAF_DISABLE_UPDATES_FOR_SIMULATOR=1 \
LEAF_INCLUDE_DEV_CLIENT=1 \
EXPO_PUBLIC_LEAF_LAUNCH_PROFILE=full \
npx expo start --dev-client --host localhost --port 8081
```

## Proximas Frentes Recomendadas

1. Criar plano próprio para RNFirebase modular API, sem misturar com migração RTDB.
2. Encapsular RTDB mobile por domínio, começando por refs que inicializam no boot sem necessidade.
3. Revisar deeplink público/QA `RobotaxiPrototype` para evitar skeleton sem auth.
4. Fazer inventário de rotas registradas no `AppNavigator` que hoje apontam para placeholder.
5. Separar remoção futura em commits pequenos:
   - aliases financeiros inativos
   - telas BaaS mortas
   - KYC Python antigo
   - aliases de mapa
   - docs antigos/patches históricos

## Estado Final Da Rodada

- Código funcional validado.
- iOS local corrigido.
- Android emulator validado em abertura limpa.
- Canary técnica `GO`.
- RTDB mantido e documentado como legado vivo.
- Novas evidências foram geradas em `test-results/`.
- Não houve alteração funcional de produto nesta rodada.
