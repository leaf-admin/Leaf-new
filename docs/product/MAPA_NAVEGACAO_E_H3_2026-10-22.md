# Mapa de navegação externa, notificações do motorista e H3 / tarifa dinâmica

Data da leitura: 2026-10-22. Tarefa somente leitura: nenhum arquivo de código foi editado, nenhum commit feito, nenhum servidor acessado.

## 0. Base da leitura

- Repositório lido: `/Users/izaakdias/Documents/leaf-wave`, branch `feat/driver-passenger-wave`, HEAD `fe43fb441`.
- A tarefa pedia base `main`. A árvore de trabalho atual não é `main` (`main` = `422760e1a`). Não houve checkout.
- Diferenças com `main` nos arquivos centrais da navegação: `mobile-app/src/services/LeafRideOverlay.js` (+13 linhas) e `mobile-app/src/services/externalNavigationSession.js` (+12/-2). Os demais arquivos citados são idênticos a `main` nos caminhos verificados. Onde a branch muda, a referência é desta branch.
- Convenção: `arquivo:linha` indica a linha da branch lida.

---

## Parte A: navegação externa do motorista

### A1. Deep links e pernas da rota

**Montagem das URLs** (`mobile-app/src/services/DriverExternalNavigationService.js`):

| Provedor | URL nativa | URL web (fallback) | Linhas |
|---|---|---|---|
| Google Maps | `comgooglemaps://?daddr={lat},{lng}&directionsmode=driving` | `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}[&waypoints={stop}]&travelmode=driving&dir_action=navigate` | 83, 87-89 |
| Waze | `waze://?ll={lat},{lng}&navigate=yes` | `https://waze.com/ul?ll={lat},{lng}&navigate=yes` | 90-91 |
| Mapas da Apple (só iOS) | `http://maps.apple.com/?daddr={lat},{lng}&dirflg=d` | o mesmo link | 92, 100-103 |

- Google Maps: `openGoogleMaps` (linhas 94-98) abre a URL nativa se `Linking.canOpenURL` der verdadeiro, senão abre a URL web.
- O parâmetro de parada (`stopover`, embarque) só entra na URL web do Google (linhas 86-89). A URL nativa `comgooglemaps://` (linha 83) não recebe a parada. Se `canOpenURL` um dia voltar verdadeiro, o embarque some da rota no Google.
- Waze: `openWaze` (linhas 105-109) segue a mesma regra nativa/web. Não há parâmetro de parada no Waze.

**Pernas da corrida** (`mobile-app/src/services/driverNavigationPreference.js`, função `openPreferredDriverNavigation`, linhas 86-108):

| Momento | Fase | Coordenada passada | Como o Google recebe | Waze / Apple recebem |
|---|---|---|---|---|
| Aceite, a caminho do embarque | `pickup` | `pickupCoordinate` (via `resolveTarget`, `PrototypeDriverTripAssistantService.js:95-112`) | Duas pernas: `stopover` = embarque, `destination` = destino final (linhas 97-101) | Só o embarque |
| Corrida iniciada, embarque → destino | `destination` | `destinationCoordinate` (`PrototypeDriverTripAssistantService.js:96-102`) | Só o destino | Só o destino |

- `bothLegs` (linha 97) exige `app === 'google_maps'`, `phase === 'pickup'` e coordenada final válida.
- Consequência: Waze e Apple não recebem a perna de destino a partir do embarque. Recebem a rota de destino só quando a corrida inicia.

**Abertura automática e manual:**

- Automática (uma vez por corrida e fase): `RobotaxiHomeScreen.js:8815-8849`.
  - Fase `pickup` quando `status === 'accepted'` (linhas 8816-8818). Fase `destination` quando `status === 'started'` (linhas 8819-8821).
  - Dispara após 1,2 s (linha 8838), só com o app em `active` (linha 8834).
  - Não abre se o motorista já está no raio do embarque (`proximityReached`, linhas 8826-8827 e 8836).
  - Trava por corrida e fase: `claimAutoNavigationOpen` (`driverNavigationPreference.js:120-126`) grava uma única chave em `leaf:driver-navigation-last-auto-open:v1` (linha 12). Guarda só a última abertura, não um conjunto.
