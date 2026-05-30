# App Store Connect - Respostas prontas (Leaf)

Data: 2026-03-23  
Escopo: metadata, privacy e review notes para submissão.

## 1) App Information
- Privacy Policy URL: `https://leaf.app.br/privacy`
- Terms URL (campo complementar, se usado): `https://leaf.app.br/terms`
- Account deletion support URL (se campo disponivel): `https://leaf.app.br/delete-account`

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
- URL publica de apoio: `https://leaf.app.br/delete-account`.

## 4) Texto sugerido para App Review Notes
`Leaf is a ride-hailing app with passenger and driver modes in one single app.
Use the pre-provisioned review accounts below (no sign-up required):
- Passenger account: +55 21 10293-8475 / OTP code: 992111.
- Driver account: +55 21 12345-6789 / OTP code: 992000.
Login path for both accounts:
1) On the first screen, the country code +55 is already fixed in UI.
2) Enter +55 21 10293-8475 for passenger or +55 21 12345-6789 for driver, then tap Continue.
3) Enter review OTP code 992111 for passenger or 992000 for driver.
To switch role, log out and sign in with the other review account.
Background location is required only for drivers while online to receive ride requests and keep trip navigation active when the app is minimized.
Account deletion is available in-app under Privacy settings and also documented publicly at https://leaf.app.br/delete-account.`

Internal operator note: do not use OTP `000000`; it is not valid for review accounts. The current driver review OTP is `992000`.

## 5) Checklist final no App Store Connect
- [ ] Privacy Policy URL preenchida no app record.
- [ ] Nutrition Labels consistentes com comportamento real do app.
- [ ] Review Notes preenchidas com fluxo e conta de teste.
- [ ] Build testada em TestFlight com fluxo de exclusão e permissões.
