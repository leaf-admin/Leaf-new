# Validação Final - App Leaf

Data: 2026-03-20
Escopo: backend + dashboard + mobile + conectividade VPS + prontidão para lojas

## 1) Resultado executivo

Status geral: **NÃO 100% pronto para publicação sem ressalvas**.

Motivo principal:
- Pipeline de E2E backend está quebrando em múltiplos fluxos por autenticação WebSocket (`Token de autenticação ausente`).
- Cobertura de E2E real em Android físico está bloqueada por ausência de device conectado via ADB no momento da validação.

## 2) Gatilhos que passaram (PASS)

### Backend
- `npm run config:validate` -> PASS
- `npm test` (unit + integration) -> PASS
- Healthcheck VPS completo (`scripts/healthcheck-vps.sh`) -> PASS (17/17 endpoints)
- WebSocket VPS handshake -> PASS

### Dashboard
- `npm run lint` -> PASS
- `npm run build` (Next.js 16.1.0) -> PASS

### Mobile (qualidade e build)
- `npm run qa:runtime:endpoints` -> PASS
- `npm run qa:permissions` -> PASS
- `npm run env:local:doctor` -> PASS
- `npx expo-doctor` -> PASS (17/17)
- `npx jest --passWithNoTests` -> PASS
- Android release AAB -> PASS (`android/app/build/outputs/bundle/release/app-release.aab`)
- Assinatura AAB validada (`jarsigner` -> `jar verified`)
- iOS artefatos locais existentes e válidos:
  - Archive: `ios/build/Leaf.xcarchive`
  - IPA: `ios/build/export-appstore/Leaf.ipa`
  - IPA assinado com certificado de distribuição (Apple Distribution)
- Screenshot de runtime iOS capturada com app aberto:
  - `mobile-app/test-results/final_validation_20260320/ios-current-screen.png`

## 3) Gatilhos que falharam (FAIL)

### Backend E2E
- `npm run test:e2e` -> FAIL (7 suites)
- Erro dominante: `Token de autenticação ausente`
- Evidência: `tests/e2e/backend/__helpers__/websocket-test-client.js:120`
- Comportamento atual do servidor: `bootstrap/register-socket-authenticate-handler.js:62-69`
  - Em modo produção ou com token presente, autenticação sem token é rejeitada.

### Scripts legados de teste backend
- `npm run test:architecture` -> FAIL (`test-architecture.js` ausente)
- `npm run test:basic` -> FAIL (`test-integration.js` ausente)

## 4) Gatilhos bloqueados por ambiente (BLOCKED)

### E2E Android real / fluxo VPS guiado
- `npm run qa:run` -> BLOCKED (`No Android device connected via adb`)
- `npm run test:e2e:vps` -> BLOCKED (`Missing command: adb` no PATH do shell executado; e sem device conectado)

## 5) Conformidade de lojas (estado atual)

### Apple App Store
Pronto/OK:
- Build iOS gera IPA exportável.
- Assinatura de distribuição no IPA confirmada.
- Privacy manifests empacotados no app e SDKs (`PrivacyInfo.xcprivacy` presentes no pacote).
- URLs de políticas legais respondendo HTTP 200:
  - `/privacy-policy`
  - `/terms-of-service`

Atenções antes de submissão final:
- Garantir respostas consistentes em App Store Connect para permissões de localização em primeiro e segundo plano.
- Reconfirmar questionnaire de age rating (ciclo iOS 26).

### Google Play
Pronto/OK:
- AAB release gerado e assinado.
- Target/compile SDK no build Android atual em nível compatível (compile/target 36 no build).
- Permissões sensíveis com remoções de áudio aplicadas no manifest final.

Atenções antes de submissão final:
- Data Safety e formulário de permissões devem refletir exatamente coleta/uso via SDKs.
- Background location exige justificativa objetiva, disclosure proeminente e vídeo no fluxo de declaração quando aplicável.

## 6) Parecer final de go-live

Para "buildar e enviar" tecnicamente os artefatos, **sim** (AAB/IPA existem e estão válidos).

Para afirmar "100% validado em cenários reais" e publicar sem risco operacional, **ainda não**.

Bloqueadores objetivos:
1. Corrigir E2E backend WebSocket (token/auth) e voltar suite para verde.
2. Executar E2E real em device Android conectado (qa:run + e2e:vps) com evidência.
3. Fechar declaração de políticas de dados/permissões no Play Console e metadata final no App Store Connect.

