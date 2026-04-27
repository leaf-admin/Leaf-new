# Go-Live Store Checklist (2026-03-23)

Objetivo: decisão operacional para submissão pública em loja.

## 1) Estado técnico (código)
- Mobile hardening aplicado: `PASS`
- `expo-doctor`: `PASS`
- `check-permissions-hardening.sh`: `PASS`
- `check-runtime-endpoints.sh`: `PASS`

## 2) Estado de compliance de console
- Apple App Store Connect: `PENDENTE MANUAL` (metadata/privacy/review notes)
- Google Play Console: `PENDENTE MANUAL` (Data Safety + declaração de background location + account deletion URL)

## 3) Bloqueadores atuais (manuais)
- [ ] Data Safety completo e publicado no Play Console.
- [ ] Declaração de `ACCESS_BACKGROUND_LOCATION` enviada com vídeo e disclosure.
- [ ] URL de account deletion externa cadastrada no Play Console.
- [ ] App Privacy/Nutrition Labels revisadas no App Store Connect.

## 4) URLs oficiais atuais
- Privacy Policy: `https://api.62.169.31.231.sslip.io/privacy-policy`
- Terms of Service: `https://api.62.169.31.231.sslip.io/terms-of-service`
- Refund Policy: `https://api.62.169.31.231.sslip.io/refund-policy`
- Account Deletion: `https://api.62.169.31.231.sslip.io/account-deletion`

## 5) Pacote de apoio para console
- [PLAY_CONSOLE_READY_RESPONSES_2026-03-23.md](/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/PLAY_CONSOLE_READY_RESPONSES_2026-03-23.md)
- [APP_STORE_CONNECT_READY_RESPONSES_2026-03-23.md](/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/APP_STORE_CONNECT_READY_RESPONSES_2026-03-23.md)
- [STORE_COMPLIANCE_AUDIT_2026-03-23.md](/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/STORE_COMPLIANCE_AUDIT_2026-03-23.md)

## 6) Decisão GO/NO-GO
- Build interno (TestFlight/Internal testing): `GO`
- Submissão pública App Store + Play Store: `NO-GO` até concluir itens manuais de console.
