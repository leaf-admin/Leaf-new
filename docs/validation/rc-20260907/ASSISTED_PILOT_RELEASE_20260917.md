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
- A versão iOS `1.0.4`, que estava pendente de lançamento pelo programador, foi
  liberada para distribuição para permitir a abertura da versão seguinte.
- Upload iOS realizado pelo Xcode Organizer para o app correto
  `br.com.leaf.ride` (App Store Connect app id `6757092661`).
- A versão iOS `1.0.5` foi criada, recebeu o build 36, teve os metadados e as
  notas de revisão conferidos e foi enviada para a análise da Apple. O
  lançamento manual após aprovação foi preservado.
- Upload Android publicado na conta ativa da organização Equipe de
  desenvolvimento LEAF (developer id `6672543536613609799`, app id
  `4974985862127979760`), na trilha de teste interno. O primeiro AAB, code 129,
  foi rejeitado por duplicidade; o code 130 já estava consumido no Play Console,
  então o artefato publicado é o code 131. A mesma versão 131 foi adicionada à
  produção e enviada para revisão no Google Play; nenhum lançamento imediato
  foi iniciado.
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
| iOS App Store Connect | **SUBMITTED / A AGUARDAR REVISÃO** | A revisão de apps lista hoje o envio `iOS 1.0.5`, 1 item, estado `A aguardar revisão`. O build 36 (`1.0.5`) está anexado; a versão 1.0.4 está `Pronta para distribuição`. Há apenas avisos de dSYM de frameworks React. |
| Google Play produção | **SUBMITTED / ALTERAÇÕES EM ANÁLISE** | A visão geral da publicação lista `131 (1.0.5)` em Produção, estado `Alterações em análise`, após as verificações automáticas. O lançamento completo ainda não foi iniciado; o anexo inválido foi removido antes do novo upload. |
| Google Play interno | **PUBLISHED** | Trilha de teste interno ativa com `131 (1.0.5)`, disponível para testadores internos. |

## Gates manuais antes de instalar no piloto

- Confirmar OTP real em uma instalação release iOS e uma Android.
- Repetir uma corrida assistida com Woovi sandbox e registrar o mesmo `rideId`
  nos dois aparelhos, incluindo geofence, aceite, chegada, embarque,
  navegação, conclusão, settlement, recibo e avaliações.
- Confirmar Data Safety, account deletion, declaração/vídeo de background
  location e testadores no Play Console.
- Aguardar a decisão das duas lojas e responder eventuais solicitações de
  revisão; os privacy labels, review notes e credenciais de review foram
  conferidos no App Store Connect antes do envio.
- Instalar o Android 131 pela trilha interna e o iOS 36 pelo TestFlight para o
  piloto; manter o lançamento público da 1.0.5 bloqueado até a aprovação e os
  gates manuais.

## Riscos e bloqueios externos

- O runtime público atual informa Woovi em produção, portanto o smoke sandbox
  contra o host remoto não é uma prova de cobrança sandbox; não fazer cobrança
  real sem a configuração aprovada.
- `CPF_REVIEW_HMAC_KEY` fica **fechado para o piloto controlado**: a chave
  dedicada foi provisionada no host/gateways e não é versionada. A validação
  local pode apontar ausência porque este checkout não carrega segredos; isso é
  uma limitação de evidência local, não um bloqueio do piloto. O guard de
  produção permanece ativo e deve ser confirmado no SHA candidato, sem gerar
  ou rotacionar a chave.
- Os demais gates de runtime continuam sujeitos à validação operacional
  correspondente; esta nota não altera regras de autenticação, pagamento ou
  biometria.
- Live Activity/APNs contextualizado permanece não configurado; a notificação
  persistente do piloto deve ser validada no dispositivo e tratada como gate
  separado.
- Avisos de dSYM do upload iOS não impediram o envio, mas reduzem a qualidade
  de símbolos de crash até serem corrigidos.

## Rollback

Manter a versão iOS `1.0.4` já pronta para distribuição como fallback. No
Android, remover a mudança de produção ou pausar/promover a trilha interna
conforme o resultado do piloto antes do lançamento completo; no iOS, manter o
build 36 em lançamento manual até os gates manuais concluírem. O
WhatsApp continua desligado pela flag e pode ser reativado apenas após o
provisionamento Meta/WABA, templates, segredo e smoke de entrega.

## Fora de escopo nesta rodada

Lançamento público da versão 1.0.5, deploy de backend/dashboard,
provisionamento Meta WhatsApp, rotação de segredos, cobrança Woovi real, KYC
liveness/face compare, migração Expo/Metro e abertura ampla do produto.
