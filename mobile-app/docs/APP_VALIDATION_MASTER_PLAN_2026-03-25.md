# Plano Mestre de Validacao do App (2026-03-25)

## Objetivo
- Definir a trilha oficial para validar regras de negocio, locks, navegacao, estados de tela e integracoes criticas do app antes de qualquer go-live.
- Unificar o que hoje esta espalhado entre checklist visual, smoke backend, teste manual e leitura de codigo.
- Produzir um veredito final do tipo `GO`, `GO COM RISCO CONTROLADO` ou `NO-GO`, sempre com evidencia.

## Escopo oficial desta validacao
- App mobile com UI principal baseada no fluxo `RobotaxiPrototype`.
- Fluxos `customer` e `driver`.
- Integracoes reais de auth, websocket, booking, pagamento, ativacao do motorista, suporte e retomada de sessao.
- Telas legacy ainda registradas no navigator, inclusive aliases e entradas de compatibilidade.

## Premissas
- Fonte de verdade de role: `auth.profile.usertype|userType|role|user_role|accountType`.
- Runtime principal: `mobile-app/src/screens/prototype/prototypeRideRuntime.js`.
- Toggle online/offline do motorista: `RobotaxiHomeScreen` -> `setDriverOnline` -> `WebSocketManager.setDriverStatus`.
- Booking so pode existir depois de pagamento confirmado, conforme regra de negocio vigente.

## Matriz P0 - bloqueadores operacionais
- `P0-01 AUTH_ROLE_SOURCE`: regra = role vem do backend; validar = login, restore session, cold start e reopen; aceite = motorista nunca cai na home de passageiro e passageiro nunca cai na home de motorista.
- `P0-02 SESSION_RESTORE`: regra = sessao precisa reidratar estado util; validar = kill/reopen em idle, searching, accepted, started e completed; aceite = nenhuma corrida ativa se perde e nenhuma tela volta para estado impossivel.
- `P0-03 PAYMENT_BEFORE_BOOKING`: regra = booking so nasce apos pagamento confirmado; validar = quote -> pix -> confirmacao -> create booking; aceite = sem booking previo, sem tela enganosa de erro e sem corrida orfa.
- `P0-04 CREATE_BOOKING_RETRY`: regra = erro transitorio nao pode abandonar o passageiro; validar = timeout, retry, webhook atrasado e reconnect; aceite = usuario nao fica em erro terminal sem opcao segura de continuidade.
- `P0-05 DRIVER_ONLINE_LOCKS`: regra = motorista nao entra online sem ativacao valida e localizacao inicial; validar = estados `LOCATION_REQUIRED`, `ONLINE_NOT_READY`, docs incompletos e reconnect; aceite = online falso nao ocorre.
- `P0-06 DRIVER_STATUS_ACK`: regra = status online/offline precisa confirmar no backend; validar = toggle normal, toggle com latencia, toggle apos reconnect; aceite = UI e backend convergem para o mesmo estado.
- `P0-07 DISPATCH_ELIGIBILITY`: regra = so motorista elegivel entra no pool; validar = assinatura, ativacao, docs, disponibilidade, corrida ativa e localizacao; aceite = motorista inelegivel nao recebe oferta.
- `P0-08 DISPATCH_RADIUS_AND_EXPANSION`: regra = busca deve respeitar raio inicial e expansao; validar = comportamento real do expander e do manager de expansao; aceite = documentar qual estrategia prevalece e se a UX bate com a regra.
- `P0-09 OFFER_ACCEPTANCE_LOCKS`: regra = uma corrida nao pode ser aceita por dois motoristas nem por motorista inelegivel; validar = aceite simultaneo, atraso de rede, supersede e expiracao; aceite = 1 booking = 1 motorista.
- `P0-10 TRIP_LIFECYCLE_LOCKS`: regra = motorista nao inicia antes do embarque e nao conclui antes do start; validar = arrived, boarding, started, completed e retorno para disponibilidade; aceite = transicoes invalidas bloqueadas.
- `P0-11 CANCEL_AND_REFUND_RULES`: regra = cancelamento precisa respeitar timing e cobrancas; validar = cancelamento antes do aceite, depois do aceite, motorista cancelando e reembolso parcial/total; aceite = saldo e status corretos.
- `P0-12 FINANCIAL_BREAKDOWN_SOURCE`: regra = taxas vem do backend; validar = oferta, recibo, ganhos, saque e isencao; aceite = app nunca calcula fallback divergente.
- `P0-13 REALTIME_RESILIENCE`: regra = reconnect com `syncActiveRide` e heartbeat precisa segurar corrida viva; validar = queda de rede, app em background, kill/reopen; aceite = corrida nao some e chat/estado retomam.
- `P0-14 SUPPORT_AND_INCIDENTS`: regra = passageiro e motorista precisam abrir suporte durante problema real; validar = ticket, chat, incidente, volta para home; aceite = suporte nao quebra fluxo operacional.
- `P0-15 NO_FALSE_FINAL_STATES`: regra = nenhuma tela pode mostrar sucesso sem backend confirmar; validar = pagamento, booking, online, aceite e conclusao; aceite = UI final sempre refletindo ack real.

