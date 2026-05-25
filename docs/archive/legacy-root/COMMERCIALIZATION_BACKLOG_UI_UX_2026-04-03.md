# Backlog Comercializavel de UI, UX e Comportamento

Data: 2026-04-03
Status: backlog priorizado para execucao apos fechamento completo da Wave 4
Escopo: app unico de mobilidade com roles passageiro e motorista

## Objetivo
Aproximar o comportamento do produto dos modelos ja validados por Uber, Lyft e 99 nos pontos de operacao, leitura de estado, continuidade visual e previsibilidade do lifecycle, preservando as regras de negocio proprias da Leaf.

## Principios de Produto
1. O mapa e a superficie base. Cards e overlays existem para orientar decisao e operacao, nao para substituir o mapa.
2. O usuario deve sempre entender em menos de 1 segundo:
   - qual e o estado atual
   - qual e a proxima acao
   - quanto falta em distancia e tempo
   - qual e o valor financeiro relevante para ele
3. Um mesmo campo nao troca de significado durante a mesma corrida.
4. O card reduzido e o estado padrao. O card expandido abre sob demanda.
5. Banners operacionais devem ser discretos, debounced e sem spam.
6. O frontend pilota navegacao e UX, mas o backend precisa entregar payload consistente, idempotente e semanticamente estavel.

## Benchmark Oficial Considerado
1. Uber Driver
   - apos aceitar uma viagem, o fluxo principal passa por 3 estagios: navegar ate o passageiro, iniciar a viagem e encerrar a viagem
   - requests exibem informacao chave antes do aceite
   - o app suporta navegacao externa sem perder o contexto operacional da corrida
   - fonte: https://www.uber.com/us/en/drive/driver-app/

2. Lyft Passageiro
   - apos o match, o passageiro ve nome do motorista, descricao do veiculo e ETA
   - a tela de corrida mantem foco em chegada do motorista e informacao pratica de contato
   - fonte: https://help.lyft.com/hc/en-us/articles/213584088-How-to-get-picked-up-as-a-passenger

3. 99 Motorista
   - tela principal centrada em mapa, botao de online, menu, notificacoes
   - ao receber solicitacao, o motorista ve nome do passageiro, ponto de partida e valor estimado
   - ao chegar, o app orienta iniciar a corrida
   - fonte: https://99app.com/motorista/guias/guia-motorista-parceiro/

4. 99 Ganhos
   - o valor mostrado antes do aceite deve ser claro e coerente com o que o motorista recebe ao final, salvo cenarios explicitamente recalculados
   - o recibo deve simplificar o entendimento do ganho
   - fontes:
     - https://motoristas.99app.com/clareza-nos-ganhos/
     - https://motoristas.99app.com/seusganhosimportam/

## Diagnostico Atual
O produto ja avancou em menu, lifecycle ideal, snapshot financeiro e parte da recuperacao de estado, mas ainda se afasta dos modelos validados em pontos centrais:
- cards extensos demais em momentos que deveriam priorizar o mapa
- semantica instavel de campos como ETA, distancia e pagamento
- avatar do motorista ainda inconsistente
- banners de conexao ruidosos
- falta de playback de rota para simular deslocamento real no prototype
- estados transitorios de corrida pouco claros
- enquadramento de camera ainda inconsistente nos estados aceito, a caminho e em viagem

## Backlog Prioritario

### P0.1 Motorista - Card reduzido para "Dirija ate o local de embarque"
Estado alvo:
- titulo: `Dirija ate o local de embarque de {nome do passageiro}`
- card reduzido sempre visivel no rodape
- dados reduzidos:
  - ETA ate embarque
  - distancia ate embarque
  - valor liquido
- toque no card expande para detalhes completos
- mapa continua totalmente visivel atras

Frontend:
- ajustar [DriverLiveRideOverlay.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js)
- ajustar [RobotaxiDriverTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js)
- revisar [RobotaxiHomeScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js)
- manter avatar, rota e botoes de mapa sobre o `MapView`

Backend:
- garantir payload estavel com:
  - `passengerName`
  - `pickupEtaSeconds`
  - `pickupDistanceMeters`
  - `driverNetAmount`
- nao trocar semantica dos campos durante a corrida

Aceite:
- o card nunca vira um bloco grande por default
- ETA e distancia nao trocam de nome
- valor liquido permanece o mesmo do aceite

### P0.2 Motorista - Card reduzido para "Viagem em andamento"
Estado alvo:
- titulo: `Viagem em andamento`
- card reduzido com:
  - distancia restante
  - ETA restante
  - valor liquido
  - botao `Encerrar corrida`
  - botao `Reportar problema`
- ao tocar, expande para card completo

Mudanca nominal:
- `Interromper por motivo operacional` -> `Reportar problema`