- Manual: botão em `RobotaxiDriverTripScreen.js:1831-1859` (`handleOpenNavigation`) e em `RobotaxiHomeScreen.js:8792-8811` (`handleOpenDriverNavigation`). Os botões de disparo estão em `RobotaxiDriverTripScreen.js:1993`, `:2375` e `:2466`.
- Ação "Navegar" da notificação: `prototypeRideRuntime.js:20824-20841`, usando `latestContext.target` e `destinationCoordinate` como `finalDestinationCoordinate`.

**Preferência salva** (`mobile-app/src/services/driverNavigationPreference.js`):

- Chave do app: `leaf:driver-navigation-app:v1` (linha 10). Valores aceitos: `waze`, `google_maps`, `apple_maps` (linhas 14-18). Apple só entra no iOS (linhas 20-23).
- Sem preferência: abre uma folha de escolha (`choosePreferredNavigationApp`, linhas 65-80) e guarda a resposta (linhas 92-95). A opção "Perguntar toda vez" só aparece quando `allowAskEveryTime` é verdadeiro (linha 71). Essa opção zera a preferência (linhas 75-77).
- Abertura automática ligada/desligada: `leaf:driver-navigation-auto:v1` (linha 11). Valor padrão verdadeiro (linhas 56-58).
- Ao abrir, o app registra o último provedor em `leaf:driver-external-navigation:last:v1` (`externalNavigationSession.js:8`, linha 106 de `driverNavigationPreference.js`). Esse registro vale por 6 horas (`externalNavigationSession.js:10`) e alimenta a oferta de "fechar navegação" no recibo.

**Fechamento da rota** (`externalNavigationSession.js:64-93`):

- Android/Google: intent `geo:` com `packageName` do Maps e `MapsActivity`, em nova tarefa (linhas 67-76). Sem nova tarefa, o Maps abriria dentro da tarefa do Leaf (comentário, linhas 15-17).
- iOS/Google: `comgooglemaps://?center=...` (linha 78).
- Waze: `waze://` (linha 80). Apple: `maps://` (linha 82).

### A2. Notificação contínua do motorista e botões

**Quem cria:** a sessão de corrida do motorista (`mobile-app/src/services/PrototypeDriverTripAssistantService.js`) monta a descrição em `buildNotificationDescriptor` (linhas 277-382). Ela é enviada a `PersistentRideNotificationService` (`PrototypeDriverTripAssistantService.js:518-570`). A notificação nativa Android é de `LeafOngoingRideNotification.js` (notifee, canal `leaf_ride_live`, ID `leaf-ride-live`, linhas 11-12), com `ongoing: true` e `autoCancel: false` (linhas 94-95).

**Botões por estado:**

| Estado (`session.status`) | Título | Botões Android (`androidActions`) | Categoria iOS | Linhas |
|---|---|---|---|---|
| `accepted`, ainda longe do embarque | A caminho do embarque | "Navegar" (`open_navigation`) | `null` | `PrototypeDriverTripAssistantService.js:293-306` |
| `accepted` e `pickupToleranceReached` | Você chegou ao embarque | "Cheguei ao embarque" (`arrived_at_pickup`) | `DRIVER_PICKUP_READY` | `:298-305` |
| `arrived` | Aguardando embarque | "Iniciar corrida" (`start_trip`) | `DRIVER_BOARDING` | `:323-337` |
| `started` | Viagem em andamento | "Navegar" (`open_navigation`) e "Encerrar" (`end_trip`) | `DRIVER_TRIP_ACTIVE` | `:348-359` |

- Limite de botões no Android: 3 (`LeafOngoingRideNotification.js:115-121`).
- A constante `NAVIGATE_ACTION` é definida em `PrototypeDriverTripAssistantService.js:275`.
- Aviso separado de chegada (heads-up, com "Cheguei ao embarque" ou "Encerrar corrida"): `resolveArrivalAlert` (`:386-409`), disparado em `syncArrivalAlert` (`:575-600`). Com o Leaf em primeiro plano, o aviso não é mostrado (`:596-598`).
- Desligado no iOS simulador: `SHOULD_DISABLE_PERSISTENT_NOTIFICATIONS` (`:20-21`).

**Como o toque é tratado:**

