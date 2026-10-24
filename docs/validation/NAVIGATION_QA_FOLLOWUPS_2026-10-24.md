# QA da navegação: chegada, progresso e desempenho

## Objetivo e escopo concluído

Continuação do PR #422, sobre `codex/navigation-motion-performance` (`5df9e6db7`). Corrigir os problemas encontrados no QA de navegação e medir o app completo em aparelhos físicos. O candidato permanece sem publicação e sem aprovação de fluidez para produção.

- Chegada rejeitada pelo servidor não confirma intent, não avança estado e não inicia embarque local.
- Indicação e ação de embarque usam distância direta ao ponto e referência visual de 20 m, correspondente ao default existente do servidor. Projeção zerada da rota a 50 m não libera chegada. O servidor continua validando o comando. Aviso visual de destino permanece em 80 m.
- Cache privado normaliza/valida na inserção, congela geometria e reutiliza identidade nas leituras e hidratações de GPS. Ampliação real da geometria continua sendo construída/validada; objeto congelado externamente não recebe confiança.
- Projeções da posição e das manobras compartilham a geometria preparada na mesma avaliação. Não há cache global novo nem mudança de algoritmo de distância.
- Movimento aplica coordenada/rotação pela API existente `MapMarker.setNativeProps` de react-native-maps 1.20.1. React atualiza o desenho ao mudar o bucket visual existente de 5°. A rotação continua contínua; indisponibilidade da API mantém o caminho React. Interpolação, teto de frames, previsão, snaps e pausa em segundo plano permanecem os de #422.
- Card do passageiro usa métricas vivas antes dos parâmetros iniciais, preserva zero no destino e usa distância/duração canônicas como base da viagem. A barra usa o total inicial conhecido inclusive na retomada; mantém fallback pela maior distância observada quando o total não existe. Sem redesenho nem alteração do valor bruto exibido.

## Arquivos alterados

Produto: `PrototypeMapLayer.js`, `LeafVehicleMarker.js`, `prototypeRideRuntime.js`, `RobotaxiTripScreen.js`, `liveRouteTiming.js`, `LeafNativeNavigationEngine.js` e `PrototypeDriverTripAssistantService.js` dentro de `mobile-app/src`. Testes focados em chegada/eventos, cache/hidratação, projeção parcial de rota, memoização, atualização imperativa com fallback/pausa, métricas do passageiro e progresso na retomada. Este documento registra a evidência.

## Testes executados

