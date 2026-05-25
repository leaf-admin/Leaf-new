# App - Diff Completo de Logica e Comportamento (2026-03-24)

## Escopo
Este documento consolida as mudancas de logica/comportamento feitas no app real (nao prototipo), junto da migracao de design aprovado para telas reais prioritarias.

## Arquivos analisados neste diff
- `mobile-app/src/services/WebSocketManager.js`
- `mobile-app/src/components/map/PassengerUI.js`
- `mobile-app/src/components/map/DriverUI.js`
- `mobile-app/src/screens/NewMapScreen.js`
- `mobile-app/src/navigation/AppNavigator.js`
- `mobile-app/src/services/DriverOnboardingService.js`
- `mobile-app/src/components/auth/steps/CredentialsStep.js`
- `mobile-app/src/screens/SettingsScreen.js`
- `mobile-app/src/screens/SupportScreen.js`
- `mobile-app/src/screens/SupportChatScreen.js`
- `mobile-app/src/screens/SupportTicketScreen.js`
- `mobile-app/src/screens/HelpScreen.js`
- `mobile-app/src/screens/AboutScreen.js`
- `mobile-app/src/screens/ProfileScreen.js`
- `mobile-app/src/components/map/DriverEnRouteUI.js`
- `mobile-app/src/components/map/DriverStartTripUI.js`
- `mobile-app/src/components/map/DriverOnTripUI.js`

---

## 1) Resiliencia de WebSocket e autenticacao (impacto direto de disponibilidade)

### 1.1 `authenticateWithAck` com retry/backoff para `AUTH_BUSY`
Arquivo: `mobile-app/src/services/WebSocketManager.js`
- Metodo novo com dedupe de auth em voo: `authenticateWithAck(...)` (linhas ~776-835).
- Retry com jitter para erro de saturacao (`AUTH_BUSY`) e suporte a `retryAfterSec` (linhas ~791-817).
- Timeout de autenticacao padronizado e erro amigavel (`AUTH_TIMEOUT`) (linhas ~888-893).

Efeito de comportamento:
- Evita queda de sessao por picos momentaneos no handshake.
- Reduz falhas de autenticacao concorrente (duas chamadas simultaneas agora compartilham a mesma promise em voo).

### 1.2 Reducao de ruido de conectividade e reconnect mais robusto
Arquivo: `mobile-app/src/services/WebSocketManager.js`
- Throttling de logs de erro transiente de transporte (`_logConnectError`) (linhas ~252-316).
- Parametros de conexao/reconexao consolidados e timeout maior para ambiente movel (linhas ~210-235).

Efeito de comportamento:
- Menos falso-positivo de erro em oscilacao curta.
- Reconexao mais estavel sem poluir log e sem derrubar experiencia do usuario.

---

## 2) `createBooking` resiliente (sem "corrida perdida" por timeout transitorio)

### 2.1 Retry com idempotencia e reconciliacao
Arquivo: `mobile-app/src/services/WebSocketManager.js`
- Chave de idempotencia por contexto de corrida (`_buildCreateBookingIdempotencyKey`) (linhas ~902-923).
- Retry classificando erros recuperaveis (`_isCreateBookingRetryable`) (linhas ~925-944).
- Delay progressivo + jitter respeitando `retryAfterSec` (`_extractCreateBookingRetryDelayMs`) (linhas ~946-955).
- Reconciliacao via `syncActiveRideWithAck` se houver duvida de estado (`_recoverCreateBookingFromSync`) (linhas ~957-993).
- `createBooking(...)` com retries e fallback de reidratacao (linhas ~1064-1155).

Efeito de comportamento:
- Em timeout/intermitencia, o app tenta recuperar corrida existente em vez de abortar fluxo do passageiro.
- Diminui risco de pagamento confirmado sem reflexo de corrida visivel no app.

