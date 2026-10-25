# Câmera de navegação do motorista com perspectiva

## Objetivo e escopo concluído no código

Pedido adicional de Izaak: visualização de condução parecida com a do Waze, tanto indo buscar (`accepted`) quanto durante a corrida (`started`), mantendo Google Maps e as instruções visuais existentes. Implementação após `75bd63bd5`, que corrigiu o carro cortado e compactou os cards.

- Inclinação fixa de **40°** no acompanhamento do motorista; não varia com ruído de velocidade.
- Direção da rota para cima, usando o heading suavizado já existente.
- Carro em **72% da área útil vertical entre os cards**, alinhado horizontalmente ao centro.
- Enquadramento por padding nativo do Google Maps. O centro geográfico da câmera fica no motorista; foi substituído o deslocamento geográfico calculado para uma câmera plana, que ficaria incorreto com perspectiva e duplicaria o deslocamento.
- Zoom/faixas de velocidade, histerese, atualização de câmera de 800 ms, limiares de deslocamento/heading, pausa por interação manual, suspensão em segundo plano e breve visão geral da rota permanecem. A visão geral não usa o padding de acompanhamento.
- Padding especial restrito ao perfil motorista. Passageiro/preview/espera conservam o caminho existente; o gesto manual de inclinar continua desabilitado. Não inclui Navigation SDK, voz, novos provedores ou chamadas Routes/Places.

O Google documenta que o alvo da câmera corresponde ao centro da região com padding, inclusive para os movimentos programáticos. A área total continua sendo desenhada. [Documentação do Maps SDK](https://developers.google.com/maps/documentation/android-sdk/configure-map#map_padding). A regra de layout implementada usa esse comportamento; ainda exige conferir a apresentação no aparelho inclinado.

## Arquivos alterados

`LeafNativeNavigationEngine.js` (pitch/âncora/cálculo puro de padding), `RobotaxiHomeScreen.js` (segue o alvo com padding e remove compensação plana), `PrototypeMapLayer.js` (prioridade do padding de navegação apenas no motorista). Testes: `leaf-native-navigation-engine`, `driver-online-toggle`, `prototype-map-layer-viewport` e `prototype-reduced-motion`.

## Testes executados e evidência

- **229 suítes / 1.857 testes passaram** na suíte mobile completa; log `/tmp/leaf-driver-perspective-full-tests.log`. Comando `npm --prefix mobile-app run test:unit -- --watchman=false --resolver=<resolver local de QA existente> --runInBand`.
- Testes focados: 150 passaram. Cobrem geometria da âncora com alturas/oclusões diferentes, padding finito em layouts apertados, perspectiva fixa com velocidades distintas, ambas as fases ativas, prioridade do padding no motorista Android/iOS e preservação do preview do passageiro.
- Governança, guards mobile de produção, secret scan rastreado, secret guard backend e diff check passaram.
- **Ainda não há captura física da câmera a 40°.** A imagem em `DRIVER_NAVIGATION_VISIBILITY_2026-10-24.md` foi feita em `75bd63bd5`, com câmera plana: comprova o carrinho/cards anteriores e não deve ser apresentada como evidência desta perspectiva.

## QA pendente, riscos e reversão

Os dois pedidos sandbox do ciclo autorizado anterior já foram concluídos. Nova corrida para validar esta mudança precisa de autorização específica para uso das credenciais/perfis QA, Pix sandbox e até duas rotas/uma busca pelos gatilhos normais, sem forçar misses. Janela temporária somente se necessária e removida ao finalizar. Não há autorização de publicação nesta tarefa.

O volume externo de build está desconectado. Foi preservada uma cópia local do APK atual do Xiaomi; a preparação de JS usa apenas dependências existentes/versões do lockfile em pasta de QA fora do produto. Sem alteração de binário nativo ou dependências do repositório. Nenhum novo APK desta perspectiva foi instalado até a validação autorizada.

Limites: perspectiva pode mudar legibilidade, foreshortening do carro e custo de renderização nativa; não há alegação de ganho de FPS/autonomia. Redimensionamento dos cards precisa ser conferido com a câmera inclinada. O problema de conexão observado no QA anterior não foi alterado. PR deve permanecer sem aprovação visual para publicação até o QA.

Reversão: reverter somente o commit da perspectiva para restaurar câmera plana e a compensação anterior, preservando o commit do carrinho/cards. Fora do escopo: passageiro, banner externo, regras financeiras/KYC, backend/socket, frequência de provedores, deploy, OTA, Sentry e lojas.