Frontend:
- mesma familia de arquivos do item anterior
- revisar [RobotaxiTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiTripScreen.js)

Backend:
- diferenciar claramente:
  - `remainingDistanceMeters`
  - `remainingEtaSeconds`
  - `driverNetAmountLocked`
  - `problemReportAllowed`

Aceite:
- mapa domina a tela
- card reduzido nao cobre a rota
- acao primaria sempre clara

### P0.3 Motorista - Cards transitorios operacionais
Precisamos de 2 estados transitorios dedicados:
1. `Passageiro cancelou a corrida`
- somente quando a corrida some antes do aceite do motorista
- auto-dismiss curto
- volta para mapa se nao houver outra offer

2. `Outro motorista aceitou a solicitacao`
- somente em corrida concorrida quando havia disputa ativa de aceite
- se o motorista nao tocou e outro aceitou, nao precisa card: a offer apenas some
- se ele tocou e perdeu a disputa, mostrar esse card curto

Frontend:
- novo componente de feedback transitorio dentro da camada do motorista
- integrar com dismiss automatico e fila de eventos

Backend:
- diferenciar razoes de encerramento da offer:
  - `rider_cancelled_before_accept`
  - `accepted_by_other_driver_competitive`
  - `offer_expired`
- hoje esses motivos nao estao surfacando com granularidade suficiente

Aceite:
- nada de card fantasma piscando
- nada de mapa se mexendo sem um novo estado real

### P0.4 Playback real de deslocamento no prototype
Pergunta respondida: por que ainda nao estamos mockando coordenadas?
- hoje o prototype mocka melhor os estados do lifecycle do que o deslocamento continuo
- existe sincronizacao de status, mas nao um `route playback engine` deterministico pilotando o carro do ponto A ao ponto B
- isso deixa o app sem a fidelidade visual minima de um produto comercializavel

O que deve entrar:
- um `mockRoutePlaybackService` unico para corrida prototype
- ele recebe:
  - polyline
  - velocidade base
  - multiplicador QA
  - intervalo de tick
- ele emite coordenadas progressivas para:
  - motorista em direcao ao pickup
  - motorista durante a viagem
- passageiro e motorista devem observar a mesma trilha

Frontend:
- [PrototypeMapLayer.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/prototype/PrototypeMapLayer.js)
- [prototypeRideRuntime.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js)
- [RobotaxiHomeScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js)

Backend:
- para prototype nao precisa servidor pilotando frame a frame
- mas o contrato do socket precisa aceitar localizacoes progressivas sem reclassificar estado incorretamente
- idealmente manter um `source: playback_mock`

Aceite:
- ambos veem a mesma rota sendo percorrida
- ETA e distancia caem com coerencia
- sem teleporte do marcador

### P0.5 Avatar do motorista e botoes do mapa
Problemas atuais:
- avatar ausente em parte dos estados
- botao sanduiche e botao de centralizar vazios

Frontend:
- revisar [PrototypeMapLayer.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/components/prototype/PrototypeMapLayer.js)
- revisar asset/fallback do avatar
- revisar icones em [RobotaxiHomeScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js)
- garantir fallback visual, nunca `empty circle`

Aceite:
- nenhum botao circular pode ficar vazio
- avatar do motorista visivel em home, a caminho e em viagem

### P0.6 Banner de conexao com debounce real
Regra nova:
- amostrar estado de rede/socket a cada 10s
- so atualizar visual apos 10s consistentes do novo estado
- depois de mostrar um banner, segurar 10s antes de nova mudanca visual

Objetivo:
- impedir spam do banner em microintercorrencias

Frontend:
- revisar [prototypeConnectionStatus.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeConnectionStatus.js)
- revisar [RobotaxiHomeScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js)

Backend:
- sem mudanca obrigatoria
- mas vale padronizar evento de reconnect com timestamp para debug

Aceite:
- banner nao pisca em cascata
- usuario consegue ler o estado

### P0.7 Passageiro - Card apos aceite do motorista
Conteudo esperado:
- nome do motorista
- marca e modelo do veiculo
- placa
- tempo estimado para chegar ao embarque
- botao `Cancelar`

Benchmark:
- isso esta alinhado com o padrao basico observado no Lyft e no mercado em geral: nome do motorista, veiculo e ETA sao dados nucleares apos o match

Frontend:
- revisar [RobotaxiTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiTripScreen.js)
- revisar [prototypeRideRuntime.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/prototypeRideRuntime.js) para garantir modelo/placa

Backend:
- garantir payload com:
  - `driverName`
  - `vehicleMake`
  - `vehicleModel`
  - `vehiclePlate`
  - `pickupEtaSeconds`

Aceite:
- passageiro identifica o parceiro em um relance

