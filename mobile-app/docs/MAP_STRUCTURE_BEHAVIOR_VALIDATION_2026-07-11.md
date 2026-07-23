# Validação — estrutura e comportamento do mapa Robotaxi

## Veredito

**PASS EM DEBUG E RELEASE DE SIMULADOR.** A estrutura atual segue o contrato Robotaxi V2: o mapa
é a camada persistente da tela, enquanto cards e instruções são sobrepostos. A câmera calcula
a área realmente visível acima do card; a rota, os marcadores e o tráfego usam geometria
canônica do runtime.

Esta validação foi reaberta após a constatação visual de zoom distante e cabeçalho redundante.
O padding lateral caiu de 44 para 24 pt, o padding superior dos estados ativos passou a 72 pt,
e a altura máxima do card agora desconta seu afastamento inferior. Nos estados do motorista,
os multiplicadores de câmera foram reduzidos para a rota ocupar a largura útil sem recorte.
A rota completa continua visível e a ilha superior duplicada do passageiro foi removida.

## Contrato verificado

| Item | Resultado | Prova |
| --- | --- | --- |
| Mapa ocupa a tela e não é recriado por cada card | PASS | `PrototypeMapLayer` é a camada única; cards/sheets são overlays das telas de ciclo |
| Card não esconde a rota | PASS DEBUG/RELEASE | viewport considera altura medida, safe area e afastamento inferior; testes direcionados e captura Release passaram |
| Rota usa geometria do runtime | PASS | sem coordenadas canônicas, o runtime não desenha rota sintética como se fosse real |
| Tráfego respeita segmentos reais | PASS | segmentos explícitos são desenhados por cor, não substituídos por uma única linha uniforme |
| Toque manual preserva controle da câmera | PASS | arrasto suspende recentralização temporariamente antes de a câmera voltar ao evento operacional |
| Busca mostra contexto espacial sem falsa rota | PASS | raio e veículos próximos aparecem com baixa intensidade; não há rota antes da confirmação |

## Evidência Debug vigente

`qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/debug-card-redesign/` contém as capturas
atuais de passageiro e motorista. A imagem `passenger-started-compact-iphone17e-current.png`
foi produzida após reinstalar o Debug e reconectar o dev client ao Metro. A captura anterior
do 17e foi rejeitada porque usava uma instalação antiga.

## Evidência Release vigente

`qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/release-card-redesign/` contém a build
autônoma atual. As provas principais são `passenger-started-release.png`,
`driver-started-release-final.png`, `driver-offer-release-final.png` e
`passenger-searching-release.png`. O mapa do motorista foi recapturado após a análise visual:
a rota completa agora ocupa substancialmente mais largura sem entrar sob o card.

## Evidência Release histórica — não usar como aceite atual

1. **Busca de motorista:**
   `qa-artifacts/ui-ux-simulator-2026-07-11/states/release/passenger-searching/iphone-17-pro-map-fixed.png`
   — mapa em tela cheia, raio de busca e sheet inferior; não há rota inventada.
2. **Motorista aceito:**
   `qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/release-real-after-geometry-fix/03-driver-accept-passenger.png`
   — marcador do motorista e do passageiro, ETA no card e mapa persistente.
3. **Passageiro em viagem:**
   `qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/release-real-after-geometry-fix/05-driver-start-passenger.png`
   — rota inteira permanece acima do sheet, com origem, destino e progresso separados entre mapa e card.
4. **Motorista em navegação:**
   `qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/release-real-after-geometry-fix/05-driver-start-driver.png`
   — rota, marcador do veículo, tráfego por segmentos e instrução operacional convivem sem trocar de tela.

## Testes executados nesta validação

```text
__tests__/prototype-map-layer-viewport.test.js
__tests__/prototype-search-map-composition.test.js
__tests__/prototype-ride-screens.test.js

5 suites de mapa, 191 testes PASS
4 suítes focadas pós-ajuste, 189 testes PASS
114 suítes mobile completas, 892 testes PASS
```

## Limites honestos

O simulador confirma estrutura, viewport, composição e transições controladas. Ele não prova
GPS físico, precisão de heading em movimento, performance térmica ou comportamento sob troca
real de rede; esses pontos continuam para a bateria em aparelhos físicos.