- Android (notifee): `setOngoingRideActionListener` (`LeafOngoingRideNotification.js:234-250`) filtra `EventType.ACTION_PRESS` (linha 239), ignora `default` (linha 241) e chama o listener. Foreground e background usam o mesmo `handle` (linhas 248-249).
- O listener é ligado em `PersistentRideNotificationService.js:154-156` e encaminha para `interactiveNotificationService.dispatchExternalAction` (`InteractiveNotificationService.js:108-122`).
- Executor único: `prototypeRideRuntime.js:20792-20845`:
  - `arrived_at_pickup` (linhas 20801-20812): só executa se o motorista estiver a 80 m do embarque (`PICKUP_TOLERANCE_METERS`, linha 13 de `PrototypeDriverTripAssistantService.js`). Fora do raio, retorna sem ação (linhas 20807-20809).
  - `start_trip` (20814-20817), `end_trip` (20819-20822), `open_navigation` (20825-20841).
- iOS (expo-notifications): `InteractiveNotificationService.js:440-482` trata `arrived_at_pickup`, `start_trip` e `end_trip`. `open_navigation` não está nessa lista.
- As categorias iOS são registradas em `InteractiveNotificationService.js:205-221`, com as ações de `getCompactCategoryActions` (linhas 37-70). Nenhuma categoria do motorista inclui `open_navigation`. Inferência pelo código: no iOS o botão "Navegar" não aparece na notificação. Confirmar em aparelho.

### A3. Bolha / balão flutuante sobre o mapa

Há dois elementos distintos, ambos só no Android:

1. **Balão nativo ("pílula" e cartão), janela sobreposta.** É o item "bolha" que aparece sobre o Waze ou o Google Maps.
   - Módulo JS: `mobile-app/src/services/LeafRideOverlay.js`. Estado por corrida em `buildRideOverlayState` (linhas 38-63). Botão do balão: só `arrived_at_pickup`, `start_trip` e `end_trip` (`STAGE_ACTIONS`, linha 15). `end_trip` só aparece perto do destino (linha 43, `nearDestination`). "Navegar" não entra no balão (comentário, linhas 12-14).
   - Mostra quando o Leaf vai para segundo plano: `ensureListening` (linha 139) escuta `AppState`. `render` (linha 163) chama `showOverlay` só se `appState !== 'active'` e o balão estiver habilitado. Ao voltar para `active`, o balão some (`hideOverlay`, linha 194).
   - Não é "bolha do Google Maps". É código do Leaf.
   - Janela nativa: `native/ride-overlay/android/LeafRideOverlayWindow.kt` usa `WindowManager` com `TYPE_APPLICATION_OVERLAY` (linhas 133-135, `TYPE_PHONE` como fallback) e `FLAG_NOT_FOCUSABLE` (linha 136). Não rouba foco.
   - Toque: no cartão, o botão da etapa envia a ação (`LeafRideOverlayWindow.kt:201-202`). Toque simples sem arrasto abre o Leaf (`:486`). O intent é `leafapp://robotaxi/home?rideAction=...&rideBookingId=...` (`native/ride-overlay/android/LeafRideOverlayState.kt:47-59`), o mesmo esquema de `rideActionLink.js:2`.
   - Pode ser arrastado; a posição é guardada (`pillY`, `LeafRideOverlayWindow.kt:251-252`).
   - Permissão: `android.permission.SYSTEM_ALERT_WINDOW` pelo plugin `plugins/withLeafRideOverlay.js:20`. Comentário em `app.config.js:307-308` diz que a permissão saiu do manifesto geral e voltou só para esse balão. Plugin ativo em `app.config.js:433`.
   - Pedido de permissão: uma vez, após ligar a disponibilidade do motorista (`RobotaxiHomeScreen.js:8586-8593`, `nextValue` verdadeiro). O texto pergunta "Ver a corrida por cima do mapa?" (`LeafRideOverlay.js:106-133`, chave `leaf:driver-ride-overlay-asked:v1`).
   - Liga/desliga: `leaf:driver-ride-overlay:v1` (`LeafRideOverlay.js:10`, padrão ligado em `isRideOverlayEnabled`, linhas 62-66). Ajuste em `RobotaxiSettingsScreen.js:162`.
   - O módulo nativo só existe no build 1.0.9 ou superior (comentário, `LeafRideOverlay.js:8`). `nativeModule()` devolve nulo fora do Android (`:17-19`).

2. **Live Update (Android 16).** Não é flutuante. É a notificação da corrida como chip de status e trilha. `PersistentRideNotificationService.js:86-101` chama `rideOverlay.showLiveUpdate`. O código nativo está em `native/ride-overlay/android/LeafRideLiveUpdate.kt`, com suporte a partir do SDK 36 (`:27`).

