# Movimento do carro e câmera: implementação e evidência local

## Objetivo

Suavizar o carro visível e estabilizar levemente a câmera, reduzindo trabalho do mapa no JavaScript. Estudo e implementação autorizados na conversa com Izaak em 2026-10-23. A publicação não está autorizada por este documento.

## Escopo concluído

- O carro nativo passa a possuir seu próprio estado visual, no Android e no iOS. O carro do próprio motorista no Android também recebe a interpolação, em vez do GPS direto.
- Uma única sequência de `requestAnimationFrame` por carro substitui as duas sequências anteriores. Publicação de poses limitada a intervalos de 32 ms, aproximadamente 30 por segundo, sem renderizar MapLayer/rota por quadro.
- Interpolação de posição linear no tempo para evitar desaceleração a cada fix; duração ajustada ao intervalo recebido, de 350 a 850 ms. Rotação segue o arco mais curto e a geometria recebida, sem cortar curvas pela diagonal.
- Preservados encaixe na rota até 42 m, salto direto acima de 3 km e previsão limitada a 18 m/s por até 4,2 s após a interpolação. A previsão permanece estritamente visual; não altera GPS operacional nem critérios de chegada/início/conclusão.
- A animação do carro pausa com o app inativo e com a tela sem foco. Retorno usa o último fix, sem animar o percurso acumulado enquanto o mapa estava escondido. O acompanhamento da câmera do motorista também respeita app ativo e foco da tela.
- Carros nativos dispensam `getCamera`/`pointForCoordinate` para overlays não utilizados. Atualização da região em cada quadro permanece apenas onde há overlays de endpoints, busca ou caminhos legados que a consomem.
- Câmera mantém vista de cima, teto de zoom 15,8, carro a 74% da janela entre os cartões, intervalo mínimo de 800 ms e pausa após gesto manual. Margem de 3 km/h nas faixas de velocidade evita alternância de zoom junto a 25/50/80 km/h. Enquadramento explícito de chegada prevalece.
- O desenho do carro recebe o mesmo rumo filtrado enviado ao comando da câmera. Isso não significa sincronismo de cada quadro da animação nativa da câmera.
- Breadcrumb normal de acompanhamento da câmera é amostrado a cada 5 s; eventos de etapa/erro permanecem como estavam.

## Arquivos alterados

| Arquivo | Responsabilidade |
|---|---|
| `mobile-app/src/components/prototype/PrototypeMapLayer.js` | Estado/animação isolados no marcador, pausa visual e consultas locais condicionadas ao uso. |
| `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js` | Visibilidade, câmera, rumo filtrado e amostragem de debug. |
| `mobile-app/src/screens/prototype/RobotaxiTripScreen.js` | Informa foco da tela ao mapa do passageiro. |
| `mobile-app/src/services/LeafNativeNavigationEngine.js` | Função de estabilidade das faixas de zoom. |
| `mobile-app/__tests__/prototype-map-layer-viewport.test.js` | Movimento visível, isolamento da rota, curvas, retomada, interrupção, previsão e chamadas SDK. |
| `mobile-app/__tests__/leaf-native-navigation-engine.test.js` | Histerese de zoom, desaceleração e chegada. |
| Este documento | Evidência, limites de medição e QA restante. |

## Evidência de desempenho — teste com mocks

Referência anterior: `a82d60d63f811493e08d07df8438d7b1e47becfc`, que contém os cards do PR #421. O diff desta tarefa usa essa referência como base; os cards não são redesenhados aqui.

Mesmo cenário sintético: rota de três pontos, atualização de aproximadamente 22 m após 1,7 s, 54 avanços de relógio de 17 ms, totalizando 918 ms. Views nativas e SDK substituídos por mocks; o Profiler conta commits React incluindo filhos. As 29 linhas incluem vagas fixas de trânsito/cometa.

