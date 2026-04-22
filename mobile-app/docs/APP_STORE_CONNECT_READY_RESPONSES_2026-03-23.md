# App Store Connect - Respostas prontas (Leaf)

Data: 2026-03-23  
Escopo: metadata, privacy e review notes para submissão.

## 1) App Information
- Privacy Policy URL: `https://api.147.182.204.181.sslip.io/privacy-policy`
- Terms URL (campo complementar, se usado): `https://api.147.182.204.181.sslip.io/terms-of-service`
- Account deletion support URL (se campo disponível): `https://api.147.182.204.181.sslip.io/account-deletion`

## 2) App Privacy (Nutrition Labels) - preenchimento sugerido

Marcar `Data Used to Track You`: `No`.

Marcar dados coletados e ligados ao usuário para operação:
- Contact Info: Name, Email Address, Phone Number
- Location: Precise Location
- Identifiers: User ID
- User Content: Photos, Files/Docs, In-app messages
- Financial Info: Purchase History
- Diagnostics: Diagnostics técnicos do app

Finalidades principais:
- App Functionality
- Account Management
- Customer Support
- Fraud Prevention, Security

Não marcar:
- Third-Party Advertising
- Developer Advertising/Tracking

## 3) Account deletion (Guideline 5.1.1)
- Exclusão disponível dentro do app na tela de privacidade.
- Após confirmação, app encerra sessão e retorna ao fluxo inicial.
- URL pública de apoio: `https://api.147.182.204.181.sslip.io/account-deletion`.

## 4) Texto sugerido para App Review Notes
`Leaf is a ride-hailing app with passenger and driver modes. Background location is required only for drivers while online to receive ride requests and keep trip navigation active when the app is minimized. The app shows an in-app disclosure before requesting background location permission. Account deletion is available in-app under Privacy settings and also documented publicly at https://api.147.182.204.181.sslip.io/account-deletion.`

## 5) Checklist final no App Store Connect
- [ ] Privacy Policy URL preenchida no app record.
- [ ] Nutrition Labels consistentes com comportamento real do app.
- [ ] Review Notes preenchidas com fluxo e conta de teste.
- [ ] Build testada em TestFlight com fluxo de exclusão e permissões.