### P0.8 Passageiro - Corrida em andamento com card reduzido
Estado alvo:
- titulo: `A caminho de {destino}`
- subtitulo: nome do motorista + modelo do veiculo
- dados:
  - tempo estimado de chegada
  - distancia estimada
- mapa com rota visivel e deslocamento em tempo real
- sem zoom in absurdo no avatar do usuario

Frontend:
- revisar camera em [RobotaxiHomeScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiHomeScreen.js)
- revisar [RobotaxiTripScreen.js](/Users/izaakdias/Documents/Leaf-new/mobile-app/src/screens/prototype/RobotaxiTripScreen.js)
- garantir viewport por rota, nao por marcador individual

Aceite:
- comportamento equivalente ao lado do motorista
- rota sempre visivel

### P0.9 Semantica estavel de cards do motorista
Problema atual:
- `Restante`, `ETA`, `Distancia`, `Pagamento` trocam de papel ao longo do fluxo
- isso e cognitivamente errado

Regra:
- Card 1: `Distancia`
- Card 2: `Tempo`
- Card 3: `Valor liquido`
- nomes e posicoes fixos do aceite ao fim da corrida

Frontend:
- revisar modelos do card do motorista
- remover qualquer logica que reaproveita o mesmo slot para significados diferentes

Backend:
- payload nomeado, nao generico
- evitar campos ambivalentes como `etaLabel` ou `valueLabel` quando o consumidor precisa de semantica fixa

### P0.10 Texto do card do motorista
Problema:
- `Com Leaf motorista teste` no card do motorista nao faz sentido

Regra:
- motorista ve nome do passageiro
- passageiro ve nome do motorista

Frontend:
- revisar labels de offer e corrida ativa no lado do motorista

Backend:
- garantir `passengerName` em todas as fases relevantes

## Backlog Secundario Mas Importante

### P1.1 Menus e submenus restantes
- o menu principal ja ficou no padrao certo
- todos os submenus devem seguir exatamente essa linguagem
- nenhum CTA de fechamento escondido no rodape
- fechar sempre pelo canto superior direito

### P1.2 Camera e zoom em todos os estados
Auditar:
- home passageiro
- quote
- searching
- accepted
- started
- home motorista
- offer
- pickup
- started
- relaunch

Regra:
- toda mudanca de camera precisa de motivo de negocio
- nada de zoom in ou zoom out ornamental

### P1.3 Clareza financeira em toda a jornada
- motorista deve ver liquido estavel
- passageiro deve ver bruto/pago
- recibo deve explicar bruto, taxa e liquido sem contradicao
- ganhos e historico devem refletir os mesmos dados da home

## Contratos de Backend que Precisam Ser Endurecidos
1. Offer e active ride devem sair do backend com payload completo e semantica fixa:
   - `pickupEtaSeconds`
   - `pickupDistanceMeters`
   - `remainingEtaSeconds`
   - `remainingDistanceMeters`
   - `driverNetAmountLocked`
   - `grossAmountLocked`
   - `passengerName`
   - `driverName`
   - `vehicleMake`
   - `vehicleModel`
   - `vehiclePlate`
   - `offerTerminationReason`

2. Eventos transitorios precisam vir com motivo explicito:
   - cancelado pelo passageiro
   - aceito por outro motorista
   - expirado
   - problema operacional

3. Route playback do prototype precisa de camada unica e rastreavel
   - mesma trilha para os dois lados
   - timestamp por tick
   - possibilidade de acelerar em QA

## Ordem Recomendada de Execucao
1. Fechar Wave 4 completa
2. P0.6 banner de conexao com debounce de 10s
3. P0.4 route playback mock
4. P0.5 avatar e botoes do mapa
5. P0.1 e P0.2 card reduzido do motorista
6. P0.7 e P0.8 card reduzido do passageiro
7. P0.3 cards transitorios operacionais
8. P0.9 e P0.10 semantica e copy do motorista
9. P1.2 auditoria total de camera e zoom
10. P1.1 e P1.3 acabamento de menus e financeiro

## Criterio de Versao Comercializavel
Uma versao so pode ser tratada como comercializavel quando:
- o lifecycle real e o exceptional lifecycle estiverem verdes
- motorista e passageiro tiverem rota visivel e coerente durante a operacao
- cards forem compactos, semanticos e estaveis
- banner de conexao nao spammar
- nenhum botao ou avatar ficar vazio
- liquido, bruto e recibo baterem entre todas as superficies
- os estados transitorios de cancelamento e disputa de aceite estiverem claros

## Observacao Final
A direcao correta aqui nao e reinventar o app de mobilidade. E pegar os comportamentos operacionais que o mercado ja provou serem bons e trazer a Leaf para esse patamar de legibilidade, confianca e continuidade, preservando apenas as regras de negocio que sao nossas.