### 2.2 Passenger flow adaptado para erro recuperavel
Arquivo: `mobile-app/src/components/map/PassengerUI.js`
- Troca de `authenticate(...)` por `authenticateWithAck(...)` com retries (linhas ~1912, ~1942, ~3920).
- Novo classificador `isRecoverableBookingError` (`BOOKING_TIMEOUT`/`DUPLICATE_REQUEST`) (linhas ~2016-2019).
- `handleBookingError` agora tenta reconciliar com `syncActiveRideWithAck(12000)` antes de derrubar para idle (linhas ~2132-2157).
- Em erro recuperavel no envio de booking, mantem estado de busca e informa "Finalizando solicitacao" (linhas ~3962-3971).

Efeito de comportamento:
- Menos cancelamento prematuro de corrida no cliente.
- Menos abandono por mensagem de erro irreversivel quando o backend ainda pode concluir.

---

## 3) Handshake de online do motorista endurecido

Arquivo: `mobile-app/src/components/map/DriverUI.js`
- Ao ativar online: autentica com ACK (retry), exige localizacao valida, envia `setDriverStatus` com payload de localizacao e reforca `updateLocation` imediato (linhas ~2560-2593).
- Offline com `await` no `setDriverStatus(..., false)` para confirmar mudanca no backend (linhas ~2636-2644).
- Chamadas antigas de auth sem ACK foram substituidas por `authenticateWithAck(..., 20000, { maxRetries: 4 })` em fluxos de reconnect/reativacao (linhas ~1293, ~1352, ~2264, ~2311).

Efeito de comportamento:
- Reduz `onlineRedis=false` por ordem incorreta de eventos.
- Driver so sobe online quando sessao + localizacao estao prontas.

---

## 4) Sincronizacao de corrida ativa (reidratacao apos queda)

Arquivo: `mobile-app/src/services/WebSocketManager.js`
- Metodo `syncActiveRideWithAck(...)` implementado (linhas ~2286-2341).
- Reemissao de eventos locais via `_rehydrateRideEventsFromSync(...)` para alinhar UI com estado servidor apos reconexao (linhas ~2343-2373).

Efeito de comportamento:
- Passageiro/motorista retomam estado da corrida apos oscilacao de rede/reabertura do app.

---

## 5) Compatibilidade de perfil de usuario (`usertype` vs `userType`)

### 5.1 Mapa principal e envio de rating
Arquivo: `mobile-app/src/screens/NewMapScreen.js`
- Fallback unificado em pontos criticos para role ativa: `auth.profile?.usertype || auth.profile?.userType` (linhas ~531, ~541, ~709).

Efeito de comportamento:
- Evita renderizacao ou payload incorreto quando backend/profile devolve `userType` no lugar de `usertype`.

### 5.2 Configuracoes
Arquivo: `mobile-app/src/screens/SettingsScreen.js`
- Role derivada no mesmo fallback (`usertype || userType`) para menu e rotas corretas (linhas ~114-135).

Efeito de comportamento:
- Evita roteamento errado entre perfil passageiro/motorista em contas antigas/mistas.

---

## 6) Navegacao segura (prototipo isolado de producao)

Arquivo: `mobile-app/src/navigation/AppNavigator.js`
- Prototipo desabilitado por padrao (`prototypeUiEnabled` false) e fallback seguro em erro de flag (linhas ~177, ~196, ~211).
- `allowPrototypeScreens` exige `__DEV__` e nao-review env (linha ~180).
- Rotas publicas e privadas agora iniciam em `Splash` e `Map` (linhas ~248, ~431).
- Rotas de prototipo so registradas em ambiente dev (bloco `Boolean(__DEV__)`, linha ~610).
- Linking configurado e centralizado (`appLinking`, linhas ~140-168; uso no `NavigationContainer`, final do arquivo).

Efeito de comportamento:
- App de producao para de "cair" em fluxo de prototipo.
- Mantem compatibilidade com deep links e rotas legadas sem impactar release.