Observação de branch: `LeafRideOverlay.js` e `externalNavigationSession.js` diferem de `main` (seção 0). Verificar o comportamento em `main` antes de tratar esses trechos como definitivos.

### A4. Detecção de apps instalados

- `Linking.canOpenURL` é usado só em `DriverExternalNavigationService.js:23-29` (`safeCanOpenURL`), nas linhas 95 e 106. Serve para escolher nativo ou web.
- O seletor de preferência não verifica instalação. `navigationAppOptions` (`driverNavigationPreference.js:20-23`) sempre lista Waze e Google Maps, e Apple no iOS.
- Configuração de consultas:
  - iOS: não há `LSApplicationQueriesSchemes` em `mobile-app/app.config.js` (busca por `LSApplicationQueriesSchemes` sem resultado). Sem essa lista, `canOpenURL('comgooglemaps://')` e `canOpenURL('waze://')` retornam falso.
  - Android: `plugins/withLeafMaterial.js:50-55` adiciona só a consulta de intent `android.intent.action.TTS_SERVICE`. Nenhum pacote do Waze ou do Google Maps é consultado.
- Efeito pelo código (inferência, confirmar em aparelho): `safeCanOpenURL` tende a dar falso, então a navegação sempre cai na URL web (`https://www.google.com/maps/dir/...` e `https://waze.com/ul...`). Isso faz a perna de parada chegar ao Google (linha 89), mas a escolha do app ainda depende do Android/iOS abrir o link web no app instalado.
- Código legado: `mobile-app/src/services/NavigationService.js` (configuração nas linhas 23-40, `openExternalNavigation` na linha 190, `canOpenURL` nas linhas 241-251) e `mobile-app/src/components/NavigationAppSelector.js` (importa `NavigationService` na linha 14; `canOpenURL` nas linhas 44-70). Nenhum componente de tela importa `NavigationAppSelector`. `NavigationService` só aparece em `mobile-app/test-hybrid-navigation.cjs:42`. Candidatos a remoção, sem remover nada nesta tarefa. Antes de remover, conferir com `rg` (AGENTS.md).

### A5. Como a navegação é disparada, resumo

Um toque ou um evento de corrida leva a `openPreferredDriverNavigation`. Se a preferência existe, abre o provedor; senão, pergunta uma vez. Google recebe duas pernas no embarque. Waze e Apple recebem uma perna por vez. A notificação, o balão e a Home usam o mesmo caminho, e o balão é a única superfície que aparece sobre o mapa de terceiros.

---

## Parte B: H3, demanda e tarifa dinâmica

### B5. Caminho que produz o "+6%"

**Passo 1. Entrada de pedidos abertos.** A função `collectOpenRequests` (`leaf-websocket-backend/services/h3-map-service.js`, varredura de `booking_search:*`) lê o estado de cada pedido. Só conta os estados de `SEARCHABLE_STATES` (linha 44): `SEARCHING`, `PENDING`, `EXPANDED`, `NOTIFIED`, `AWAITING_RESPONSE`, `REASSIGNMENT_PENDING`.

- Dentro de `collectOpenRequests`, `isRecent` é calculado com a janela de 10 minutos (linhas 34 e 819), mas **não é usado para filtrar** (a variável aparece só nas linhas 819 e 825). Por isso, pedidos antigos continuam contando enquanto a chave `booking_search:*` existir e o estado for pesquisável. A janela de 10 minutos é uma constante morta para a contagem.
- Cada pedido soma em `cell.openRequests` e em `cell.demand` na célula H3 do embarque (linhas 999-1004).

**Passo 2. Oferta ao motorista e expiração em 20 s.**

- Valor padrão do timeout de resposta: 20 segundos (`utils/dispatch-config.js:1`, variável `DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS`).
- O timeout é agendado em `services/driver-notification-dispatcher.js:1655-1668` e a trava do motorista usa o mesmo TTL (`:1102`).
- Quando dispara (`:1671-1726`):
  - Só age se o estado ainda for `SEARCHING`, `EXPANDED`, `NOTIFIED` ou `AWAITING_RESPONSE` (`:1677-1682`).
  - Apaga a notificação ativa do motorista e a reserva da oferta (`:1687-1688`).
  - Aplica cooldown de reoferta para aquele motorista e aquele pedido: chave com valor `timeout` e expiração de `DRIVER_REOFFER_COOLDOWN_SECONDS` (`:1693-1702`). Padrão 30 segundos (`:137-140`, mínimo 30 em `:141-143`).
  - Libera a trava do motorista (`:1705`).
  - **Não cancela o pedido.** Volta para o estado anterior (`resumeState`, `:1711-1726`) e grava `timeoutDriverId`/`timeoutAt`.
  - Registra `DRIVER_TIMEOUT` no event sourcing (`:1744`).