| Medida | Antes | Depois |
|---|---:|---:|
| Chamadas de renderização de Polyline por atualização, carro visível | 1.479 | 29 |
| Passagens pelas 29 linhas | 51 | 1 |
| Commits React no cenário visível | 101 | 29 |
| Commits React no cenário oculto/inativo | 101 | 1 |
| `getCamera` em 30 eventos de região, sem overlays que dependam da região | 30 | 0 |
| `pointForCoordinate`, carros nativos | 0 | 0 |

As 29 chamadas restantes são da atualização inicial de props do GPS; os quadros intermediários do carro acrescentam **zero** chamadas de Polyline. Redução de aproximadamente 98% nessa contagem específica. Não é uma redução comprovada de 98% no consumo do aplicativo.

Diferenças explícitas do ensaio: a referência anterior desabilitava previsão em `NODE_ENV=test`; a versão nova testa também a previsão usada em produção. O caso oculto agora informa `motionEnabled=false`, como fazem as telas reais ao perder foco; antes havia apenas `display:none`. No fim da janela de 918 ms o carro visível pode estar alguns centímetros à frente do fix pela previsão, que tem teste separado de limite e término.

Harness e JSON completos ficam nos artefatos locais da conversa, em `navigation-performance-study` (referência) e `navigation-motion-performance` (candidato). O teste versionado também verifica diretamente ausência de renderizações de Polyline durante os quadros, sem depender dos números do Profiler.

Essas medidas comprovam trabalho React evitado. Não medem FPS, GPU, bateria, temperatura nem tempo de execução no telefone. A amostra anterior de Xiaomi parado não é baseline de navegação em movimento. Nenhuma chamada paga foi necessária para estes testes.

## Validação

- Quatro suítes focadas: 76 testes passaram, incluindo curva em ângulo reto sem diagonal, troca do alvo durante animação, arco 350° → 10°, cancelamento no unmount, pausa/retorno e fim da previsão sem novos frames.
- Harness externo de comparação: cinco cenários passaram.
- Transformação Babel dos quatro arquivos de implementação: passou.
- `git diff --check`, governança, varredura de segredos, proteção de segredos hardcoded e `qa:production-guards`: passaram.
- Suíte mobile completa: 225 suítes e 1.811 testes passaram na versão final.

Comandos: `npm --prefix mobile-app run test:unit -- --watchman=false --resolver=<resolver-local>` e a mesma entrada com `--runTestsByPath` para os quatro arquivos de testes de mapa, heading, engine e rota do passageiro. O resolver local já existente fixa uma instância de React/React Native neste checkout com dependências compartilhadas; não altera produção nem lógica testada. O harness externo usa `--projects=<diretório-do-harness>` pela mesma entrada npm.

## QA físico pendente

Não foi instalado candidato, executado E2E desta versão ou publicado update. Antes da liberação, comparar referência/candidato em build release equivalente, nos mesmos aparelhos, percurso e cadência GPS:

1. Parado e em baixa velocidade: ruído de localização/rumo, sem oscilar câmera/zoom.
2. Percurso com curvas e frenagem: carro acompanha a rua, rota legível entre os cards, sem atraso acumulado nem alteração do controle manual da câmera.
3. Falta de fix por mais de 5 s e retomada: previsão para; novo fix corrige a pose sem continuar animação antiga.
4. Waze em primeiro plano e retorno; Home escondida sob a viagem do passageiro: pausa visual sem interferir com GPS, socket ou etapa operacional.
5. Corrida sandbox completa nos dois celulares, verificando ambas as pernas e chegada. Não usar mocks como evidência de SDK nativo/produção.

Coletar janela controlada de frames lentos/p95, CPU e memória antes/depois, além de observar aquecimento e bateria em janela mais longa. Registrar quantidade de requisições de rota separadamente. Só essas medições permitem aceitar o desempenho real e a fluidez da frequência visual escolhida.

## Riscos e rollback

Riscos restantes: aproximadamente 30 poses/s podem ter percepção diferente em cada aparelho; previsão visual pode antecipar uma parada entre fixes; câmera e marcador usam animações independentes; comportamento de bitmap/rotação e retorno do Waze precisam de SDK real. O zoom tem pequena margem intencional nas mudanças de faixa.

