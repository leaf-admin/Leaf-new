# App Store Connect - Respostas prontas (Leaf)

Data: 2026-03-19
Escopo: fechamento de metadata e App Privacy.

## 1) App Information / Privacy Policy URL
- Privacy Policy URL: `https://api.147.182.204.181.sslip.io/privacy-policy`
- Terms URL (campo adicional, se usado em marketing/support): `https://api.147.182.204.181.sslip.io/terms-of-service`

## 2) App Privacy (Nutrition Labels) - recomendação prática

Marcar `Data Used to Track You`: `No`.

Marcar dados coletados e ligados ao usuário (`Linked to user`) para operação:
- Contact Info: Name, Email Address, Phone Number
- Location: Precise Location
- Identifiers: User ID
- User Content: Photos, Files/Docs, In-app messages (chat/suporte)
- Financial Info: Purchase History (histórico transacional da corrida)
- Diagnostics: diagnostics técnicos do app (se habilitado no fluxo atual)

Finalidades principais:
- App Functionality
- Account Management
- Customer Support
- Fraud Prevention, Security

Não marcar:
- Third-Party Advertising
- Developer Advertising/Tracking

## 3) Account deletion in-app (Guideline 5.1.1(v))
- Confirmar na revisão interna que o usuário consegue iniciar exclusão dentro do app (já implementado na tela de privacidade).
- URL pública de apoio para exclusão: `https://api.147.182.204.181.sslip.io/account-deletion`

## 4) Texto para App Review Notes (sugestão)

`Leaf is a ride-hailing app with passenger and driver modes. Driver background location is required only while the driver is online to receive ride requests and keep trip navigation active when the app is minimized. A prominent in-app disclosure is shown before runtime permission. Account deletion is available in-app and also documented publicly at https://api.147.182.204.181.sslip.io/account-deletion.`