## Matriz P1 - risco alto, mas nao necessariamente bloqueador imediato
- `P1-01 DRIVER_ACTIVATION_PIPELINE`: validar submissao, `in_review`, `approved`, `failed`, `Saiba mais`, persistencia entre sessoes e atualizacao por socket/poll.
- `P1-02 PASSENGER_HOME_BEHAVIOR`: validar campo de destino, voz, centralizacao, foco de rota, estados vazios e retorno ao mapa base.
- `P1-03 DRIVER_HOME_OPERATION`: validar card operacional, ganhos, meta diaria, online/offline e acessos secundarios sem glitch.
- `P1-04 MENU_BY_ROLE`: validar menu passageiro e menu motorista com itens corretos, sem opcoes indevidas e sem vazamento de rotas.
- `P1-05 PROFILE_AND_SETTINGS`: validar leitura/escrita de dados, toggles, safe area, back navigation e consistencia de estado.
- `P1-06 CHAT_AND_SUPPORT_UI`: validar loading, empty, erro, envio, retry, retorno e leitura de historico.
- `P1-07 NO_DRIVERS_AND_FAILURE_PATHS`: validar tela de falta de motoristas, falha de pagamento, falha de booking e tentativa de recuperacao.
- `P1-08 RATING_AND_COMPLAIN`: validar tela final, campos obrigatorios e estados apos conclusao/cancelamento.
- `P1-09 RECEIPT_AND_EARNINGS`: validar recibo do passageiro, relatorio de ganhos do motorista, filtros e consistencia com o backend.
- `P1-10 LEGAL_AND_PERMISSION_FLOWS`: validar termos, privacidade, textos de permissao, links e acessibilidade de paginas legais.
- `P1-11 PUSH_AND_LOCAL_NOTIFICATIONS`: validar notificacoes de corrida, chegada, mensagem e suporte, incluindo reentrada pelo app.
- `P1-12 EMPTY_ERROR_LOADING_STATES`: validar que todas as telas relevantes tem comportamento coerente nesses tres estados.

## Matriz P2 - polimento, consistencia e reducao de risco de revisao
- `P2-01 COPY_CLEANUP`: remover `prototype`, `mock`, `beta`, textos tecnicos ou mensagens confusas visiveis ao usuario.
- `P2-02 VISUAL_CONSISTENCY`: tipografia, espacos, bordas, safe area, densidade e alinhamento entre passageiro e motorista.
- `P2-03 DEV_ARTIFACTS`: remover overlay de performance, atalhos de debug, warnings expostos e menus de desenvolvimento acionaveis por acidente.
- `P2-04 TRANSITIONS_AND_BACKSTACK`: validar animacoes, retorno de tela, overlays transparentes e ausencia de telas orfas.
- `P2-05 LEGACY_ROUTE_HYGIENE`: revisar aliases e rotas antigas ainda registradas para evitar entrada acidental em UI legacy.
- `P2-06 ACCESSIBILITY_BASELINE`: contraste, tamanhos tocaveis, labels legiveis e comportamento com fonte maior.
- `P2-07 MAP_PRESENTATION`: foco de rota, recentralizacao, avatar, sobreposicoes e densidade de controles.
- `P2-08 FORM_FINISHING`: mascaras, teclado, placeholders, validacoes, foco e CTA final em formulários.
- `P2-09 MULTI-DEVICE_LAYOUT`: validar pelo menos um iPhone compacto e um iPhone maior; depois repetir em Android.
- `P2-10 STORE_REVIEW_POLISH`: checar strings, permissoes e estrutura final para Apple/Google.

