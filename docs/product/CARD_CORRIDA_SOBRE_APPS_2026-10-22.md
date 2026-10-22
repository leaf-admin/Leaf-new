# Card de nova corrida por cima de outros apps (Android e iOS)

Data: 2026-10-22. Tipo: pesquisa e proposta, somente leitura. Nenhum código foi alterado.

Base analisada: worktree `/Users/izaakdias/Documents/leaf-wave`, branch `feat/driver-passenger-wave` (não `main`). Referências com `arquivo:linha` relativas a `leaf-wave/`. Validar as linhas contra `main` antes de implementar.

## 1. Objetivo

Garantir que o motorista veja o aviso de "Nova corrida" mesmo com Waze, Google Maps ou outro app em primeiro plano, como Uber e 99 fazem.

## 2. Como a oferta chega hoje

**Backend (push de oferta)**

- `leaf-websocket-backend/services/offer-push.js:13-43`: `buildOfferPushNotification` monta `title: 'Nova corrida'` (L33), `collapseKey: 'leaf-ride-offer'` (L34), `ttlSeconds` entre 5 e 120 s, derivado de `expiresAt` (L29-31), e `data.type = 'ride_offer'` (L38). Não define `channelId` nem prioridade.
- `leaf-websocket-backend/services/offer-push.js:9-11`: flag `ENABLE_NEW_OFFER_PUSH`, ligada por padrão.
- `leaf-websocket-backend/services/driver-notification-dispatcher.js:897-917`: `sendOfferPush` chama `FCMService.sendNotificationToUser`. Só é disparado após a oferta ser gravada no fluxo de reserva.
- `leaf-websocket-backend/services/fcm-service.js:506-555` (`sendToToken`): o payload é **híbrido**, com bloco `notification` (title/body, L514-517) mais `data`. Com o app em background ou morto, o SO exibe a notificação sozinho e o JS não roda.
  - Android: `priority: 'high'` (L527), `ttl` a partir de `ttlSeconds` (L530), `collapseKey` (L531), `tag` = collapseKey (L533), `channelId: notification.channelId || 'default'` (L534).
  - iOS: `apns-expiration` e `apns-collapse-id` (L546-551). Sem `interruption-level` no `aps`.

**Gap importante:** o canal `'default'` não é criado pelo app. Busca em `mobile-app/src` por `setNotificationChannelAsync`/`createChannel` encontra só `driver_actions`, `ride_status` e os canais de `LeafOngoingRideNotification`. A oferta cai num canal do sistema com importância não controlada pelo Leaf, o que pode impedir o heads-up.

**Mobile (recebimento)**

- `mobile-app/index.js:4,11` e `mobile-app/src/services/FCMNotificationService.js:593`: o `setBackgroundMessageHandler` é registrado. `FCMBackgroundMessageHandler.js:13-20` só salva a mensagem na fila (`BackgroundNotificationQueue.js:52`).
- `FCMNotificationService.js:675-680`: com o app em primeiro plano, `ride_offer` é ignorado, porque o cartão da oferta já está na tela.
- `FCMNotificationService.js:616-640`: ao voltar ao foreground, o aviso de oferta é removido da barra (`dismissRideOfferNotifications`).
- `FCMNotificationService.js:18-19,219-230`: pedido de `POST_NOTIFICATIONS` com disclosure.
- `mobile-app/src/services/AndroidPermissionDisclosure.js:24-29`: texto do disclosure de notificações.

**Permissões e manifest (Android)**