- O aceite tardio recebe "Oferta expirada para este motorista" (`commands/AcceptRideCommand.js:336`, `:495`, `:682`).
- Não há "unmatched" como estado no código. Termos próximos encontrados: `NO_DRIVERS_FOUND` (`AcceptRideCommand.js:393`) e `SEARCH_TIMEOUT` (`gradual-radius-expander.js:231`).

**Passo 3. Busca continua depois da expiração.** O pedido só sai do mapa quando sai dos estados pesquisáveis ou quando a chave some. A expansão de raio espera pelo menos `MATCH_MINIMUM_SEARCH_DURATION_MS` = 180000 ms, padrão de 3 minutos (`services/gradual-radius-expander.js:94-97`), antes de finalizar por `SEARCH_TIMEOUT` (`:211-223`). Ou seja, um pedido que segue sem aceite fica contando no hexágono por pelo menos 3 minutos.

**Passo 4. Motorista disponível.**

- A disponibilidade no mapa vem de `driver.available` (`h3-map-service.js:758`): `eligibleSet.has(driverId) || status === 'available'`.
- `eligibleSet` vem do ZSET `driver_locations_eligible` (`h3-map-service.js:715`).
- O ZSET muda por elegibilidade (online, KYC, status), não por oferta. `driver-dispatch-availability-service.js:46-52` faz `geoadd` quando elegível e `zrem` quando não.
- Consequência: um motorista com oferta expirada continua contando como disponível no hexágono, se continuar elegível.

**Passo 5. Cálculo do percentual.**

- `buildSurgeDisplay` (`h3-map-service.js:293-312`) chama `calculateDemandPressure` (`leaf-websocket-backend/services/pricing/demandPressure.js:18-86`) com `openRequests` e `availableDrivers`.
- `calculateDemandPressure`:
  - `demand` lê `active_requests_5m ?? open_requests ?? openRequests ?? demand` (`demandPressure.js:19-28`).
  - `availableDrivers` lê `idle_drivers ?? available_drivers ?? availableDrivers` (`:29-37`).
  - Razão `demand / max(available, 1)` (`:58`). Normalizada pelas faixas `DEMAND_SUPPLY_BREAKPOINTS` (`:5-11`): 0,8→0; 1,0→0,2; 1,5→0,6; 2,0→0,85; 3,0→1. Interpolação linear em `normalizeRange` (`services/pricing/utils.js:40-68`).
  - Falta: `shortage = max(0, demand - available)` (`:63`), `shortageNorm = min(1, shortage/6)` (`:64`).
  - `score = clamp(0,8·ratioNorm + 0,2·shortageNorm, 0, 1)` (`:66-71`).
  - `percent = min(40, max(0, round(score·40)))` (`:72-75`). Teto `MAX_DEMAND_MARKUP_PERCENT = 40` (`:3`).
  - Níveis: `yellow` (<13), `red` (13 a 24), `purple` (≥25) (`:77-80`).
  - Multiplicador: `1 + percent/100` (`:86`).

**Conta do +6% (caso do dono):** um pedido aberto e um motorista disponível no mesmo hexágono.

- `demand = 1`, `available = 1`.
- Razão = 1,0 → `ratioNorm = 0,2`.
- `shortage = 0` → `shortageNorm = 0`.
- `score = 0,8 × 0,2 = 0,16`.
- `percent = round(0,16 × 40) = round(6,4) = 6`. Nível `yellow`.

Outros casos calculados com o mesmo código:

- 1 pedido e 0 motoristas: razão 1,0 (`max(0,1)=1`), `shortage = 1`, `shortageNorm = 0,167`, `score = 0,16 + 0,033 = 0,193`, `percent = round(7,73) = 8`.
- 2 pedidos e 1 motorista: razão 2,0 → `ratioNorm = 0,85`, `shortage = 1`, `score = 0,68 + 0,033 = 0,713`, `percent = round(28,5) = 29`, nível `purple` (≥25).