## Riscos estaticos ja identificados na leitura do codigo
- `RISK-01 ROUTE_SPRAWL`: o `AppNavigator` registra fluxo principal, rotas legacy, aliases antigos e rotas do prototipo ao mesmo tempo. Isso exige auditoria de reachability, porque ha varias entradas para a mesma intencao de tela.
- `RISK-02 DISPATCH_EXPANSION_DUPLICITY`: existe `GradualRadiusExpander` com logica `2.5km -> 5.0km em 8s` e tambem `RadiusExpansionManager` com estrategia `3km -> 5km apos 60s`. Antes de validar negocio, precisamos confirmar qual das duas realmente prevalece em producao.
- `RISK-03 FALSE_UI_CERTAINTY`: a UI ja tem varios estados otimistas; toda tela final precisa ser revisada para garantir que sucesso visual nao antecipe confirmacao do backend.

## Plano de execucao
1. `Fase 0 - Baseline`
Registrar build, branch, backend alvo, usuarios de teste, flags e ambiente.

2. `Fase 1 - Contrato e locks`
Executar leitura de codigo e smoke tecnico para confirmar regras de auth, role, pagamento, booking, dispatch e online/offline.

3. `Fase 2 - Passageiro P0`
Rodar fluxo quote -> pagamento -> booking -> busca -> aceite -> trip -> recibo, incluindo cancelamento e erro.

4. `Fase 3 - Motorista P0`
Rodar fluxo home -> online -> oferta -> aceite -> chegada -> inicio -> conclusao -> ganhos -> volta ao idle.

5. `Fase 4 - Falha e resiliencia`
Simular latencia, reconnect, background, kill/reopen e transicoes durante corrida.

6. `Fase 5 - Navegacao e telas`
Passar tela por tela cobrindo loading, empty, error, success, blocked, back navigation e deeplink.

7. `Fase 6 - Consolidacao`
Classificar cada achado em `P0`, `P1` ou `P2`, anexar evidencia e emitir veredito `GO/NO-GO`.

## Criterio de aceite por fase
- Fase 0: ambiente reproduzivel e sem ambiguidade de backend/flags.
- Fase 1: regras de negocio traduzidas em cenarios testaveis sem conflito semantico.
- Fase 2 e 3: fluxo principal completo sem perda de estado e sem fake success.
- Fase 4: reconnect nao corrompe sessao nem status de corrida.
- Fase 5: nenhuma tela essencial sem comportamento definido para `loading`, `error`, `empty` e `success`.
- Fase 6: relatorio final com blockers, severidade, impacto e recomendacao objetiva.

## Evidencias obrigatorias
- Captura das telas chave por role.
- Registro da versao do app e commit atual.
- Resultado do smoke tecnico usado na rodada.
- Logs de backend/socket apenas para eventos criticos.
- Lista de gaps com reproducoes curtas e deterministicas.

## Saidas oficiais desta auditoria
- `matriz de regras de negocio e locks`
- `matriz de telas e estados`
- `relatorio de execucao`
- `lista de blockers e recomendacoes de hotfix`

## Referencias do codigo
- Navigator principal: `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/navigation/AppNavigator.js`
- Runtime do prototipo: `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js`
- Home compartilhada do prototipo: `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js`
- Slider do motorista: `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/home/DriverHomeOverlay.js`
- Status remoto do motorista: `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/WebSocketManager.js`
- Expansao gradual de raio: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/gradual-radius-expander.js`
- Expansao secundaria de raio: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/services/radius-expansion-manager.js`