- `mobile-app/app.config.js:295-306`: permissões em `android.permissions` (inclui `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, localização em background). Sem `USE_FULL_SCREEN_INTENT`.
- `mobile-app/app.config.js:307-313`: `blockedPermissions` (STORAGE e MEDIA_PLAYBACK).
- `mobile-app/plugins/withLeafRideOverlay.js:15-22`: adiciona `SYSTEM_ALERT_WINDOW` e `POST_PROMOTED_NOTIFICATIONS` via manifest (L70-84).
- `USE_FULL_SCREEN_INTENT`: nenhuma ocorrência em `mobile-app` (rg). Também não há `fullScreenAction`/`fullScreenIntent` em notifee ou expo-notifications.
- Não existe `mobile-app/android/app/src/main/AndroidManifest.xml` versionado; o manifest é gerado pelo prebuild e pelos plugins.

**Overlay já existente (corrida em andamento, não oferta)**

- `mobile-app/native/ride-overlay/android/LeafRideOverlayWindow.kt:133-136`: `TYPE_APPLICATION_OVERLAY` com `FLAG_NOT_FOCUSABLE`. Balão da corrida ativa, sobre Waze/Maps.
- `mobile-app/native/ride-overlay/android/LeafRideOverlayModule.kt:30-100`: métodos `getStatus`, `openOverlaySettings` (ACTION_MANAGE_OVERLAY_PERMISSION, L41-44), `showOverlay`, `hideOverlay`, `showLiveUpdate`, `cancelLiveUpdate`. Nenhum método para oferta.
- `mobile-app/src/services/LeafRideOverlay.js:106-127`: `maybeAskRideOverlayPermission` pergunta uma vez, com `Alert`, antes da primeira navegação externa. Chamado em `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:8591`. **Não está no onboarding.**

**Canais já existentes (Android)**

- `InteractiveNotificationService.js:160-166`: `driver_actions`, importância HIGH. Não é usado pelo push de oferta.
- `LeafOngoingRideNotification.js:48,188`: canais de corrida em andamento (Notifee).
- `PersistentRideNotificationService.js:138`: `ride_status`.

**iOS**

- Nenhuma ocorrência de `interruptionLevel`, `time-sensitive` ou `critical` em `mobile-app`.
- `mobile-app/app.config.js:432` e `mobile-app/plugins/withLeafRideLiveActivity.js:163`: Live Activity existe para a corrida, não para a oferta.

## 3. Restrições de plataforma

**Android**

- (a) Heads-up com full-screen intent (`USE_FULL_SCREEN_INTENT`): no Android 14+ a permissão é "special app access". O Play só concede por padrão a apps de chamada ou alarme. Para os demais, o app precisa pedir ao usuário (`canUseFullScreenIntent`, `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`), e a Play exige declaração no Console. A política de Device and Network Abuse proíbe usar a permissão para forçar interação com notificações disruptivas. Fontes: [Play Console, full-screen intent](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en), [AOSP, FSI limits](https://source.android.com/docs/core/permissions/fsi-limits), [Android 14 behavior changes](https://developer.android.com/about/versions/14/behavior-changes-14).
  - Leitura: um app de corrida (não chamada, não alarme) tem risco alto de rejeição ou de revogação. Não recomendo como caminho principal.
- (b) Janela flutuante com `SYSTEM_ALERT_WINDOW` ("Sobrepor a outros apps"): é o mecanismo que Uber e 99 usam. Já existe no Leaf (`LeafRideOverlayWindow.kt`) para a corrida em andamento. Estender para a oferta é o caminho mais aderente ao código atual.
  - Restrições: o motorista precisa ativar a permissão manualmente (`ACTION_MANAGE_OVERLAY_PERMISSION`). No Android 15/16, o sistema pode mostrar aviso de "app sobreposto". Com a permissão, o app pode iniciar uma janela a partir de background.
  - Xiaomi/HyperOS: além de "Sobrepor a outros apps", o HyperOS costuma ter "Exibir janelas pop-up em segundo plano" e "Abrir novas janelas em segundo plano", separados. Fontes de terceiros, sem documentação oficial Xiaomi ou AOSP. Não há API confiável para checar esses toggles; precisa de guia e de teste em aparelho Xiaomi real.
- Canal de alta importância com heads-up (sem overlay): funciona em qualquer Android, sem permissão extra. Mas a notificação aparece como banner no topo, não como card por cima do app. O motorista precisa tocar.

**iOS**

- Não há sobreposição de app de terceiros. O máximo é notificação com `interruption-level` `time-sensitive` (aparece com prioridade, fura foco; exige capability "Time Sensitive Notifications" no Xcode). `critical` exige entitlement aprovado pela Apple, inadequado para oferta de corrida.
- Live Activity: mostra a corrida em andamento na Dynamic Island e na tela de bloqueio. Não serve como card de oferta que aceita ou recusa.
- Conclusão: no iOS o "card por cima" não é possível. Dá para chegar perto com notificação time-sensitive e um Live Activity no estado de oferta, se houver interesse.

## 4. Proposta mínima recomendada

Ordem por custo e risco.

**Fase 0: heads-up confiável no Android (sem permissão nova)**

- `leaf-websocket-backend/services/offer-push.js` L38-ish: incluir `channelId: 'ride_offer'` no retorno de `buildOfferPushNotification`.
- `mobile-app/src/services/InteractiveNotificationService.js:160` (ou módulo de canais equivalente): criar canal `ride_offer` com `importance: HIGH`, som e vibração, no bootstrap do app (reaproveitar `setupAndroidChannels`).
- Testes: `leaf-websocket-backend/tests/unit/services/offer-push.unit.test.js` (asserção do `channelId`).
- Não resolve o card por cima do app; resolve o aviso que some na barra.

**Fase 1: card de oferta em overlay (Android)**

- Backend: enviar a oferta também como mensagem **data-only** de alta prioridade (ou manter o híbrido e incluir `data` completa), para o handler de background rodar. Decisão: híbrido não acorda o JS quando o app está morto. Avaliar com QA.
- Mobile nativo: novo método em `LeafRideOverlayModule.kt` (`showOfferCard`) e `LeafRideOverlayWindow.kt` (card com aceitar/recusar, tempo restante e valor líquido). Reaproveitar o `TYPE_APPLICATION_OVERLAY` atual.
- Acionar o overlay a partir de `FCMBackgroundMessageHandler.js` (`index.js:4,11`) ou de um `FirebaseMessagingService` nativo. A segunda opção é mais confiável com o app morto.
- Aceitar: abre o Leaf na tela da oferta (`RobotaxiDriverOfferScreen.js`) com `bookingId`. Não aceitar direto pelo overlay sem a tela de confirmação do Leaf, para não mudar a regra de aceite.
- Dismiss: `dismissRideOfferNotifications` (`FCMNotificationService.js:626`) cobre a barra; o overlay precisa de `hideOfferCard` quando a oferta expira (`expiresAt`) ou é aceita em outro lugar.
- Pedido de permissão: ver seção 5.

**Fase 2: iOS (opcional)**

- `aps` com `interruption-level: time-sensitive` em `fcm-service.js` L545-551, condicionado a `notification.interruptionLevel`.
- Capability no Xcode. Avaliar Live Activity de oferta depois.

**Não recomendado agora**

- `USE_FULL_SCREEN_INTENT`: risco de política na Play para app que não é chamada ou alarme. Exige decisão explícita e pode ser recusado. Se for avaliado, depende de aprovação de produto.

## 5. Fluxo de permissão no onboarding do motorista

Mapeamento do onboarding do motorista não foi detalhado nesta pesquisa. Pontos conhecidos:

1. Notificações: já pedida em `FCMNotificationService.js:219-230` com disclosure (`AndroidPermissionDisclosure.js`). Manter.
2. Sobrepor a outros apps (novo passo, só Android, só motorista, depois de notificações):
   - Texto: "Para ver a nova corrida por cima do Waze ou do Google Maps, ative 'Sobrepor a outros apps' para o Leaf."
   - Botão "Ativar" abre `openRideOverlaySettings()` (`LeafRideOverlay.js:93-97`). Ao voltar, `getRideOverlayStatus()` (`LeafRideOverlay.js:81-90`) confirma `canDrawOverlays`.
   - Botão "Agora não" grava o estado e mostra aviso no painel do motorista ("sem ele, você só recebe o aviso na barra").
   - Reaproveitar `maybeAskRideOverlayPermission` (L106) com a mesma flag `ASKED_KEY`, mas disparada no onboarding e não na primeira navegação.
3. Xiaomi/HyperOS: após o passo 2, mostrar guia com "Exibir janelas pop-up em segundo plano" e "Economia de bateria: sem restrições". Não é possível checar com segurança; o guia é a única saída.
4. Backend: o overlay é só UI. A regra de aceite e a elegibilidade continuam no backend (`AGENTS.md`).

## 6. Riscos

- Heads-up depende do canal `ride_offer` e da importância; hoje o canal `default` não é controlado pelo Leaf. Validar em aparelho.
- Overlay de oferta com o app morto depende de handler nativo. Teste em Android 14, 15 e 16, Samsung e Xiaomi.
- Motorista que nega `SYSTEM_ALERT_WINDOW` fica só com o aviso na barra. Medir taxa de ativação.
- Política Play: manter `SYSTEM_ALERT_WINDOW` com justificativa clara no formulário de dados e na descrição da loja.
- Mudança de payload afeta todos os motoristas. Usar a flag `ENABLE_NEW_OFFER_PUSH` e uma flag mobile para o overlay.
- Não há evidência de produção nesta pesquisa. Nenhum teste em aparelho real foi feito.

## 7. Validação sugerida (não executada)

- Baseline: `git status --short`, `git diff --check`, `npm run governance:check`.
- Mobile: `npm --prefix mobile-app run qa:production-guards`, `npm --prefix mobile-app run test:unit -- --runInBand`.
- Backend: `npm --prefix leaf-websocket-backend run config:validate`, `npm --prefix leaf-websocket-backend run test:unit -- --runInBand`.
- Device: matriz Android 14/15/16 (Samsung e Xiaomi) com app em background, morto e com Waze em primeiro plano; iOS com app em background e foco ativo.

## 8. Rollback

- Backend: desligar `ENABLE_NEW_OFFER_PUSH` (volta ao comportamento atual) ou reverter `channelId`/payload.
- Mobile: desligar a flag de overlay de oferta; o canal `ride_offer` pode ficar sem uso.
- Permissão: o motorista pode revogar "Sobrepor a outros apps" a qualquer momento.

## 9. Fora de escopo

- Regras de aceite, preço, elegibilidade e reoferta (`driver-notification-dispatcher.js`).
- Remoção ou renomeação de código legado.
- Alterações em `app.config.js` e no manifest sem aprovação de build nativo (AGENTS: "requer build nativo" é condição de parada).
- Nenhuma alteração em lojas, Firebase ou console.

## Fontes externas

- [Play Console: foreground service e full-screen intent](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en)
- [AOSP: Full-screen intent limits](https://source.android.com/docs/core/permissions/fsi-limits)
- [Android Developers: Behavior changes Android 14](https://developer.android.com/about/versions/14/behavior-changes-14)
- Xiaomi/HyperOS: apenas fontes de terceiros; não validado em documentação oficial.
