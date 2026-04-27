# App Store Connect - Respostas prontas (Leaf)

Data: 2026-03-23  
Escopo: metadata, privacy e review notes para submissão.

## 1) App Information
- Privacy Policy URL: `https://api.62.169.31.231.sslip.io/privacy-policy`
- Terms URL (campo complementar, se usado): `https://api.62.169.31.231.sslip.io/terms-of-service`
- Account deletion support URL (se campo disponível): `https://api.62.169.31.231.sslip.io/account-deletion`

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
- URL pública de apoio: `https://api.62.169.31.231.sslip.io/account-deletion`.

## 4) Texto sugerido para App Review Notes
`Leaf is a ride-hailing app with passenger and driver modes in one single app.
Use the pre-provisioned review accounts below (no sign-up required):
- Passenger account: +55 11 99999-9999 / password: teste123
- Driver account: +55 11 88888-8888 / password: teste123
At login, enter the phone number and tap "Ja tenho senha".
To switch role, log out and sign in with the other review account.
Background location is required only for drivers while online to receive ride requests and keep trip navigation active when the app is minimized.
Account deletion is available in-app under Privacy settings and also documented publicly at https://api.62.169.31.231.sslip.io/account-deletion.`

## 5) Checklist final no App Store Connect
- [ ] Privacy Policy URL preenchida no app record.
- [ ] Nutrition Labels consistentes com comportamento real do app.
- [ ] Review Notes preenchidas com fluxo e conta de teste.
- [ ] Build testada em TestFlight com fluxo de exclusão e permissões.
