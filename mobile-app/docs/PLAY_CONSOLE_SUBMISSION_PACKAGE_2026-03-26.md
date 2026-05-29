# Play Console Submission Package (2026-03-26)

## 1. Status validado no projeto

### 1.1 Exclusao de conta dentro do app
Sim. Ha fluxo real no app e no backend.

Implementacao confirmada em:
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/PrivacyPolicyScreen.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/SettingsScreen.js`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/routes/account-routes.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/routes/legal-pages.js`

Comportamento atual:
- o usuario acessa `Privacidade e Exclusao` nas configuracoes
- confirma a exclusao
- o app chama `POST /api/account/delete` autenticado
- o backend desabilita/exclui a conta e remove PII
- o app encerra a sessao e volta para a tela inicial

### 1.2 URLs publicas validadas agora
URLs públicas canônicas:
- `https://api.leaf.app.br/privacy-policy`
- `https://api.leaf.app.br/terms-of-service`
- `https://api.leaf.app.br/account-deletion`
- `https://api.leaf.app.br/api/legal/links`

Observacao importante:
- este pacote nasceu durante a fase temporaria de infraestrutura.
- para qualquer envio novo, usar somente os dominios finais da marca.

### 1.3 Permissoes sensiveis declaradas no AndroidManifest
Confirmadas no manifesto atual:
- `ACCESS_BACKGROUND_LOCATION`
- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`
- `CAMERA`
- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_LOCATION`
- `RECORD_AUDIO`

Nao encontrei no manifesto atual:
- `USE_FULL_SCREEN_INTENT`
- `AD_ID`
- `QUERY_ALL_PACKAGES`
- `READ_MEDIA_IMAGES`
- `READ_MEDIA_VIDEO`

## 2. URLs para usar no Play Console agora

### 2.1 App content / Privacy policy URL
`https://api.leaf.app.br/privacy-policy`

### 2.2 App content / Account deletion URL
`https://api.leaf.app.br/account-deletion`

### 2.3 Termos / support reference
`https://api.leaf.app.br/terms-of-service`

### 2.4 Support email
`suporte@leaf.app.br`

### 2.5 Support website (temporario, se o campo for obrigatorio)
`https://api.leaf.app.br/privacy-policy`

## 3. Main store listing - textos prontos

### 3.1 App name
`Leaf`

### 3.2 Short description
`Mobilidade urbana com corridas por PIX e operacao em tempo real.`

### 3.3 Full description
`A Leaf e uma plataforma de mobilidade urbana que conecta passageiros a motoristas parceiros para corridas com operacao em tempo real.

Para passageiros:
- solicite corridas diretamente pelo app
- visualize estimativa antes da confirmacao
- acompanhe o motorista no mapa
- receba informacoes da viagem em tempo real
- acesse suporte e historico da operacao

Para motoristas parceiros:
- receba chamadas enquanto estiver online
- acompanhe origem, destino e valor liquido estimado da corrida
- inicie e conclua viagens pelo app
- acompanhe ganhos e operacao diaria
- envie documentos de ativacao para analise

A Leaf utiliza localizacao para despacho, navegacao operacional e seguranca da corrida. Para motoristas, a localizacao em segundo plano e utilizada somente durante a operacao, quando necessario para manter disponibilidade, navegacao ativa e acompanhamento da viagem.

Recursos principais:
- solicitacao e despacho de corridas
- rastreamento da viagem em tempo real
- pagamento eletronico antes da corrida
- suporte operacional no aplicativo
- onboarding e ativacao de motorista

A disponibilidade de recursos pode variar por cidade, perfil e etapa de liberacao da plataforma.`

### 3.4 Categoria sugerida
`Travel & Local`

### 3.5 Tags sugeridas
- `transportation`
- `ride hailing`
- `maps`
- `travel`
- `mobility`

## 4. App content - respostas prontas

### 4.1 Privacy policy
- URL: `https://api.leaf.app.br/privacy-policy`

### 4.2 Ads
- Resposta: `No`

### 4.3 App access
Usar as instrucoes abaixo em ingles.

#### Passenger review access
`Review account (passenger)
Phone: +55 11 99999-9999
Password: teste123

This is a persistent review account for passenger flows.
Use this account to test login, destination entry, fare estimate, category selection, booking, ride tracking, trip completion, support and account settings.
On the first screen, enter the phone number and tap "Ja tenho senha" to sign in with password.
No account creation is required for review.`

#### Driver review access
`Review account (driver)
Phone: +55 11 88888-8888
Password: teste123

This is a persistent review account for driver flows.
The driver profile is already activated and vehicle/profile validation is completed.
Use this account to test login, online/offline status, ride offers, arrival at pickup, trip start, navigation handoff, trip completion, earnings and account settings.
On the first screen, enter the phone number and tap "Ja tenho senha" to sign in with password.
No account creation is required for review.`

#### Additional app access notes
`The app has two roles: passenger and driver.
Please test both roles using the credentials above.
If needed, use two devices or two sessions.
Role switching is done by logging out and logging in with the other review account.
Background location is only required for the driver flow while the driver is online or on an active trip.`

### 4.4 Target audience and content
Resposta sugerida:
- target audience: `18 and over`
- nao direcionado para criancas
- nao faz parte do programa Families

### 4.5 Content rating
Preenchimento sugerido, assumindo o comportamento atual do app:
- violencia: `No`
- sangue/gore: `No`
- conteudo sexual/nudez: `No`
- linguagem ofensiva forte: `No`
- drogas/alcohol/tobacco promotion: `No`
- gambling: `No`
- user-generated public content: `No`, exceto mensagens operacionais/suporte se o formulario perguntar sobre comunicacao restrita entre usuarios

