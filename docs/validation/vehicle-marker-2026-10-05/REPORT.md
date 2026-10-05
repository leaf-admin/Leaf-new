# Marcador vetorial do veículo — 05/10/2026

## Objetivo

Refazer o carro do mapa com sombra suave, volume e perspectiva discretos, orientação coerente com a câmera e movimento pelo traçado da rota recebida. A implementação continua em React Native e usa a dependência SVG existente.

## Escopo concluído

- Novo desenho SVG de 42 pt: carroceria com gradientes, vidro, reflexos discretos, rodas, retrovisores, faróis e lanternas. Frente e traseira permanecem distinguíveis na escala do mapa.
- A espessura da carroceria e a direção do brilho respondem à orientação visível: deslocamento de até 1,15 unidades e inclinação de até 2,2°. A sombra usa camadas vetoriais sem filtros ou imagens externas.
- Mantém as cores cadastradas do veículo. O padrão é grafite, sem aplicar o verde da marca à carroceria.
- `LeafVehicleMarker` memoriza o XML. A variação da iluminação usa intervalos de 5°; a rotação do marcador e seu deslocamento continuam suaves, sem essa quantização.
- O desenho compartilhado substitui o SVG plano nos marcadores nativos e nas sobreposições existentes de passageiro, motorista e veículos próximos. Imagens explícitas de campanhas continuam pela configuração anterior.
- Entre atualizações recebidas, a posição interpola a distância ao longo da polilinha em vez de ligar diretamente os dois pontos. A tangente de 3,2 m antes/depois suaviza a orientação nas curvas.
- A orientação dos veículos projetados desconta a rotação da câmera. A transição de heading usa o arco curto ao atravessar 0°/360°.
- Fora da tolerância de rota já existente (42 m), permanece a interpolação da coordenada recebida. Saltos superiores a 3 km mantêm o comportamento de reposicionamento direto. A salvaguarda de distância evita percorrer uma grande alça de rota por associação ambígua.
- A previsão existente entre amostras exige velocidade observada em dois pontos da mesma geometria. Não começa com uma velocidade fictícia ao receber o primeiro ponto, nem continua quando as amostras indicam parada. O limite existente de extrapolação permanece em 4,2 s e 18 m/s.
- Reduzir Movimento agora desliga também interpolação do carro e extrapolação, além do desenho progressivo da rota já existente.

## Arquivos alterados

Código:

1. `mobile-app/src/components/prototype/LeafVehicleMarker.js` — componente SVG compartilhado.
2. `mobile-app/src/components/prototype/leafVehicleArtwork.js` — fonte vetorial e paletas.
3. `mobile-app/src/components/prototype/PrototypeMapLayer.js` — integração, tangente, interpolação e heading.

Validação:

4. `mobile-app/__tests__/leaf-vehicle-artwork.test.js` — desenho, paletas, perspectiva e parser SVG instalado.
5. `mobile-app/__tests__/prototype-map-vehicle-heading.test.js` — curvas, limites, arco curto e parada sem velocidade fictícia.
6. `mobile-app/__tests__/prototype-map-layer-viewport.test.js` — componente compartilhado no marcador nativo, com fonte vetorial.

Documentação: este relatório, `build-review.cjs`, `review.html`, referência estática de mapa e capturas grafite/prata neste diretório; nota de atualização em `ui-parity-release-2026-10-04/RELEASE-STATUS.md`.

## Testes

- Focados: **3 suites / 30 testes PASS**. Incluem 32 variantes de cor/direção aceitas pelo parser de `react-native-svg` instalado.
- Suite completa: **178 suites / 1.478 testes PASS**, 48,3 s. Resultados em `validation-results.json`.
- Guards de produção, governança, segredos rastreados, guard de segredos e `git diff --check`: PASS.

## Evidências

- [Prévia interativa](review.html), com a mesma fonte SVG e funções de geometria extraídas do código por `build-review.cjs`.
- [Grafite](review-graphite.jpg) e [prata](review-silver.jpg): revisão do tamanho real de 42 pt, detalhe ampliado e oito orientações.
- Controles de pausa, reinício e seleção de cor inspecionados no navegador do Codex. O layout foi corrigido para não cortar o painel na largura observada.
- O fundo é a referência estática Google Maps já usada pelo laboratório Swift. As posições são ilustrativas. Essa página não é uma execução React Native, não recebe GPS e não prova uma corrida integrada, renderização nativa ou desempenho físico.

## Riscos e aceitação pendente

- Falta registrar chegada do motorista e viagem no candidato RN com os eventos do booking QA, incluindo curvas, câmera rotacionada, parada, GPS impreciso e Reduzir Movimento em iOS/Android físicos.
- A proximidade da rota e uma tangente curta melhoram a apresentação; não substituem o GPS ou o provedor de navegação e não determinam eventos da corrida.
- O SVG atual usa o mesmo sedan para as categorias que já utilizavam carro. Silhuetas de moto ou classes diferentes não foram introduzidas.
- Este refinamento é JS e **não está nos IPA/APK/AAB congelados anteriormente**. Não houve build, publicação OTA ou envio às lojas nesta rodada. O manifesto de 222 arquivos permanece como registro do candidato anterior, sem reescrever seus hashes.

## Rollback

O commit desta rodada contém somente os arquivos listados e a documentação. Revertê-lo no branch de refinamento restaura o marcador e a interpolação anteriores. Os binários congelados e o branch `codex/leaf-ui-rc-1.0.6` permanecem disponíveis. Na árvore principal, aplicar apenas a reversão desses seis arquivos após verificar que não receberam mudanças posteriores; preservar o índice staged existente.

## Fora do escopo

Regras de viagem, pagamentos, KYC, backend, novas chamadas ao Google, mudanças de dependências, artefatos nativos, produção e publicação. Nenhuma alteração nesses domínios foi necessária.
