# Release do piloto assistido — 17/09/2026

## Objetivo

Preparar a versão 1.0.5 do Leaf para um piloto assistido com builds nativas
locais, sem EAS, e registrar os contratos automatizados que precisam estar
estáveis antes da instalação em dois aparelhos. O OTP por WhatsApp foi movido
para o backlog; esta versão usa Firebase Phone Auth/SMS.

## Escopo concluído

- Build iOS local para App Store Connect: `1.0.5 (36)`.
- Build Android local para Play Console: `1.0.5 (versionCode 131)`.
- App configurado para `pilot_controlled`, sem bypass de pagamento e com
  `enableWhatsAppOtp=false`.
- Upload iOS realizado pelo Xcode Organizer para o app correto
  `br.com.leaf.ride` (App Store Connect app id `6757092661`).
- Upload Android publicado na conta ativa da organização Equipe de
  desenvolvimento LEAF (developer id `6672543536613609799`, app id
  `4974985862127979760`), na trilha de teste interno. O primeiro AAB, code 129,
  foi rejeitado por duplicidade; o code 130 já estava consumido no Play Console,
  então o artefato publicado é o code 131.
- Fila de revisão de documentos do dashboard reorganizada para separar contexto,
  filtros, próxima ação e decisões por documento.

## Artefatos locais

| Plataforma | Artefato | Identidade | SHA-256 |
| --- | --- | --- | --- |
| iOS | `mobile-app/ios/build/export-appstore/Leaf.ipa` | `br.com.leaf.ride`, `1.0.5 (36)`, Team `DTA8W5KA5D` | `24034c0818f0dc9f3b4bcdf763de439d88c0df08aaf460938d2afa3b32e1e9be` |
| Android | `mobile-app/android/app/build/outputs/bundle/release/app-release.aab` | `br.com.leaf.ride`, `1.0.5 (131)` | `9c89e8cd8b82f178de06fa5f3388a5a36162d1259ef9f325aff89f4d26894e17` |
| Android | `mobile-app/android/app/build/outputs/apk/release/app-release.apk` | `br.com.leaf.ride`, `1.0.5 (131)` | `187b03bf9a524b2ba310020247591488f267c38eb29d39d3f7e8a94068d597c3` |

O IPA foi exportado com `app-store-connect`, assinado pelo Team `DTA8W5KA5D`
e confirmado com `codesign`. O APK passou na verificação v2; o AAB contém
`launchProfile=pilot_controlled`, `pilotControlled=true`,
`enableWhatsAppOtp=false` e `versionCode=131` no `base/assets/app.config`.

## Contratos e validações

| Área | Resultado | Evidência/limite |
| --- | --- | --- |
| Mobile unitário | **PASS** — 157 suítes / 1.301 testes | Inclui login Firebase SMS, OTP e mensagens de erro. |
| Backend unitário + integração | **PASS** — 275 suítes / 2.326 testes; 6 suítes de integração / 43 testes | Inclui Woovi, KYC, auth, ledger e rotas críticas. |
| Dashboard backoffice | **PASS** — contratos, ESLint, build Next e smoke protegido | Smoke usa providers simulados; não é sessão administrativa real. |
| Firebase rules | **PASS** | Firestore, RTDB/Storage e restores nos emuladores. |
| Governance e segredos | **PASS** | `governance:check`, secret scan e hardcoded-secret guard. |
| Preflight de loja | **PASS** — 25 pass / 0 fail | Rede habilitada; URLs legais HTTP 200 e guards de release. |
| Socket público | **PASS** | Health/readiness, Firebase, Redis, WebSocket, reconnect e multi-gateway. |
| iOS App Store Connect | **UPLOADED / READY TO SUBMIT** | Build 36 (`1.0.5`) concluído no TestFlight e disponível para os grupos internos. Ainda não foi enviado à análise da Apple; a distribuição mostra a versão anterior 1.0.4 como pendente pelo programador. Há apenas avisos de dSYM de frameworks React. |
| Google Play interno | **PUBLISHED** | Trilha de teste interno ativa com `131 (1.0.5)`, disponível para testadores internos. O anexo inválido foi removido antes do novo upload. |

## Gates manuais antes de instalar no piloto

- Confirmar OTP real em uma instalação release iOS e uma Android.
- Repetir uma corrida assistida com Woovi sandbox e registrar o mesmo `rideId`
  nos dois aparelhos, incluindo geofence, aceite, chegada, embarque,
  navegação, conclusão, settlement, recibo e avaliações.
- Confirmar Data Safety, account deletion, declaração/vídeo de background
  location e testadores no Play Console.
- Confirmar privacy labels, review notes e credenciais de review no App Store
  Connect.
- Se a análise da Apple for necessária, criar a versão 1.0.5 na distribuição,
  preencher metadados/review notes e enviar manualmente; o build 36 já está
  pronto para essa etapa.
- Instalar o Android 131 pela trilha interna e o iOS 36 pelo TestFlight; não
  iniciar lançamento para produção nesta etapa.

## Riscos e bloqueios externos

- O runtime público atual informa Woovi em produção, portanto o smoke sandbox
  contra o host remoto não é uma prova de cobrança sandbox; não fazer cobrança
  real sem a configuração aprovada.
- `config:validate` remoto ainda aponta ausência de `CPF_REVIEW_HMAC_KEY` e
  `AUTH_OTP_HMAC_KEY`, perfil Woovi de produção e biometria de produção
  desabilitada. Não inventar segredos nem alterar o ambiente nesta rodada.
- Live Activity/APNs contextualizado permanece não configurado; a notificação
  persistente do piloto deve ser validada no dispositivo e tratada como gate
  separado.
- Avisos de dSYM do upload iOS não impediram o envio, mas reduzem a qualidade
  de símbolos de crash até serem corrigidos.

## Rollback

Manter a versão atual publicada `1.0.4` como fallback. No Android, pausar ou
promover a trilha interna conforme o resultado do piloto; no iOS, não promover
o build 36 até os gates manuais concluírem. O
WhatsApp continua desligado pela flag e pode ser reativado apenas após o
provisionamento Meta/WABA, templates, segredo e smoke de entrega.

## Fora de escopo nesta rodada

Publicação em produção, deploy de backend/dashboard, provisionamento Meta
WhatsApp, rotação de segredos, cobrança Woovi real, KYC liveness/face compare,
migração Expo/Metro e abertura ampla do produto.
