# Banner Essencial — orientação visual

## Objetivo e escopo concluído

Aplicar a variante Essencial escolhida por Izaak ao banner do motorista, usando o Google como mapa e provedor da rota, com orientação apenas visual e acesso ao navegador externo já existente.

- Superfície branca opaca, Figtree, verde Leaf, distância em destaque, instrução, resumo e ação “Abrir navegador”. Sem captura de fundo ou novo efeito de vidro no banner.
- A Routes API passa a devolver manobras básicas na mesma requisição; campos explícitos, sem polyline duplicada por etapa. Corpo da consulta, SKU acionado, cache, retries e gatilhos de requisição permanecem iguais.
- O contrato de etapas normaliza Routes API e Directions Legacy, preservando o tipo de manobra e as duas pernas já existentes.
- Planos sem etapas reais ficam no resumo; curvas inferidas não são usadas por padrão. Não foi removido o gerador legado, que ficou restrito à opção explícita `allowSyntheticSteps` e não é ativada pelo runtime.
- Voz desativada na superfície da corrida, mesmo que uma preferência antiga estivesse ligada. O navegador externo continua disponível.
- A altura medida do banner determina a área reservada no mapa. A câmera reconsidera o enquadramento se essa área mudar, inclusive com o carro parado.

## Layout e estrutura da tela

1. Manter controles superiores existentes; banner começa em `safeArea.top + 70`.
2. Banner com largura de 92%, teto de 480 pontos, cantos de 24 pontos e alvos de toque de pelo menos 44 pontos.
3. Cartão operacional permanece na parte inferior. O espaço entre ele e o banner é a janela útil do mapa.
4. Preservar o mapa visto de cima e o carro a 74% da altura dessa janela, deixando mais espaço à frente. Preservar o zoom já ajustado no projeto (teto 15,8) e o controle de movimento/retomada existente.
5. Troca de instrução não consulta provedores. Abrir o navegador usa o fluxo atual. Desvio segue a proteção existente que oculta instruções fora da rota; o cartão operacional continua oferecendo navegação externa.

## Arquivos alterados

| Arquivo | Responsabilidade |
|---|---|
| `mobile-app/src/screens/prototype/home/LeafNativeNavigationBanner.js` | Layout Essencial, ícone por enum do provedor, altura real e ações. |
| `mobile-app/src/services/LeafNativeNavigationEngine.js` | Preserva enum e usa etapas reais por padrão. |
| `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js` | Superfície visual sem voz; câmera reage ao redimensionamento dos cartões. |
| `leaf-websocket-backend/services/places-cache-service.js` | Solicita e normaliza etapas na resposta existente, sem nova consulta. |
| Três arquivos de testes de banner, motor e serviço de directions | Regressão de layout, etapas, cache e quantidade de chamadas. |
| Este documento | Evidência e critérios restantes. |

## Testes executados

- `git diff --check`: passou.
- `npm run governance:check`: passou.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: passou.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: passou.
- `npm --prefix mobile-app run qa:production-guards`: passou.
- Transformação Babel dos três arquivos mobile de implementação: passou.
- Backend: `ENV_FILE=/dev/null TEST_PROFILE_SHOWN=1 npm --prefix leaf-websocket-backend run test:unit -- --runInBand --coverage=false --runTestsByPath tests/unit/services/places-cache-service.directions-steps.unit.test.js`: 16 testes passaram.
- Mobile: `ENV_FILE=/dev/null TEST_PROFILE_SHOWN=1 npm --prefix mobile-app run test:unit -- --resolver=<resolver-local> --watchman=false --runTestsByPath __tests__/leaf-native-navigation-engine.test.js __tests__/leaf-native-navigation-banner.test.js __tests__/driver-navigation-preference.test.js __tests__/prototype-route-viewport.test.js __tests__/active-route-viewport-contract.test.js __tests__/prototype-map-layer-viewport.test.js __tests__/google-api-functions.test.js`: 7 suítes, 125 testes passaram.

O resolver local já existia no trabalho anterior desta conversa e fixa uma única instância de React/React Native/react-test-renderer neste checkout. Sem ele, a resolução de dependências aninhadas falha antes dos testes com `__fbBatchedBridgeConfig is not set`. Ele não foi introduzido no código de produção nem alterado para fazer estes testes passarem.