**Limiar de exibição da etiqueta:** `SURGE_LABEL_MIN_PERCENT = 3` (`h3-map-service.js:37-40`), `labelVisible` quando `percent >= minPercent` (`:306-311`). Por isso um hexágono com +6% mostra a etiqueta.

**Sobre a expiração em si:** nenhum desses inputs muda quando a oferta expira. O pedido continua aberto e o motorista continua elegível antes e depois do timeout. Portanto o código não tem um "bônus" de expiração. O que a expiração faz é deixar o pedido aberto (passo 3). Se o +6% apareceu depois do card expirar, as explicações possíveis são:

1. O pedido já estava aberto no hexágono, e o mapa só atualizou depois (cache e polling, ver B5.6).
2. O motorista ficou disponível de novo por outro motivo (status ou localização) no mesmo intervalo.

O código lido não permite afirmar que a expiração causou o +6%. Recomendação: confirmar com as chaves `booking_search:*` e a resposta de `/api/map/h3-cells` antes e depois do evento, de forma somente leitura.

**Onde a tarifa cobrada entra (não é a mesma coisa que o +6% do mapa).**

- O modo padrão é `dry_run` (`leaf-websocket-backend/services/pricing/index.js:63-66`, `docker-compose.production.yml:209`, `config/pilot-controlled.env.example:83`).
- Em `dry_run` (e `legacy`), `fare = legacyFare` (`pricing/index.js:286-287`). A parcela de demanda do mapa não entra na tarifa cobrada.
- `legacyFare` usa o `score_pressao` de `calculatePressureScore` (`pricing/pressureScore.js:53-87`, pesos 0,35 razão, 0,20 ETA de embarque, 0,25 inflação de trânsito, 0,10 cancelamento, 0,10 aceite baixo), e `score_excecao` (`pricing/exceptionScore.js`).
- Markup dinâmico = `min(0,40, 0,15·pressão + 0,20·exceção)` (`pricing/calculateFare.js:106-112`).
- Para 1 pedido e 1 motorista, com ETA e trânsito normais, a parcela de pressão fica perto de 0,07 × 0,15 ≈ 1%. A parcela de exceção não foi calculada aqui. Não há evidência no código de que o passageiro pagou +6%.
- Modo `active` (`demand_pressure_v2`): `fare = demandFare` (`pricing/index.js:278-287`), com `dynamic_markup_rate = demandPressure.markupRate` (`:283`). Só nesse modo o +6% do mapa vira tarifa. A mensagem ao passageiro sobre pressão só aparece em `active` (`pricing/index.js:69-80`).
- Teto de markup: `MAX_DYNAMIC_MARKUP_RATE = 0,40` (`calculateFare.js:4-5`). Pesos legados: 0,15 pressão e 0,20 exceção (`calculateFare.js:12-13`).

**Nome enganoso.** `active_requests_5m` não tem janela de 5 minutos. É a soma de `openRequests` das células do anel de pricing (`services/pricing-context-provider.js:320` e `:348`). A mesma coisa vale para `request_volume` (`pricing/volumeGuard.js:42`).

**Cache e atraso de tela.**

- Backend: cache do mapa de 10 s (`h3-map-service.js:11`, `:486-498`). Cache de chaves de busca de 30 s (`:30-33`). Resolução do mapa pelo zoom, faixa 6 a 10 (`:525`), padrão 8 no estilo (`:314`).
- App do motorista: busca só com o overlay visível (`RobotaxiHomeScreen.js:5366-5368`). Intervalo mínimo de 30 s e polling padrão de 60 s (`:378-380`). Refresh por socket com debounce de 900 ms (`:377`). Viewport com debounce de 420 ms (`:376`).
- Ou seja: um pedido novo pode levar até cerca de 60 s para aparecer, e a tela fica até 10 s atrás do backend.

**Hexágono "todo verde".** No app do motorista não existe verde na camada de surge:

- A camada de surge usa `cell.style.fill` do backend. No surface `driver` a paleta é amarelo, vermelho e roxo (`h3-map-service.js:333-342`). Verde só aparece no surface `dashboard`, gradiente a partir de `#22C55E` (`:355-366`).
- O verde do app vem da camada de calor histórico, desenhada como `rgba(132,201,76, ...)` (`mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:6262-6274`). Ela não depende de oferta nem de expiração. Está detalhada em B6.