Rollback: reverter exclusivamente o commit desta tarefa e, somente com autorização específica, republicar a versão anterior. Sem migração, limpeza de cache, alteração de dados ou consulta de rota para reverter. O PR dos cards permanece separado.

## Fora do escopo e intocado

Layout e ações dos cards/faixas, restante da interface, backend, socket, GPS transmitido, regras de segurança, Pix/promoção/tarifa/ledger, provedores, gatilhos/corpos/cache de requisições de rota, dependências, infraestrutura, build nativo, lojas e publicação de OTA. Nenhum provedor ou nova chamada paga foi adicionado.

## Preparação do QA físico — continuação de 2026-10-23

- Xiaomi USB `irsgaiscr4j7cenv` e iPhone passageiro detectados. Leaf foi trazido à frente; motorista offline e passageiro na Home foram observados nas sessões existentes. A automação HTTP do iPhone foi restabelecida.
- APK original Android 1.0.11 (144) copiado para os artefatos locais. Assinatura verificada: certificado Android Debug de QA; não foi necessário usar assinatura de produção. O ID da OTA que executava não foi estabelecido.
- Gerado APK completo do candidato `9080cbfd8af8fd8240246c6cdec23358bad4817d`: release, arm64, mesma assinatura do instalado, `expo.modules.updates.ENABLED=false`, check `NEVER`. Nenhum upload automático de source maps, build remoto ou publicação foi realizado.
- Build usa cópia isolada do commit e projeto nativo completo de 1.0.11. Os templates nativos dos cards correspondem ao PR #421. Source map do bundle confirma conteúdo exato dos quatro arquivos de implementação desta tarefa.
- Dois problemas de ambiente foram corrigidos somente na cópia de QA: checkout sem dependência Sentry e resolução Metro das dependências compartilhadas. Usada a árvore completa já existente de 1.0.11 e explicitados os caminhos reais de observação/resolução. Nenhum pacote foi instalado e nenhum código do produto foi alterado nesta continuação.
- Ensaio local `PerformanceMap.js`, fora do Git, monta MapLayer/SDK Google reais com a rota de 655 pontos registrada no QA anterior e fixes sintéticos a cada 1 s. Tem modos motorista, passageiro e mapa oculto; câmera recebe comandos de 800 ms. Não monta runtime financeiro nem solicita novas rotas. Seus resultados devem ser identificados como medição do componente com GPS reproduzido, sem extrapolar para navegação operacional ou consumo do app inteiro.
- Os três APKs locais concluíram o build: app completo candidato, ensaio candidato e ensaio de referência. As 43 entradas DEX/bibliotecas nativas dos dois ensaios são idênticas; muda o componente MapLayer em JavaScript. Assinaturas dos três APKs coincidem com a cópia original de QA.
- Coletor de CPU do processo Leaf, RSS e `gfxinfo` preparado; `CLK_TCK=100` confirmado no aparelho. Smoke de cinco segundos validou a leitura, sem produzir baseline de navegação. O ring buffer de frames e a cobertura parcial da superfície Google estão documentados no coletor.
- O Xiaomi bloqueou durante o build. Desbloqueio foi solicitado a Izaak. Até esse ponto, **nenhum candidato foi instalado e nenhuma medição A/B em movimento ou nova corrida sandbox foi executada**. Não houve limpeza de dados, desinstalação, senha/OTP, mudança de configuração do telefone nem ativação de mock GPS.

Artefatos de build ficam em `/Volumes/LEAF_PILOT_BUILD/navigation-motion-422/`; evidência e roteiro, em `navigation-motion-performance/device-preflight` nos arquivos locais desta conversa. APK original guardado permite retorno por instalação de atualização, preservando dados, após conferir novamente assinatura e estado sem corrida ativa. Publicação/OTA e uso de credencial administrativa para a rodada sandbox continuam sujeitos à autorização aplicável.