---

## 7) Onboarding de motorista (checklist e consentimento)

### 7.1 Checklist atualizado
Arquivo: `mobile-app/src/services/DriverOnboardingService.js`
- Stage de dados do motorista inclui `vehicleRegistration` e `backgroundCheckConsent` no default (linhas ~31-35).
- Compatibilidade retroativa: mapeia legado `criminalRecord -> vehicleRegistration` ao normalizar checklist (linhas ~80-87).

Efeito de comportamento:
- Estado do onboarding reflete o fluxo novo sem quebrar usuarios com payload antigo.

### 7.2 Consentimento obrigatorio no cadastro
Arquivo: `mobile-app/src/components/auth/steps/CredentialsStep.js`
- Driver precisa aceitar consentimento de checagem de antecedentes para concluir (`consentBackgroundCheck`) (linhas ~54-56, ~126-135).
- Links de Termos/Privacidade adicionados com fallback de erro amigavel (linhas ~67-85, ~102-109).

Efeito de comportamento:
- Garante compliance minimo de consentimento ainda no onboarding.

---

## 8) Migracao de design aprovado para app real (sem trocar regra de negocio)

### 8.1 `SettingsScreen` redesenhada
Arquivo: `mobile-app/src/screens/SettingsScreen.js`
- Visual no padrao de tokens aprovados, mantendo logica real de perfil, upload de foto e logout.
- Estrutura de menu por perfil preservada e organizada (linhas ~117-135, ~217-239).

### 8.2 `SupportScreen` redesenhada
Arquivo: `mobile-app/src/screens/SupportScreen.js`
- Chat/tickets/FAQ unificados em layout clean de tabs.
- Logica mantida: bootstrap + `SupportChatService.initialize/getMessages/onNewMessage/sendMessage` + `SupportService.getTickets/getFAQ` (linhas ~93-243).

### 8.3 Cartoes de mapa do motorista refinados
Arquivos:
- `mobile-app/src/components/map/DriverEnRouteUI.js`
- `mobile-app/src/components/map/DriverStartTripUI.js`
- `mobile-app/src/components/map/DriverOnTripUI.js`

Mudancas:
- Vignette superior/inferior de mapa, handle visual do card inferior, ajuste de hierarquia tipografica e `NetworkStatusBanner` no fluxo on-trip.

Efeito de comportamento:
- UX mais consistente com o design aprovado, sem alteracao de regras de corrida.

### 8.4 Segunda passada de harmonizacao visual (telas auxiliares reais)
Arquivos:
- `mobile-app/src/screens/SupportChatScreen.js`
- `mobile-app/src/screens/SupportTicketScreen.js`
- `mobile-app/src/screens/HelpScreen.js`
- `mobile-app/src/screens/AboutScreen.js`
- `mobile-app/src/screens/ProfileScreen.js`

Mudancas:
- Padronizacao de headers, botoes circulares, cards e tipografia no mesmo dialeto visual do app atualizado.
- Ajuste de contrastes/espacamentos para leitura mobile e consistencia entre modulos.
- Correcoes estruturais menores em `AboutScreen` (fechamento de funcao de renderizacao) sem alterar regra de negocio.

Efeito de comportamento:
- Navegacao secundaria (ajuda/suporte/perfil) passa a seguir a mesma linguagem visual das telas principais.

---

## 9) Observacao sobre risco residual
- Ainda existe volume alto de alteracoes historicas no repo (fora do escopo deste diff), entao a publicacao deve seguir smoke focado em:
  - login/auth websocket,
  - createBooking sob latencia,
  - toggle online/offline do motorista,
  - retomada de corrida apos kill/reopen do app.

---

## 10) Arquivo de patch bruto
- Diff bruto completo deste pacote: `mobile-app/docs/APP_LOGIC_BEHAVIOR_DIFF_2026-03-24.patch`
