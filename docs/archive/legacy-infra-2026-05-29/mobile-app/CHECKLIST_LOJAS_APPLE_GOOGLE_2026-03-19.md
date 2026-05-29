# Checklist de Publicação (Apple + Google)

Data da auditoria: 2026-03-19
Projeto: mobile-app

## Fontes oficiais usadas
- Apple Upcoming Requirements: https://developer.apple.com/news/upcoming-requirements/
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple Third-party SDK requirements: https://developer.apple.com/support/third-party-SDK-requirements/
- Google Play target API level: https://developer.android.com/google/play/requirements/target-sdk
- Google Play Developer Program Policy (User Data, Data Safety, Account Deletion):
  https://storage.googleapis.com/support-kms-prod/AcDu0qP7Lifh7E81GouUdfxHdOW3k4UC1uqk
- Google Play Sensitive Permissions policy: https://support.google.com/googleplay/android-developer/answer/16558241
- Android developer verification timeline: https://developer.android.com/developer-verification

## Verificações locais executadas
- `xcodebuild -version`: Xcode 26.3 (Build 17C529)
- `npx expo-doctor`: 17/17 checks OK
- `npm run -s qa:permissions`: PASS
- `npm run -s qa:runtime:endpoints`: PASS
- `rg targetSdkVersion` no manifesto merged release: `android:targetSdkVersion="36"` (arquivo gerado de build)
- `plutil -p ios/Leaf/Info.plist`: `NSAppTransportSecurity` com `NSAllowsArbitraryLoads=false` e sem `NSExceptionDomains`
- `android/app/src/main/res/xml/network_security_config.xml`: cleartext bloqueado para todos os hosts
- `curl https://leaf.app.br/privacy-policy`: falha DNS (host não resolve)
- `DELETE /api/privacy/delete-data/:id` (sem token): 401 (rota existe)
- `POST /api/account/delete` (sem token): 401 (rota existe)
- `node -c leaf-websocket-backend/routes/account-routes.js`: OK
- `node -c leaf-websocket-backend/routes/legal-pages.js`: OK
- `node -e "require('./mobile-app/config/AppConfig').AppConfig"`: URLs legais apontando para `https://api.147.182.204.181.sslip.io/*`

## Verificações em produção executadas (VPS)
- Deploy aplicado em `147.182.204.181` no diretório `/opt/leaf-app` com rebuild do container `leaf-websocket` via Docker Compose.
- `GET https://api.147.182.204.181.sslip.io/health`: `200 OK` (saúde geral `healthy`).
- `GET https://api.147.182.204.181.sslip.io/privacy-policy`: `200 OK`.
- `GET https://api.147.182.204.181.sslip.io/terms-of-service`: `200 OK`.
- `GET https://api.147.182.204.181.sslip.io/account-deletion`: `200 OK`.
- `GET https://api.147.182.204.181.sslip.io/api/legal/links`: `200 OK`.
- `POST /api/account/delete` sem token: `401` (esperado).
- `DELETE /api/privacy/delete-data/:id` sem token: `401` (esperado).
- Teste autenticado não destrutivo:
  - Token Firebase válido obtido via fluxo `/api/custom-otp` + `signInWithCustomToken`.
  - `DELETE /api/privacy/delete-data/not-the-same-user-id` com token: `403` (esperado, prova de autenticação).
  - `POST /api/account/delete` com token de usuário recém-criado por OTP: `404 Usuário não encontrado` (esperado para usuário sem documento `users/{uid}` no Firestore).

---

## Apple App Store

### 1) SDK mínimo de submissão
- Regra oficial: desde 2026-04-28, upload exige Xcode 26+ e SDK iOS 26+.
- Status: OK (ambiente local com Xcode 26.3).
- Ação: garantir que CI/mac de release use Xcode 26+.

### 2) Privacidade e política
- Regra oficial: link de Privacy Policy no App Store Connect e dentro do app, acessível.
- Status: RESOLVIDO.
- Evidência: `privacyPolicyUrl` e `termsOfServiceUrl` agora apontam para `/privacy-policy` e `/terms-of-service` no host da API.
- Ação: manter monitoramento de disponibilidade das URLs.

### 3) Exclusão de conta no app
- Regra oficial (Guideline 5.1.1(v)): se cria conta, deve oferecer exclusão dentro do app.
- Status: RESOLVIDO TECNICAMENTE.
- Evidência:
  - App atualizado para `POST /api/account/delete` com `Authorization: Bearer`.
  - Backend mantém compatibilidade com rota legada `DELETE/POST /api/privacy/delete-data/:userId`.
