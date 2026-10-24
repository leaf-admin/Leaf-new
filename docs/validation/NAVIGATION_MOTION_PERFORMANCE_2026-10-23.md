# Movimento do carro e câmera: implementação e evidência local

## Objetivo

Suavizar o carro visível e estabilizar levemente a câmera, reduzindo trabalho do mapa no JavaScript. Estudo e implementação autorizados na conversa com Izaak em 2026-10-23. A publicação não está autorizada por este documento.


## Situação após o QA desta rodada

**Sem aprovação para liberar.** O componente isolado reduziu CPU no Xiaomi; o app completo ainda teve p95 de 22–23 ms e 17–20% de quadros lentos nas janelas medidas. A única corrida sandbox foi concluída no destino e fechou o financeiro corretamente, mas o embarque exigiu recuperação por um defeito anterior no listener. Candidato iOS e desempenho completo ainda pendentes. Nada foi publicado.

Nesta continuação, mudou somente este documento. Implementação de mapa/câmera permanece no commit `9080cbfd8`. O PR #422 continua draft e depende do PR #421.

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

## Roteiro de QA físico

Estado histórico anterior às coletas abaixo: candidato ainda não instalado. Para a liberação, comparar referência/candidato em build release equivalente, nos mesmos aparelhos, percurso e cadência GPS:

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

Layout e ações dos cards/faixas, restante da interface, backend, socket, GPS transmitido, regras de segurança, Pix/promoção/tarifa/ledger, provedores, gatilhos/corpos/cache de requisições de rota, dependências, infraestrutura, código nativo de produção, builds para distribuição, lojas e publicação de OTA. Nenhum provedor ou nova chamada paga foi adicionado.

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

## Comparação física no Xiaomi — 2026-10-23, noite

Os dois APKs do ensaio foram instalados por atualização, preservando dados e sessão. Ao terminar as coletas, o app completo candidato foi instalado novamente. Nenhum desses APKs recebe OTA; não houve publicação.

Mesmo aparelho, rota local, um fix sintético por segundo, câmera nativa de 800 ms e janelas de aproximadamente 20,3 s após 5 s de aquecimento. Ordem: referência (duas coletas por modo), candidato (duas por modo), referência novamente (uma por modo). A repetição final reduz a dúvida sobre cache/aquecimento, mas não substitui ensaio aleatorizado ou longo. CPU é do processo principal, em percentual de um núcleo; acima de 100% significa uso de mais de um núcleo.

| Modo do componente | Mediana CPU referência, 3 janelas | Mediana CPU candidato, 2 janelas | Redução neste ensaio |
|---|---:|---:|---:|
| Motorista | 157,6% | 111,6% | 29,2% |
| Passageiro | 185,7% | 124,3% | 33,1% |
| Mapa oculto, atualizações continuam | 102,5% | 25,6% | 75,0% |

`gfxinfo` visível: referência motorista p95 10–12 ms, candidato 11–14 ms; referência passageiro 11–14 ms, candidato 13–14 ms. Frames marcados como janky: motorista referência 4–10 de aproximadamente 1.100, candidato 6–18 de aproximadamente 1.125; passageiro referência 4–13 de aproximadamente 1.190, candidato 10–16 de aproximadamente 1.187. Portanto, **CPU caiu, mas não foi demonstrado ganho em tempos de quadro**; algumas janelas do candidato foram piores. O SDK Google possui superfície nativa parcialmente fora dessa medição. No modo oculto há somente cerca de 20 quadros de status por janela; seu p95 não é comparável ao mapa visível.

RSS variou com ordem/cache/coleta de lixo. Faixas observadas: motorista referência 369–432 MiB, candidato 366–422 MiB; passageiro referência 283–433 MiB, candidato 359–410 MiB. Isso não comprova redução de memória, ausência de vazamento, consumo de bateria nem temperatura. Nenhum resultado deste componente isolado representa o custo do app completo.

Duas amostras foram descartadas explicitamente: referência passageiro perdeu foco antes da coleta; segunda coleta inicial do candidato motorista teve mudança de modo antes de observar a conclusão do comando. Ambas foram repetidas. Números acima excluem esses arquivos. JSON consolidado: `navigation-motion-performance/device-preflight/physical-ab-summary.json`; métricas, memória e saída bruta de `gfxinfo` permanecem nos artefatos locais da conversa.