Observacao:
- se o questionario considerar chat/suporte como UGC, responder de forma consistente com moderacao e escopo fechado do recurso.

### 4.6 News and Magazine
- Resposta: `No`

### 4.7 COVID-19 contact tracing or status
- Resposta: `No`

### 4.8 Financial features
Inferencia recomendada para o Leaf neste momento:
- Resposta sugerida: `My app doesn't provide any financial features`

Justificativa:
- a funcionalidade central do Leaf e mobilidade urbana, nao servicos financeiros
- o pagamento da corrida e incidental a compra do servico de transporte
- o app nao se apresenta como carteira, banco, emprestimo, corretora ou servico de transferencia financeira ao usuario final

Atencao:
- se no Play Console o formulario estiver enquadrando explicitamente saldo/saque do motorista como `payments and transfers`, revisar antes de enviar
- este e o unico item deste pacote que eu trataria como inferencia, nao como fato juridico fechado

## 5. Data safety - matriz pronta

### 5.1 Top-level answers
- Does your app collect or share any of the required user data types? `Yes`
- Is all user data collected by your app encrypted in transit? `Yes`
- Do you provide a way for users to request that their data is deleted? `Yes`

### 5.2 Suggested matrix
| Play Console data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| Location > Precise location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance, Account management |
| Location > Approximate location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Personal info > Name | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Email address | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Phone number | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > User IDs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > Address | Yes | No | Yes | App functionality |
| Personal info > Other info (CPF / driver registration data) | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Financial info > Purchase history | Yes | No | Yes | App functionality, Account management |
| Photos and videos > Photos | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Files and docs > Files and docs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Messages > Other in-app messages | Yes | No | No | App functionality, Customer support |
| App activity > App interactions | Yes | No | No | Analytics, App functionality |
| App info and performance > Diagnostics | Yes | No | No | Analytics |
| Device or other IDs | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |

Notas:
- `Shared = No` quando o processamento ocorre por prestadores em nome da Leaf, sem exposicao como data sharing ao usuario do Play
- nao marcar uso para advertising/tracking

## 6. Background location - textos prontos

### 6.1 Core feature using background location
`Driver online operations: Leaf uses background location so drivers can continue receiving ride requests and keep trip navigation and trip tracking active when the app is minimized or the screen is locked. Without background location, the driver cannot operate continuously during an active work session.`

### 6.2 Why foreground location is not enough
`Foreground-only location is not sufficient because driver operations continue while the app is minimized and while the driver switches to navigation apps. The platform needs continuous location updates to maintain ride dispatch, estimated arrival times, active trip monitoring and operational safety in real time.`

### 6.3 Prominent disclosure
`This app collects location data to allow drivers to receive ride requests and keep trip navigation active even when the app is not in use. Background location is used only while the driver is online or during ride operation, for dispatch, trip tracking and safety. Leaf does not use this permission for advertising.`

### 6.4 Video script for declaration
1. Open the app with the driver review account.
2. Log in with phone and OTP.
3. Tap `Ficar online`.
4. Show the in-app explanation before the OS permission prompt.
5. Grant foreground and background location.
6. Minimize the app and show that driver operation remains active.
7. Return to the app and show online driver status.

## 7. Foreground service declaration - textos prontos

Use this only if the `Foreground service` declaration appears in App content.

### 7.1 FGS type
`TYPE_LOCATION`

### 7.2 Feature description
`The app uses a location foreground service to keep real-time driver location active during online driver operation and active trips.`

### 7.3 User impact if deferred
`If the location task is deferred, the driver may stop receiving nearby ride requests, ETA values become unreliable and active trip monitoring becomes inconsistent.`

### 7.4 User impact if interrupted
`If the location task is interrupted, dispatch accuracy, pickup arrival monitoring and in-trip operational tracking may fail, degrading ride execution and safety controls.`

## 8. Account deletion - respostas prontas

### 8.1 Is account deletion available inside the app?
`Yes`

### 8.2 Account deletion URL
`https://api.leaf.app.br/account-deletion`

### 8.3 Support text if a freeform explanation field appears
`Users can request account deletion from within the app under Privacy settings. The app also provides a public web page with deletion instructions and support contact information. After a valid request, the account is disabled and personal data is removed or anonymized according to the retention policy and applicable legal obligations.`

## 9. Internal testing setup checklist

### 9.1 Minimum fields to fill now
- [ ] Main store listing complete
- [ ] Support email set to `suporte@leaf.app.br`
- [ ] Privacy policy URL set
- [ ] App access instructions added
- [ ] Target audience completed
- [ ] Content rating completed
- [ ] Ads declaration completed
- [ ] Financial features completed
- [ ] Account deletion URL set

### 9.2 Sensitive declarations
- [ ] Background location declaration completed
- [ ] Background location video attached
- [ ] Foreground service declaration completed if requested

### 9.3 Release/testing
- [ ] Internal testing testers list created
- [ ] Feedback email configured
- [ ] Internal track release created
- [ ] AAB 1.0.1 (101) linked to release

## 10. Quick decision summary

### What already exists
- in-app account deletion: yes
- backend deletion endpoint: yes
- public deletion page: yes
- public privacy page: yes
- disclosure text for background location in app: yes

### What should be used right now
- use the canonical Leaf legal URLs under `https://api.leaf.app.br`

### What should not be assumed finished
- financial features classification without a quick human check if the Play form wording looks broader than expected