Hipótese para "todo verde": a camada de calor (verde) e a tinta fraca de surge amarela ficam sobrepostas. Com +6%, `fillOpacity` é baixo (`h3-map-service.js:348`) e o app limita a 0,2 (`RobotaxiHomeScreen.js:6286`). Não foi possível ver a tela; confirmar com captura do aparelho.

### B6. Como o app do motorista desenha os hexágonos

**Busca e renderização da camada de surge:**

- Chamada: `fetchH3CellsForRegion` faz `GET /api/map/h3-cells` com `surface = driver` por padrão (`mobile-app/src/services/runtime/h3MapService.js:142-170`).
- Renderização: `driverH3MapChildren` (`RobotaxiHomeScreen.js:6238-6292`). Só desenha células com `surge.percent > 0` e polígono válido (`:6246-6254`). Polígonos com `fillColor` de `cell.style.fill` e opacidade limitada a 0,2 (`:6284-6287`).
- Política visual padrão: `DEFAULT_DRIVER_H3_VISUAL_POLICY` (`RobotaxiHomeScreen.js:192-200`), com `enabled: true`, rótulo ligado e `maxVisible: 5`.
- Quando aparece: `showDriverH3Overlay` = motorista, rota `home` e `showDriverHomeOverlay` (`:5366-5368`). Some ao sair da tela (`:5866-5872`).

**Camada de calor histórico (verde):**

- Busca `GET /api/drivers/me/demand-heat` a cada 5 minutos e ao entrar no mapa (`RobotaxiHomeScreen.js:6215-6236`, `h3MapService.js:184-188`).
- Filtra pelo que está na tela com folga de 25% (`h3MapService.js:191-208`).
- Cor: `rgba(132,201,76, 0,06 a 0,22)` pela intensidade (`RobotaxiHomeScreen.js:6271`).
- Backend: `leaf-websocket-backend/routes/drivers.js:391-402` devolve o cache `leaf:h3:demand-heat:current`.

**Etiquetas "+N%":**

- Montagem: `driverH3LabelCells` (`RobotaxiHomeScreen.js:6296-6320`). Só células com `labelVisible` e centro dentro da região (margem 3,5%). Ordena pelo maior percentual e aplica `selectSeparatedH3Labels` com `maxVisible` (máx. 5, `:6318`).
- Texto: `cell.surge.label` ou `+{arredondado}%` (`:10069-10070`). Largura pela função `resolveSurgeFlagWidth` (`:1912`).
- Fora do mapa: as etiquetas são `View` sobre o mapa, não marcadores nativos (comentário, `:6294-6295`).

**Adicional noturno de 15% no mapa ou tag:** não aparece no mapa nem nas etiquetas.

- A regra é do backend: 15% entre 23h e 4h (`leaf-websocket-backend/services/pricing/nightSurcharge.js:8-10`, janela em `:116-119`, horário de São Paulo/Rio).
- O cálculo de surge no mapa (`h3-map-service.js`) não usa adicional noturno. `grep` por "night", "noturn" e "surcharge" não encontra nada nesse arquivo.
- Onde aparece para o motorista:
  - Aviso de início e fim do adicional: `mobile-app/src/screens/prototype/nightSurchargeNotice.js:5-7` e `:33-40`. Disparado em `prototypeRideRuntime.js:20905-20957`.
  - Cartão de estado transitório: `mobile-app/src/screens/prototype/home/DriverTransientStateCard.js:18-21`.
  - Sinal de tarifa acima do normal (oferta): `mobile-app/src/screens/prototype/fareSignal.js:18` (rótulo "tarifa noturna") e `:58-63` (soma de dinâmico e noturno no caminho sem `fare_signal` do servidor). Usado em `home/DriverLiveRideOverlay.js:643` (cartão da oferta).
- O sinal também chega ao passageiro na cotação (`PassengerHomeOverlay.js` e `RobotaxiDestinationScreen.js`).
- O sinal do servidor não foi inspecionado aqui, então não é possível confirmar se o rótulo "tarifa noturna" aparece nesse caminho.

### B6.1. Calor histórico (camada verde) e o que alimenta

Esta camada é separada do surge e não usa pedidos abertos nem ofertas:

- Gravação: `recordRideRequest` (`leaf-websocket-backend/services/demand-history-service.js:61-77`), chamado na criação do pedido (`bootstrap/register-socket-create-booking-handler.js:1946`). Conta uma vez por `bookingId` (chave `seen`, linhas 66-70, TTL de 2 dias).
- Janela: mesma hora nas últimas 4 semanas (peso 1/4) e a hora seguinte (meio peso), mais as 2 últimas horas de hoje (`:81-95`). Fuso `America/Sao_Paulo` (`:21`).
- Mínimo: 3 pedidos por célula (`:24`, `MIN_REQUESTS_PER_CELL`). Até 200 células (`:25`). Resolução H3 8 (`:20`).
- Intensidade: `sqrt(score/top)` (`:122`). Níveis `high` ≥0,66, `medium` ≥0,33, senão `low` (`:131`).
- Publicação: job `pricing-baseline-worker.js:104` (`materializeDemandHeat`), TTL de 30 minutos (`:27`). Frequência do job não verificada aqui.
- Um pedido expirado não gera calor novo. Só o pedido criado conta, e uma vez.

### B7. Riscos e lacunas

- Divergência entre o +6% do mapa e a tarifa cobrada em `dry_run` (seção B5). Quem lê o mapa pode achar que está pagando surge. Vale checar se a copy do mapa informa isso.
- Contagem de pedidos antigos: `isRecent` e a janela de 10 minutos não filtram nada (`h3-map-service.js:819-825`). Pedido parado em `SEARCHING` por minutos infla o hexágono.
- Nome `active_requests_5m` sem janela de 5 minutos (`pricing-context-provider.js:320`, `:348`).
- Verde de calor histórico e amarelo de surge podem parecer um único "hexágono verde" para o motorista (B5, último parágrafo).
- Navegação: sem consultas de pacote e sem `LSApplicationQueriesSchemes`, a checagem de app instalado não funciona e o fallback web é quem decide o app. Não confirmado em aparelho.
- Perna de parada no Google só existe na URL web (`DriverExternalNavigationService.js:83` versus `:87-89`).
- Waze e Apple recebem só uma perna por vez (`driverNavigationPreference.js:97-108`).
- Botão "Navegar" não aparece no iOS pelo código (A2).
- `NavigationService.js` e `NavigationAppSelector.js` parecem código morto (A4).
- Diferenças da branch com `main` em `LeafRideOverlay.js` e `externalNavigationSession.js` (seção 0).

### B8. Evidência não coletada (sem acesso a servidor ou aparelho)

- Estado real das chaves `booking_search:*` e do ZSET `driver_locations_eligible` no momento do evento.
- Resposta de `/api/map/h3-cells` antes e depois da expiração.
- Comportamento real das URLs de navegação em aparelho, com e sem os apps instalados.
- Captura da tela do motorista com +6% e camada de calor.
- Valor efetivamente cobrado (`dry_run` ou `active`), e a parcela de exceção.

---

## Resumo de arquivos lidos

- Mobile: `src/services/DriverExternalNavigationService.js`, `driverNavigationPreference.js`, `externalNavigationSession.js`, `PrototypeDriverTripAssistantService.js`, `LeafOngoingRideNotification.js`, `PersistentRideNotificationService.js`, `InteractiveNotificationService.js`, `LeafRideOverlay.js`, `NavigationService.js`, `components/NavigationAppSelector.js`, `runtime/h3MapService.js`, `screens/prototype/RobotaxiHomeScreen.js`, `RobotaxiDriverTripScreen.js`, `prototypeRideRuntime.js`, `fareSignal.js`, `nightSurchargeNotice.js`, `home/DriverTransientStateCard.js`, `home/DriverLiveRideOverlay.js`; `native/ride-overlay/android/*.kt`; `plugins/withLeafRideOverlay.js`, `withLeafMaterial.js`; `app.config.js`.
- Backend: `services/h3-map-service.js`, `pricing/demandPressure.js`, `pressureScore.js`, `calculateFare.js`, `index.js`, `utils.js`, `volumeGuard.js`, `nightSurcharge.js`, `pricing-context-provider.js`, `driver-notification-dispatcher.js`, `gradual-radius-expander.js`, `driver-dispatch-availability-service.js`, `demand-history-service.js`; `commands/AcceptRideCommand.js`; `routes/drivers.js`; `utils/dispatch-config.js`.