`ENV_FILE=/dev/null npm --prefix leaf-websocket-backend run config:validate` não passou: faltam `NODE_ENV`, `WOOVI_ENVIRONMENT`, `WOOVI_BASE_URL` e `WOOVI_API_TOKEN` no ambiente deliberadamente vazio. Nenhuma configuração ou credencial de produção foi carregada. A validação do ambiente de publicação continua pendente.

## Evidência local

O teste do backend verifica que etapas das duas pernas e informações de trânsito vêm de **um único fetch** para `computeRoutes`, preservando `TRAFFIC_AWARE_OPTIMAL` e `TRAFFIC_ON_POLYLINE`, sem pedir polylines por etapa. Os testes de cache seguem passando sem fetch adicional. São respostas simuladas, não uma consulta paga ao Google.

Uma prévia local renderizou o componente React Native alterado via React Native Web, com Figtree e os ícones existentes. O mapa de fundo é uma captura de QA anterior e o cartão inferior/posição do carro são representações de teste, não a câmera Google nativa.

- 32 combinações: larguras 320/360/390/430, alturas 640/844, estados de curva, instrução longa, resumo e chegada.
- Nenhuma sobreposição entre banner e área inferior reservada, saída lateral ou alvo de toque abaixo de 44 pontos.
- Nenhuma exceção JavaScript ou requisição externa; ação de navegador e ocultação responderam.
- A posição calculada do carro permaneceu dentro da janela simulada. Isso não comprova o comportamento nativo de projeção ou animação.

Artefatos locais da conversa: diretório `essential-banner-qa` em `/Users/izaakdias/.codex/visualizations/2026/10/22/01a16498-a3ec-7093-bfae-c4c373c52628/`, contendo `layout-report.json`, `banner-essential.png` e a prévia reproduzível. Não fazem parte do aplicativo.

## QA físico pendente e publicação

Android QA e iPhone foram detectados conectados; não receberam esta alteração. Não se deve apresentar a prévia local como QA nos aparelhos.

Antes de liberar, validar no ambiente autorizado:

- Embarque e destino: carro, próxima curva e linha visíveis entre os cartões; sem saltos de zoom na chegada.
- Instrução longa e fontes ampliadas: leitura, alvos de toque e altura informada à câmera.
- Carro parado enquanto o banner muda de altura; ocultar banner e continuar seguindo o carro.
- Waze/Google Maps e retorno à Leaf: mesma corrida, socket, plano e câmera; nenhuma consulta causada pelo banner.
- Ausência de etapas e saída do trajeto: nenhuma curva inferida ou consulta de recuperação criada pela funcionalidade.
- Mesmos gatilhos e contagem de requisições; registrar bytes do payload/cache e custo estimado, sem confundir a estimativa interna com a fatura.
- Corrida sandbox completa, início e conclusão, sem alterar Pix, tarifa, pedágio ou ledger.

Este PR não autoriza publicação. Backend e OTA precisam de aprovação específica de Izaak. Não há mudança nativa prevista; nenhum build ou envio às lojas foi realizado. A adequação contratual da orientação visual com conteúdo Google também deve ser confirmada antes da liberação; a presença dos campos na API não substitui essa confirmação.

## Riscos e rollback

Riscos restantes: QA físico não executado; payload maior por conter etapas, sem novas operações; precisão das manobras em GPS urbano e do avanço de etapas; enquadramento em fontes ampliadas; cache antigo sem etapas funcionando em modo de resumo; ambiente real e termos do provedor ainda não validados para publicação.

Rollback: reverter os commits deste PR e republicar somente nos ambientes previamente autorizados. Não requer migração nem exclusão de dados. Não invalidar caches nem consultar rotas novamente apenas para reverter o banner.

Fora do escopo e intocados: provedores e frequência de consulta, parâmetros pagos, preços estimados da telemetria, mapa Google, regras de tarifa/Pix/pedágio/promoção, lifecycle e socket, serviços OSM, novos serviços/dependências, bancos, native builds e lojas.
