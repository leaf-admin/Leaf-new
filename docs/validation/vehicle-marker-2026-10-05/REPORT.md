# Marcador vetorial do veículo — 05/10/2026

Atualização posterior: [cor cadastrada e formatos de campanha](CAMPAIGNS.md), incluindo a abóbora de Halloween, painel e validação do bloco atual. As seções abaixo conservam as evidências das revisões V1/V2.

## Revisão 2 — proporções e detalhe

O usuário rejeitou o primeiro desenho por excesso de informação e aparência distorcida. A versão vigente refaz a carroceria em vista superior simétrica, com 42 unidades de comprimento e 24 de largura no `viewBox` de 64. Elimina o `skewX`, os deslocamentos laterais variáveis, os quatro pneus aparentes, as lanternas vermelhas, as linhas do capô e os múltiplos reflexos. Restam vidro frontal/traseiro, cabine, retrovisores discretos, pintura de baixo contraste e uma sombra única. A iluminação acompanha a orientação; os caminhos e proporções são idênticos em todos os ângulos.

Referências consultadas: [Uber Design — Upgrading Uber’s 3D fleet, 04/03/2019](https://medium.com/uber-design/upgrading-ubers-3d-fleet-4662c3e1081), que descreve o desenho dos marcadores para vista superior em 64×64 px e poucos detalhes; [Uber — car colours, 13/04/2017](https://www.uber.com/au/en/blog/car-colours-arriving-now/), com o marcador no mapa inspecionado no navegador. São referências de desenho publicadas pela empresa, não uma afirmação de equivalência ao asset atual da Uber. O SVG é próprio da Leaf.

Nesta revisão mudaram somente `leafVehicleArtwork.js`, os dois testes de desenho/cor e os arquivos da revisão visual/documentação. O movimento pela rota do bloco anterior continua sendo usado pelo novo desenho. As capturas `review-graphite.jpg`/`review-silver.jpg` preservam o primeiro desenho; as capturas com `v2` mostram o atual.

## Objetivo

Refazer o carro do mapa com sombra suave, volume e perspectiva discretos, orientação coerente com a câmera e movimento pelo traçado da rota recebida. A implementação continua em React Native e usa a dependência SVG existente.

## Escopo concluído

- Novo desenho SVG de 42 pt: silhueta compacta, pintura com gradiente suave, vidro frontal/traseiro e retrovisores discretos. Frente e traseira permanecem distinguíveis na escala do mapa.
- A geometria permanece estável quando muda a orientação. Há apenas uma espessura fixa de 0,65 unidade e uma sombra vetorial. A direção da iluminação muda sem deformar a carroceria; não usa filtros ou imagens externas.
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

- Revisão 2, focados: **3 suites / 30 testes PASS**. Incluem 32 variantes no parser SVG e comparação dos caminhos em 72 orientações para impedir distorção. Resultados em `validation-results-v2.json`.
- Revisão 2, suite completa: **178 suites / 1.478 testes PASS**, 48,0 s. A validação da primeira revisão permanece registrada em `validation-results.json`; a atual está em `validation-results-v2.json`.
- Guards de produção, governança, segredos rastreados, guard de segredos e `git diff --check`: PASS.

## Evidências

- [Prévia interativa](review.html), com a mesma fonte SVG e funções de geometria extraídas do código por `build-review.cjs`.
- Versão atual: [grafite](review-v2-graphite.jpg), [prata](review-v2-silver.jpg) e [detalhe](review-v2-detail.jpg), com tamanho real de 42 pt e oito orientações. Primeira versão: [grafite](review-graphite.jpg) e [prata](review-silver.jpg).
- Controles de pausa, reinício e seleção de cor inspecionados no navegador do Codex. O layout foi corrigido para não cortar o painel na largura observada.
- O fundo é a referência estática Google Maps já usada pelo laboratório Swift. As posições são ilustrativas. Essa página não é uma execução React Native, não recebe GPS e não prova uma corrida integrada, renderização nativa ou desempenho físico.

## Riscos e aceitação pendente

- Falta registrar chegada do motorista e viagem no candidato RN com os eventos do booking QA, incluindo curvas, câmera rotacionada, parada, GPS impreciso e Reduzir Movimento em iOS/Android físicos.
- A proximidade da rota e uma tangente curta melhoram a apresentação; não substituem o GPS ou o provedor de navegação e não determinam eventos da corrida.
- O SVG atual usa o mesmo sedan para as categorias que já utilizavam carro. Silhuetas de moto ou classes diferentes não foram introduzidas.
- Este refinamento é JS e **não está nos IPA/APK/AAB congelados anteriormente**. Não houve build, publicação OTA ou envio às lojas nesta rodada. O manifesto de 222 arquivos permanece como registro do candidato anterior, sem reescrever seus hashes.

## Rollback

Reverter somente o commit da revisão 2 restaura o primeiro desenho e sua prévia; preserva o movimento pela rota implementado na revisão 1 (`26e113bca`). Para desfazer também o movimento e a integração do novo marcador, reverter depois esse primeiro commit. Os binários congelados e `codex/leaf-ui-rc-1.0.6` permanecem disponíveis. Na árvore principal, aplicar somente as reversões do escopo, depois de conferir mudanças posteriores, e preservar o índice staged existente.

## Fora do escopo

Regras de viagem, pagamentos, KYC, backend, novas chamadas ao Google, mudanças de dependências, artefatos nativos, produção e publicação. Nenhuma alteração nesses domínios foi necessária.