- Ação: executar validação funcional pelo app (UI) com conta QA existente em Firestore.

### 4) Privacy Manifest / Required Reason APIs
- Regra oficial: motivos aprovados para APIs listadas + manifest agregado com SDKs.
- Status: OK técnico.
- Evidência: `ios/Leaf/PrivacyInfo.xcprivacy` presente e pods com manifests `.xcprivacy`.
- Ação: conferir no archive final se relatório agregado está consistente com Nutrition Labels.

### 5) Sign in with Apple (equivalência)
- Regra oficial (4.8): se houver social login de conta principal, oferecer opção equivalente.
- Status: MONITORAR.
- Evidência: código contém suporte Apple e Google; fluxo ativo atual está focado em telefone/OTP.
- Ação: se Google/Facebook forem habilitados na UI final, manter Apple ativo e equivalente.

---

## Google Play

### 1) Target API level
- Regra oficial: página oficial atualizada em 2026-03-18 (API target policy vigente).
- Status: RESOLVIDO TECNICAMENTE.
- Evidência:
  - manifesto merged de release contém `android:targetSdkVersion="36"` (`android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`);
  - `minSdkVersion="24"` no mesmo artefato.
- Ação: manter a mesma configuração no pipeline de build oficial (AAB de publicação).

### 2) User Data / Data Safety
- Regra oficial: formulário Data Safety deve refletir coleta/uso/compartilhamento real.
- Status: PENDENTE MANUAL (Play Console).
- Ação: revisar e sincronizar Data Safety com implementação atual (localização em foreground/background, documentos, notificações, suporte, pagamentos via PIX).

### 3) Privacy Policy (URL pública ativa)
- Regra oficial: URL pública ativa, acessível, não geobloqueada (sem PDF).
- Status: RESOLVIDO.
- Evidência: app configurado com fallback em `https://api.147.182.204.181.sslip.io/privacy-policy`.
- Ação: monitorar disponibilidade DNS/HTTPS em produção.

### 4) Account Deletion Requirement
- Regra oficial: opção de exclusão no app e fora do app (web URL no Play Console), com remoção de dados associada.
- Status: PARCIALMENTE RESOLVIDO (PENDÊNCIAS DE CONSOLE).
- Evidência:
  - App usa endpoint real `/api/account/delete`.
  - Backend com endpoint principal + compatibilidade legado e página pública `/account-deletion`.
  - URL pública ainda precisa ser cadastrada/confirmada no Play Console.
- Ação:
  - validar fluxo completo de exclusão via UI com conta QA existente no Firestore;
  - preencher URL de exclusão no Play Console (`.../account-deletion`).

### 5) Background Location (permissão restrita)
- Regra oficial: justificativa forte, disclosure proeminente, declaração no console.
- Status: RESOLVIDO NO CÓDIGO + PENDENTE DE CONSOLE.
- Evidência:
  - app declara `ACCESS_BACKGROUND_LOCATION` e `UIBackgroundModes=location` para caso de uso de motorista;
  - disclosure in-app implementado antes da solicitação (modal explicativo) e fallback não bloqueante;
  - hardening de transporte seguro aplicado (sem cleartext em produção por padrão).
- Ação: preencher declaração de background location no Play Console + anexos/evidências.

### 6) Permissões de mídia (READ_MEDIA_IMAGES/VIDEO)
- Regra oficial: se pedir acesso amplo, passa por revisão específica.
- Status: OK (manifest atual não expõe READ_MEDIA_IMAGES/VIDEO).
- Ação: manter uso via picker quando possível; não adicionar permissões amplas sem necessidade.

### 7) Verificação de desenvolvedor Android (Brasil)
- Regra oficial: requisito entra em vigor no Brasil em setembro/2026 para distribuição em dispositivos certificados.
- Status: PENDENTE FUTURO.
- Ação: concluir verificação de desenvolvedor e registro de packages no prazo.

---

## Go/No-Go pré-build (hoje)

### NO-GO para submissão em loja neste momento
Motivos bloqueadores:
1. Itens de console obrigatórios ainda pendentes (Data Safety + declaração de background location + URL de exclusão fora do app).

### GO técnico para build de release
- Projeto está tecnicamente pronto para gerar `AAB/IPA` com os requisitos críticos de código atendidos.
- Publicação final permanece bloqueada até concluir os três itens manuais de console acima.