- 229 suítes e 1.849 testes unitários passaram. Comando: `npm --prefix mobile-app run test:unit -- --watchman=false --resolver=<resolver local de QA> --runInBand`. O resolver existente fora do produto seleciona uma única instalação React/dependências no workspace; não foi incluído no pacote.
- Governança, `qa:production-guards`, varredura de segredos rastreados, secret guard backend e `git diff --check` passaram.
- CI do código `a0ea0f9c4`: mobile completo, backend, regras Firebase e segurança passaram. Dashboard falhou antes de lint/build/smoke ao instalar Chromium: `Playwright does not support chromium on ubuntu26.04-x64`. Falha de compatibilidade do runner; workflow/dependências do dashboard não alterados neste PR. [Execução](https://github.com/leaf-admin/Leaf-new/actions/runs/40103102300).
- Testes executam os blocos privados reais de eventos/cache/métricas com dependências controladas, sem inicializar Auth/GPS. Não adicionam exports de teste ao runtime.
- Equivalência local: rota real de 784 pontos, 39 manobras simuladas e 112 posições, resultados de destino idênticos entre a implementação anterior e a geometria compartilhada. Três amostras de 336 avaliações: aproximadamente 19,7–20,4 s antes e 11,6–12,0 s depois. Ensaio JavaScript local, sem representar desempenho do aparelho.

## Builds locais e evidência

Artefatos e leituras filtradas, fora do Git: `~/.codex/visualizations/2026/10/22/01a16498-a3ec-7093-bfae-c4c373c52628/navigation-qa-followups/qa-cycle-2026-10-24/`.

Android: QA local 1.0.11 (144), OTA desativada, assinatura de QA existente. APK final `full-app-qa-complete.apk`, SHA-256 `95f2cd53ae524d4ab1f39b424d3335c861316a52e1a004a1e63ddca715bf668d`; bundle `b44d096e4f26c1375d083800d88372becc711df20ad94f53403383d1cfc2ead1`. Preserva os mesmos 43 arquivos DEX/bibliotecas nativas do artefato de QA base. O APK usado nas medições finais (`pose`, SHA-256 `fa5357c09d85eacfd32f996927bea9c3d8fea41631ea9f6e0aa97718e20a21d2`) tem o mesmo código de navegação do motorista; as correções finais do card do passageiro foram acrescentadas depois. O APK final completo não deve ser confundido com o medido.

iOS: JS atual embarcado sobre binário local de desenvolvimento 1.0.11 (50), provisionamento existente, OTA desativada, atualização sem limpeza/desinstalação e sessão preservada. Bundle SHA-256 `e32bb0a968bbcb11d90acad0ba263f9200c6468a5a85d3725a3db6a14ac76f89`. As 59 seções nativas de instruções/dados permanecem iguais à IPA base, fora assinatura. Não é um build publicado no TestFlight.

Uma tentativa anterior de empacotamento Android sem `META-INF/services` falhou no bootstrap Kotlin e foi descartada. Os recursos são preservados nos artefatos finais. Nenhum código nativo de instrumentação entra neste diff.

## Corridas físicas sandbox

A primeira tentativa validou rejeição a 50 m sem falso embarque. Após corrigir a projeção zerada, captura Android confirmou `50 m` e ação desabilitada. Perda de internet do Xiaomi interrompeu a rodada; o servidor reatribuiu e encerrou sem motorista. Não é E2E concluído.

A substituta `booking_1792808979216_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2` confirmou chegada a 10 m e início pelos botões normais. Após o intervalo, constava `EARLY_ENDED_BY_DRIVER`: contador sandbox permaneceu 6, operacional 0; ledger de 2.919 centavos balanceado, motorista 2.770, Leaf 99, Pix 50. Não atribuída à automação e não aceita como conclusão no destino.

Izaak autorizou um ciclo adicional de até duas corridas. A primeira é `booking_1792847887503_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`: Pix sandbox R$ 45,62, chegada/início normais, percurso simulado sobre a geometria recebida nessa solicitação, sem sobrescrever estado via API. Não houve segunda solicitação neste ciclo. Repetições de trecho para benchmarking tornam a distância acumulada inadequada como medida de percurso comercial real.

No iPhone, o QA detectou os 16 km iniciais presos no card apesar do marcador mover. A versão final passou a exibir 4 km e depois 400 m/1 min durante a aproximação, com a barra avançada após reiniciar a tela. Após desbloqueio, o servidor recebeu a coordenada do destino (erro inferior a 1 m). O iPhone exibiu `0 m restantes` e o Xiaomi `Você chegou ao destino`/`0 m`. Um único gesto normal de encerramento registrou `COMPLETED` às 14:41:25Z, qualificação `SERVER_DESTINATION_COMPLETION`, sem confirmação antecipada nem sobrescrita de estado.

Recibo persistido e ledger sandbox confirmaram 4.562 centavos pagos, 4.413 para o motorista, 99 Leaf e 50 Pix; pedágio de 995 incluído e repassado. Débito/crédito de 4.562 balanceados, evento `ride_settlement` postado. O recibo passageiro exibiu R$ 45,62 e o motorista R$ 44,13; os componentes de recibo existentes agrupam retenções em R$ 1,49. O campo legado `paymentStatus` permanece `in_holding` mesmo com settlement postado: não foi usado isoladamente como prova de liquidação.

Contador Redis e Firestore: sandbox 6 → 7, ID da corrida aparece uma única vez no histórico durável, operacional permanece 0. Perfis sem corrida ativa; motorista offline e passageiro de volta ao início. Janela temporária ausente, sem nova renovação; GPS simulado parado e serviço mock ausente. Evidências: `completed-financials.json`, `destination-confirmed.json`, `after-end.json`, `cleanup.json`, capturas dos recibos e árvores Leaf dos aparelhos. Os números de 16 km/28 min do recibo são métricas persistidas da estimativa; o longo replay de desempenho não valida duração/distância comerciais reais.

## Medição comparativa do app completo

Mesmo Xiaomi, Google Maps real, corrida ativa, trecho de 136 pontos/~2,14 km da própria solicitação, GPS simulado 1 Hz, bearing pelo segmento, resampling nominal de 20 m (segmentos curtos usam pelo menos um segundo). Processo novo por variante, aquecimento de 25 s, replay do mesmo prefixo, mais 12 s e três janelas de ~20 s. Nenhuma captura de UI dentro das janelas e nenhum miss de rota forçado.

Uma variante nativa somente de QA solicita 60 Hz na janela para estabilizar a comparação; modo efetivo e intervalos foram verificados. Não houve mudança das configurações do sistema. A versão normal foi restaurada antes do trecho final e não força 60 Hz. Os dados abaixo são do ensaio controlado de 60 Hz.

| Variante | CPU por janela (% de um núcleo) | Mediana CPU | p95 de frame (ms) | Frames janky / totais |
| --- | --- | --- | --- | --- |
| Antes de #422 | 269,6 / 253,8 / 260,9 | 260,9 | 25 / 24 / 24 | 58/1064 · 70/1079 · 48/1076 |
| #422 sem estes ajustes | 241,3 / 205,9 / 236,3 | 236,3 | 25 / 26 / 24 | 83/970 · 114/893 · 63/977 |
| Candidato final da navegação | 245,8 / 228,3 / 234,3 | 234,3 | 26 / 23 / 23 | 100/939 · 83/1019 · 75/959 |

A mediana de CPU caiu aproximadamente 10,2% contra a referência anterior a #422. **Não há melhora consistente de frames/jank; a fração de frames janky ficou maior que a referência. Não aprovar como melhoria comprovada de fluidez ou 60 fps.** A diferença de CPU contra #422 isoladamente é pequena.

Com o binário normal e modo efetivo de 120 Hz, duas janelas finais deram CPU 259,8%/244,0%, p95 21/21 ms e jank 140/1135, 141/1072. Não há referência equivalente desse trecho para comparação. USB conectado, temperatura de 40–41 °C nas coletas. Frequências/temperatura foram registradas, sem normalização do governor térmico.

Perfis Hermes separados localizaram reconstrução de geometria e reconciliação React, além de custos nativos/Google Maps. A dependência RN instalada registra JNI `disable` do sampler apontando para `enable`; medições quantitativas usam processo novo sem ativar sampler. Não se mede o próprio profiler. A primeira amostra de CPU 154,2% não tinha aquecimento equivalente e foi excluída da aprovação.

## Pendências e riscos

- Fluidez: redução de CPU não resolve a ausência de ganho consistente de frames. O candidato permanece em revisão, sem publicação.
- Uma tentativa interrompida (`booking_1792808239176_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`) terminou `NO_DRIVERS_AVAILABLE`/`CANCELED`; leitura posterior do pagamento sandbox de 5.348 centavos permaneceu `CONFIRMED`, sem campos de reembolso. Evidência de ausência de estorno nessa consulta, não diagnóstico conclusivo da causa. Exige investigação financeira separada; não houve estorno manual nem mudança de regra neste PR.
- `gfxinfo` não cobre toda a superfície/GPU do Google Maps. CPU de um núcleo pode exceder 100%; janelas curtas/RSS não comprovam autonomia, estabilidade térmica ou ausência de vazamento. Não houve teste controlado de bateria.
- Cache congelado exige substituição pelo caminho validado, sem mutação. A referência visual de embarque precisa acompanhar futuras mudanças do default do servidor.

## Reversão e fora do escopo

Reverter o commit desta tarefa e reinstalar os artefatos locais guardados por atualização, preservando sessões. O APK Android de referência foi guardado com SHA-256 `a0370703db0df71cbca11d427d3b558ab8688686e2e3b16d7399b49769b2069f`. A IPA iOS base é de desenvolvimento; não representa restauração exata do último TestFlight/OTA.

Sem merge, deploy, OTA, envio ao Sentry ou lojas. Sem dependências, novos serviços/jobs, chamadas pagas adicionais no código, regras financeiras/KYC, alterações de infraestrutura, redesenho de outras telas ou correção do corte histórico do ícone do carro.
