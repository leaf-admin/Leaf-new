# Runtime Sanitization Execution - 2026-03-27

## Escopo executado
- sanear o runtime atual do app mobile (`passenger` + `driver`) sem quebrar o core da corrida
- manter compatibilidade mínima onde o legado ainda existe no projeto, mas impedir que ele continue sendo a trilha principal

## O que mudou

### 1. Bootstrap e perfil do app saíram do RTDB
- fonte moderna criada no backend:
  - `GET /api/account/profile`
  - `PUT /api/account/profile`
- arquivo:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/routes/account-routes.js`

### 2. Migração segura com compatibilidade
- leitura principal do perfil agora vem de `Firestore + API VPS`
- fallback de migração:
  - se `users/{uid}` existir só no RTDB, o backend migra para Firestore na primeira leitura
- espelhamento compatível ainda existe:
  - `ENABLE_LEGACY_PROFILE_RTDB_MIRROR=true` mantém legado antigo vivo sem tornar RTDB a fonte primária

### 3. App mobile passou a hidratar sessão pela fonte moderna
- arquivos:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/AuthProvider.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/utils/userDatabaseService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/MobileProfileService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/SplashScreen.js`
- resultado:
  - sessão restaurada por `AsyncStorage + /account/profile`
  - perfil/onboarding persistidos via backend moderno
  - atualização de FCM token deixou de escrever direto em `RTDB users/{uid}`

### 4. Runtime atual parou de expor a navegação privada legada
- arquivo:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js`
- comportamento novo:
  - com `PROTOTYPE_ROBOTAXI_UI_ENABLED=true`, o app expõe apenas a stack atual do protótipo e poucas telas auxiliares seguras
  - as telas privadas legadas continuam disponíveis apenas quando o protótipo é desligado

### 5. Fluxo morto de senha saiu da auth atual
- arquivo:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/AuthFlow.js`
- removido do runtime atual:
  - `PasswordLoginStep`
  - `ForgotPasswordStep`
- motivo:
  - `PhoneInputStep` já não chamava mais a trilha de senha
  - manter essas telas importadas só preservava dependência desnecessária do RTDB no bundle da auth atual

## Efeito prático da navegação
- rotas privadas legadas isoladas do runtime atual:
  - `48` rotas compartilhadas antigas
  - `19` rotas privadas antigas de passageiro
  - `25` rotas privadas antigas de motorista
  - total isolado no modo protótipo: `92`

- rotas do runtime atual mantidas:
  - `11` rotas compartilhadas do protótipo
  - `11` rotas do protótipo de passageiro
  - `4` rotas do protótipo de motorista
  - `4` rotas auxiliares seguras
  - total exposto no modo atual: `30`

## Testes executados

### Backend
1. endpoint novo sem token:
   - `GET https://api.147.182.204.181.sslip.io/api/account/profile`
   - resultado: `401`
   - interpretação: rota publicada e protegida corretamente

2. deploy na VPS:
   - arquivo remoto e arquivo dentro do container com mesmo hash:
   - `9bcd9cc48d810e9d3d512a06516c9f3490c52334dd280b6c5ca8614f08a56525`

3. health:
   - `leaf-websocket` recriado
   - `GET /health/quick` retornando `healthy`

4. corrida E2E completa na VPS:
   - relatório:
     - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/ride-cost-window-vps-1774643567056.json`
   - resultado:
     - `requested = 1`
     - `accepted = 1`
     - `completed = 1`
     - comandos:
       - `RequestRide = 1`
       - `AcceptRide = 1`
       - `StartTrip = 1`
       - `CompleteTrip = 1`

### Mobile
1. checagem de sintaxe:
   - `AppNavigator.js`: ok
   - `AuthFlow.js`: ok
   - `account-routes.js`: ok

2. bundle Android:
   - `expo export --platform android`: sucesso
   - saída:
     - `/tmp/leaf-export-sanitize`

3. build Android release:
   - sucesso
   - artefato:
     - `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/apk/release/app-release.apk`

## Melhorias além da sanitização

### 1. Menos risco de custo oculto no RTDB
- o bootstrap do app não precisa mais ler `users/{uid}` no RTDB
- o onboarding atual não grava mais perfil diretamente no RTDB
- isso reduz leitura/gravação desnecessária toda vez que o app abre ou finaliza cadastro

### 2. Menos risco de regressão funcional
- o usuário atual do app não cai mais em telas privadas antigas por acidente enquanto o protótipo está ativo
- isso reduz muito a chance de tocar serviços antigos (`TripDataService`, `VehicleService`, `DriverUI`, `MapScreen`, `MyVehiclesScreen`) sem intenção

### 3. Menos duplicidade de fonte de verdade
- perfil/sessão agora têm uma trilha principal coerente:
  - `Firebase Auth` para identidade
  - `VPS + Firestore` para perfil
  - `AsyncStorage` apenas como cache local

### 4. Menos trabalho repetido na inicialização
- `AuthProvider` passou a marcar sincronização concluída quando a hidratação moderna funciona
- isso reduz loops de sync/re-hidratação desnecessários na abertura do app

## O que ainda existe como legado isolado

### No mobile
- ainda usam RTDB, mas ficaram fora do runtime principal atual:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/NewMapScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/MapScreen.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/map/DriverUI.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/map/DriverStartTripUI.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/map/DriverEnRouteUI.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/TripDataService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/VehicleService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/VehicleNotificationService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/ReceiptService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/UserAuthService.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/auth/steps/ForgotPasswordStep.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/MyVehiclesScreen.js`

### No backend/admin
- ainda há uso de RTDB em superfícies fora do hot path principal:
  - dashboard/admin
  - referral/geofence/promotions/legacy helpers
- essas trilhas não foram desligadas nesta rodada porque o objetivo aqui foi sanear o app atual sem quebrar a operação principal

## Veredito
- runtime atual do app: **sanitizado com segurança**
- core da corrida: **preservado**
- backend de perfil moderno: **publicado**
- legado: **não removido do projeto**, mas **isolado do runtime principal do app**

## Próxima etapa recomendada
1. migrar `dashboard/admin` para parar de depender de RTDB
2. retirar `NewMapScreen/DriverUI/TripDataService` do runtime legado
3. desativar definitivamente `bookingScheduler` e a stack `bookings` do RTDB quando o dashboard/admin também estiverem fora dessa dependência
