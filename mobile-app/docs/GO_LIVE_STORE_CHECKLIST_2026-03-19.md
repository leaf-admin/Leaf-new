# Go-Live Store Checklist (2026-03-19)

Objetivo: consolidar decisao operacional para subida de build e submissao em loja.

## 1) Estado tecnico de build
- iOS (TestFlight): GO
- Android (Internal Testing): GO
- Backend + Dashboard + Mobile checks: PASS nas evidencias de 2026-03-19

## 2) Estado de compliance para submissao publica
- Apple App Store Connect: PARCIAL (metadata e privacy labels devem ser revisadas no console antes do submit final)
- Google Play Console: PENDENTE (3 itens obrigatorios)

## 3) Bloqueadores atuais de loja (Google Play)
- [ ] Data Safety completo e publicado no App Content
- [ ] Declaracao de background location (sensitive permission) com evidencias
- [ ] URL de account deletion externa preenchida e validada

URL de exclusao recomendada:
- `https://api.leaf.app.br/account-deletion`

## 4) Decisao go-live
- Build para testes internos: GO
- Build para TestFlight/Internal Play: GO
- Submissao publica App Store/Play Store: NO-GO ate concluir os 3 itens de console acima

## 5) Evidencias de referencia
- [CHECKLIST_LOJAS_APPLE_GOOGLE_2026-03-19.md](/Users/izaakdias/Documents/Leaf-new/docs/archive/legacy-infra-2026-05-29/mobile-app/CHECKLIST_LOJAS_APPLE_GOOGLE_2026-03-19.md)
- [GO_NO_GO_BUILD_CHECKLIST_2026-03-19.md](/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/GO_NO_GO_BUILD_CHECKLIST_2026-03-19.md)
- [STORE_CONSOLE_BLOCKERS_PLAYBOOK_2026-03-19.md](/Users/izaakdias/Documents/Leaf-new/docs/archive/legacy-infra-2026-05-29/mobile-app/STORE_CONSOLE_BLOCKERS_PLAYBOOK_2026-03-19.md)