A consulta autorizada dos dois perfis confirmou `qa-test-users-sandbox-durable`, ambiente sandbox, sem indisponibilidade de classificação e sem corrida ativa. A janela QA estava expirada/ausente; foi renovada somente para o UID configurado do motorista, por uma hora, sem mudar configuração ou confiança canônica. Contador inicial QA: 5; operacional: 0. Essa autorização cobre uma corrida e não autoriza publicação.

## Bloqueio encontrado no E2E: chegada rejeitada avança a tela

Na única corrida autorizada desta rodada, a primeira chegada foi tentada a aproximadamente 50 m do ponto. O app usa `PICKUP_TOLERANCE_METERS=80`; no backend publicado `PICKUP_ARRIVAL_TOLERANCE_METERS` não está configurado, portanto vale o padrão de 20 m. A tela passou a aguardar o passageiro, enquanto o Redis permaneceu `ACCEPTED`, sem os campos de chegada. O início foi corretamente rejeitado pelo backend: “A corrida só pode ser iniciada após registrar chegada ao embarque”.

O listener `handleDriverArrived` de `prototypeRideRuntime.js` recebe também o evento `arrivedAtPickup` de erro e não verifica `success === false`/`error` antes de marcar a intenção como reconhecida, iniciar o contador e alterar a etapa para `arrived`. Reprodução isolada do handler extraído do arquivo atual, com efeitos substituídos por mocks, confirmou que `{success:false, code:'PICKUP_TOLERANCE_NOT_REACHED'}` produz `arrived`, ACK e contador. O handler é byte a byte igual ao da referência `a82d60d63`; não foi introduzido pelo diff de movimento/câmera.

Evidência física e reprodução são complementares: capturas/Redis mostram a divergência; o ensaio local mostra o caminho do erro no listener. Os arquivos publicados de controle do motorista e StartTrip têm os mesmos hashes dos arquivos locais; legacy bridge e legacy notifications estão desativados no gateway consultado. Nenhuma configuração foi alterada.

Recuperação: GPS QA colocado no ponto exato e repetida a ação existente `arrived_at_pickup` pelo deep link do Leaf, mantendo a mesma corrida. O servidor persistiu `ARRIVED`, distância de chegada 0 m e `arrivalRegisteredAt`. Só então foi acionado `start_trip`, que persistiu `IN_PROGRESS`. Não houve escrita direta em booking, alteração da tolerância, bypass de pagamento nem segunda solicitação. Esse trecho foi assistido e **não equivale a aprovação do fluxo sem intervenção**. O código de ciclo da corrida fica fora deste PR; o bloqueio precisa de correção e novo QA antes de aprovação de liberação.

## Observações da navegação durante a corrida

- O Leaf foi enviado ao segundo plano pelo botão de navegador; a janela observada durou cerca de dois minutos, ainda antes do embarque. A corrida permaneceu `ACCEPTED`, vinculada ao mesmo motorista, com socket conectado e localização atualizada. A superfície do outro app não foi usada como evidência. Nesse intervalo, uma janela de 20,2 s mediu 5,0% de um núcleo no processo Leaf; não há A/B do app completo e o p95 com zero quadros renderizados não tem interpretação útil.
- O embarque usa checkpoints QA, não uma direção física contínua. A perna da viagem usa os 675 pontos recebidos na própria solicitação, reamostrados a cada 20 m, com um fix por segundo e bearing calculado pela direção do segmento. GPS simulado é sinal QA; nenhum bloqueio de motorista foi introduzido.
- Arraste horizontal no espaço livre do mapa afastou a câmera do carro; após a pausa de 8 s configurada, capturas posteriores mostram o acompanhamento retomado. Sem medição quadro a quadro do instante da retomada.
- Foi pausado apenas o processo local que envia fixes QA, mantendo o provider em mock mode, por aproximadamente 12 s. As regiões do mapa capturadas após 8 e 11 s ficaram idênticas, compatível com previsão visual limitada/parada. O emissor foi retomado em `finally`; nenhum ajuste do telefone foi alterado.
- Uma captura antiga do QA #420 já apresenta o recorte inferior do desenho do carro observado nesta rodada. Não atribuído ao diff de suavização; o bitmap do marcador ainda requer avaliação separada.
- O iPhone permanece no app/OTA anterior, como passageiro operacional de QA. Seu mapa e progressão confirmam recepção do percurso, mas **não validam o novo componente no iOS**.

### Medições do app completo: aprovação de desempenho ainda pendente

Com a corrida `IN_PROGRESS`, SDK real e fixes QA contínuos, três janelas sem captura de tela/UI simultânea mediram:

| Janela de aproximadamente 20 s | CPU do processo, um núcleo | `gfxinfo` p95 | Janky / quadros |
|---|---:|---:|---:|
| Início da viagem | 196,1% | 23 ms | 204 / 1.124 (18,1%) |
| Meio do percurso | 191,9% | 22 ms | 215 / 1.070 (20,1%) |
| Trecho posterior | 184,9% | 22 ms | 184 / 1.077 (17,1%) |

Essas janelas são do **candidato completo** e não possuem referência equivalente do app completo na mesma viagem. Não permitem atribuir a lentidão ao novo marcador nem comprovar regressão, porém impedem declarar “navegação leve/aprovada” com base no ensaio isolado. Precisam de investigação de CPU/frames no conjunto Home/runtime/mapa, sem expandir o diff ou afirmar causa sem perfil de execução.

A contagem de rotas da telemetria foi consultada somente pelo booking QA e retornou zero nas fontes atuais, incluindo um hit de cache no passageiro. O processo Android foi reiniciado durante a recuperação e sua fonte de telemetria passou a ter outro início de contexto; por isso esses zeros **não provam ausência de chamadas pagas em toda a corrida**. Não foram forçados misses nem chamadas adicionais para comprovação. Gatilhos e integração de rota permanecem sem diff nesta tarefa.

Revalidação após as coletas: duas suítes focadas, 66 testes passaram; governança, `git diff --check`, varreduras de segredos e proteção de produção mobile passaram novamente. A suíte completa anterior de 225 suítes/1.811 testes continua sendo a evidência da implementação; não foi repetida sem mudança de código.

Amostra adicional de threads do processo Leaf, cerca de 22,4 s, encontrou CPU em `mqt_v_js` (56,0% de um núcleo), `RenderThread` (34,0%), thread principal (28,8%) e `GL-Map` (27,8%). Threads novas/encerradas ficam fora da comparação. Os nomes e contadores ajudam a orientar o próximo perfil, mas não identificam função causadora nem substituem stacks/profiler. Artefato: `device-preflight/full-app-thread-cpu.json`.

## Resultado financeiro da única corrida sandbox

O percurso recebido nesta solicitação tinha 675 pontos e aproximadamente 14,66 km; terminou após reprodução contínua e parada no destino canônico. A conclusão pelo slider foi registrada `COMPLETED`; a primeira tentativa de gesto não enviou conclusão, e o gesto seguinte dentro do controle concluiu. Houve uma única conclusão efetiva.

- Classificação do backend: `SERVER_DESTINATION_COMPLETION`, `qualified=true`, sem revisão pendente.
- Snapshot final autoritativo e recibo sandbox: passageiro R$ 44,86; motorista líquido R$ 43,37; Leaf R$ 0,99; intermediação Pix R$ 0,50. Pedágio R$ 9,95 explícito, incluído no total e repassado ao motorista.
- Ledger sandbox `ride_settlement`, `posted`, débitos/créditos de 4.486 centavos, `balanced=true`.
- Contador qualificado sandbox: Redis 5 → 6 e estado durável Firestore 6, com o booking desta corrida uma única vez. Estado operacional Redis/Firestore permaneceu 0.
- Índice `active_trip_by_driver` limpo após a conclusão. Passageiro e motorista receberam seus recibos nas sessões dos aparelhos.

Esse resultado valida fechamento e isolamento financeiro da corrida QA, **não uma corrida operacional com Pix real**. O embarque precisou de recuperação assistida conforme descrito acima; o E2E não foi aprovado como fluxo sem intervenção.

Limpeza ao fim: passageiro na Home, motorista colocado offline pela confirmação normal do Leaf, sem corrida ativa. Emissor QA encerrado e serviço mock GPS ausente; localização real voltou a ser recebida. A renovação temporária de QA foi removida com comparação do valor criado por esta rodada, após conferir motorista offline e nenhum vínculo ativo. O APK original guardado teve seu SHA-256 reconferido e foi reinstalado por atualização, sem limpar dados ou desinstalar. Sessões preservadas; nenhuma publicação ou mudança de configuração do host.

Próximos passos antes da liberação: corrigir o tratamento de chegada negativa em tarefa separada, alinhar a informação de proximidade à regra autoritativa existente, investigar frames/CPU do app completo com uma referência equivalente e repetir o E2E sem recuperação assistida. A medição do componente, isoladamente, não remove esses bloqueios.
