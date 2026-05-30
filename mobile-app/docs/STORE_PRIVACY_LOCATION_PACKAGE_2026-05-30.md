# Store Privacy And Location Package - Leaf

Data: 2026-05-30

Escopo: fonte canonica para preencher App Store Connect e Google Play Console com o comportamento real do app atual.

## 1. URLs canonicas

Usar somente dominio final da marca:

- Privacy Policy URL: `https://leaf.app.br/privacy`
- Terms URL: `https://leaf.app.br/terms`
- Account Deletion URL: `https://leaf.app.br/delete-account`
- Refund Policy URL: `https://leaf.app.br/refund-policy`
- Support URL: `https://leaf.app.br/support`
- Support email: `suporte@leaf.app.br`

Status em 2026-05-30:

- Implementacao publica ativa em `https://leaf.app.br`, servida pelo backend em `leaf-websocket-backend/routes/legal-pages.js`.
- Rotas validadas em rodada publica: `/privacy`, `/terms`, `/refund-policy`, `/delete-account`, `/support` e `/api/legal/links` retornando HTTP 200 sem redirect.
- `mobile-app/scripts/store-console-preflight.sh` passou apos o deploy dos links finais.

## 2. Google Play Data Safety

Top-level answers:

- Does your app collect or share any of the required user data types? `Yes`
- Is all user data collected by your app encrypted in transit? `Yes`
- Do you provide a way for users to request that their data is deleted? `Yes`
- Ads: `No`
- App primarily directed to children: `No`

Suggested matrix:

| Play Console data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| Location > Approximate location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Location > Precise location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance, Account management |
| Personal info > Name | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Email address | Yes | No | No | App functionality, Account management, Customer support |
| Personal info > Phone number | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > User IDs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > Address | Yes | No | Yes | App functionality |
| Personal info > Other info | Yes | No | Yes for driver, No for passenger | App functionality, Fraud prevention/security/compliance |
| Financial info > Purchase history | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Photos and videos > Photos | Yes | No | Yes for driver, No for passenger | App functionality, Account management, Fraud prevention/security/compliance |
| Files and docs > Files and docs | Yes | No | Yes for driver, No for passenger | App functionality, Account management, Fraud prevention/security/compliance |
| Messages > Other in-app messages | Yes | No | No | App functionality, Customer support, Safety |
| App activity > App interactions | Yes | No | No | Analytics, App functionality, Fraud prevention/security/compliance |
| App info and performance > Crash logs | Yes | No | No | Analytics, App functionality |
| App info and performance > Diagnostics | Yes | No | No | Analytics, App functionality |
| Device or other IDs | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |

Notes:

- Mark `Shared = No` when Firebase, Google Maps, Woovi, AWS liveness, face-compare service, observability, and storage providers process data as service providers for Leaf operations, not for independent third-party advertising use.
- Do not mark advertising or cross-app/site tracking.
- Payment is PIX/transactional for ride purchase and driver settlement. The app is not positioned as banking, lending, brokerage or general wallet product.

## 3. Apple App Privacy

Data Used to Track You:

- `No`

Data linked to the user:

- Contact Info: Name, Email Address, Phone Number
- Location: Precise Location
- Identifiers: User ID, Device ID or equivalent technical identifiers
- User Content: Photos, Files/Docs, In-app messages
- Financial Info: Purchase History / Payment Info where App Store Connect wording requires it for PIX ride transactions
- Diagnostics: Crash Data, Performance Data

Main purposes:

- App Functionality
- Account Management
- Customer Support
- Fraud Prevention, Security and Compliance
- Analytics for diagnostics and product reliability

Do not mark:

- Third-Party Advertising
- Developer Advertising or Marketing
- Data Broker use
- Tracking across apps/sites

## 4. Background Location Declaration - Google Play

Core feature:

`Driver online operations: Leaf uses background location so drivers can continue receiving ride requests and keep trip navigation and trip tracking active when the app is minimized or the screen is locked. Without background location, the driver cannot operate continuously during an active work session.`

Why foreground location is not enough:

`Foreground-only location is not sufficient because driver operations continue while the app is minimized, the screen is locked, or the driver switches to navigation apps. The platform needs continuous location updates to maintain ride dispatch, ETA, pickup monitoring, active trip tracking and operational safety in real time.`

Prominent disclosure in app:

`A Leaf coleta sua localização para permitir que você receba corridas e mantenha a navegação ativa mesmo quando o app não está em uso. A localização em segundo plano é usada somente enquanto você estiver online como motorista ou durante uma corrida, para operação, acompanhamento da viagem e segurança. A Leaf não usa essa permissão para anúncios.`

Video script:

1. Open Leaf with a driver review account.
2. Tap `Ficar online`.
3. Show the in-app prominent disclosure before the OS background location prompt.
4. Continue and grant location permissions.
5. Confirm the driver is online.
6. Lock/minimize the app briefly.
7. Return and show that online driver operation remains active.

Foreground service declaration, if requested:

- Type: `TYPE_LOCATION`
- Feature description: `Leaf uses a location foreground service to keep real-time driver location active during online driver operation and active trips.`
- User impact if deferred/interrupted: `Dispatch accuracy, ETA, pickup arrival monitoring and in-trip tracking can become unreliable or fail.`

## 5. Account Deletion

Answers:

- Is account deletion available inside the app? `Yes`
- External account deletion URL: `https://leaf.app.br/delete-account`

Explanation:

`Users can initiate account deletion inside the app under Privacy settings. The app also provides a public account deletion page with instructions and support contact. After a valid request, the account is disabled and personal data is removed or anonymized according to the retention policy and applicable legal obligations.`

## 6. Review Notes

Use only current review access credentials from the release manager. Do not reuse historical test credentials from archived docs.

Current review access credentials:

- Passenger account: `+55 21 10293-8475` / OTP code: `992111`.
- Driver account: `+55 21 12345-6789` / OTP code: `992000`.

Important:

- Never submit `000000` as review OTP. That value is only a placeholder in example Firebase files and is not accepted by the app.
- If the backend environment overrides review credentials, use `AUTH_TEST_OTP_BYPASS_PHONE_CODES` as the source of truth and update this package before submitting.

Suggested note:

`Leaf is a ride-hailing app with passenger and driver modes in one single app. Use the pre-provisioned review accounts below: Passenger account +55 21 10293-8475 with OTP 992111; Driver account +55 21 12345-6789 with OTP 992000. Passenger flow covers login, destination selection, PIX payment, ride tracking, chat, support, receipt and account deletion. Driver flow covers login, activation status, online/offline, background location disclosure, ride offer, pickup arrival, trip start, navigation handoff, trip completion, earnings and support. Background location is requested only for drivers while online or on an active trip, and is explained before the OS permission prompt.`

## 7. Evidence Checklist

- [x] `bash mobile-app/scripts/store-console-preflight.sh` PASS after legal links deploy.
- [x] Public legal links return HTTP 200 on `https://leaf.app.br`.
- [ ] Android release/internal build: background disclosure appears before permission prompt.
- [ ] Android release/internal build: driver can stay online with active location tracking.
- [ ] Background location video recorded and attached in Play Console.
- [ ] Data Safety published.
- [ ] App Privacy/Nutrition Labels reviewed.
- [ ] Account deletion URL entered in Play Console and App Store metadata where applicable.
- [ ] Legal links open from the app and from public browser.
