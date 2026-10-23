# Cards flutuantes: Faixa e Horizonte

## Objetivo e escopo concluído

Aplicar os desenhos escolhidos por Izaak somente aos cards da corrida: Faixa no banner de navegação dentro do Leaf e na janela externa Android; Horizonte no resumo compacto da viagem em andamento do passageiro. A prévia foi aprovada antes da implementação. Seus dados ilustrativos não foram copiados para o produto.

O banner interno organiza distância, manobra, etapa e resumo em uma Faixa com divisor vertical. Mantém os comandos existentes para abrir o navegador e ocultar o banner. A distância tem espaço próprio, e a medição da altura efetiva continua reservando espaço na câmera; nenhum código de enquadramento, rota ou câmera foi alterado.

A janela externa usa o mesmo desenho, com ETA/distância à esquerda, etapa/destino ao centro e a ação operacional em uma faixa inteira abaixo. “Abrir Leaf” é secundário. O executor direto, confirmação pelo runtime, bloqueio de repetição e mensagens de erro do PR permanecem. O relógio de embarque usa o `Chronometer` Android com os segundos restantes já recebidos, para não congelar entre atualizações da notificação. A janela abre abaixo das instruções do navegador e permite ajustar a posição pela pílula existente; sua altura é medida para respeitar o limite inferior da tela.

O Horizonte apresenta a chegada, o valor bruto já calculado, o tipo do veículo, uma barra fina sem carrinho/bolinha e os endereços. Identidade, placa e fluxos atuais de contato/opções são reutilizados. O resumo da viagem iniciada oferece Mensagem e Mais opções, conforme a prévia. A apresentação expandida dessa mesma viagem usa a barra simples; os demais estados conservam sua interface.

Os campos adicionais da Faixa são apenas de apresentação, derivados de endereço, distância e relógio já disponíveis. Os textos, ações e deduplicação da notificação/Live Update continuam iguais. Não há consultas adicionais a Google, OSM ou outro provedor, nem nova dependência ou serviço.

## Arquivos alterados

- `mobile-app/src/screens/prototype/home/LeafNativeNavigationBanner.js`: apresentação interna e reserva da altura real.
- `mobile-app/native/ride-overlay/android/LeafRideOverlayWindow.kt`: apresentação externa, relógio, ação secundária e limites da janela.
- `mobile-app/native/ride-overlay/android/LeafRideOverlayState.kt`: campos opcionais da apresentação; valores padrão preservam compatibilidade com estados antigos.
- `mobile-app/src/services/LeafRideOverlay.js`: transforma dados existentes em textos da Faixa, mantendo os campos da notificação.
- `mobile-app/src/services/PersistentRideNotificationService.js`: repassa endereço e distância existentes para a apresentação da janela.
- `mobile-app/src/screens/prototype/PassengerTripHorizon.js`: conteúdo visual do resumo Horizonte.
- `mobile-app/src/screens/prototype/RobotaxiTripScreen.js`: conecta o Horizonte somente à viagem iniciada e reutiliza as ações atuais.
- `mobile-app/src/components/prototype/LeafRideUI.js`: variante de linha do progresso, usada explicitamente pelo Horizonte e por sua versão expandida; a variante anterior continua padrão para outros consumidores.
- Testes: `leaf-native-navigation-banner.test.js`, `leaf-ride-overlay.test.js`, `prototype-ride-screens.test.js` e `passenger-trip-horizon.test.js`.
- Este documento e a atualização do registro `EXTERNAL_OVERLAY_DIRECT_ACTIONS_2026-10-23.md`.

## Testes e evidência

- Suíte completa mobile: **225 suítes, 1.798 testes passaram**. Executada com o resolver local já existente para manter uma instância de React/RN neste checkout com dependências em symlink.
- Testes focados: **6 suítes, 227 testes passaram**. Cobrem navegação e reserva de altura, progresso sem marcador e seus limites, compatibilidade da variante anterior, preservação dos valores fornecidos por props, contato do passageiro e ações diretas com ACK, falha, duplicidade, corrida/etapa antigas e tolerâncias. Os testes usam fixtures, não respostas de uma nova corrida real.
- Android: `:app:compileDebugKotlin --offline` passou com os templates finais. Java 17 e Android SDK 36; árvore gerada temporariamente preparada e restaurada após a compilação. Sem assinatura de produção, APK instalado ou publicação.
- Conferência local dos componentes RN renderizados com RN Web: 12 casos em 320, 390 e 480 dp, incluindo endereços longos e valor de quatro dígitos. Sem transbordamento horizontal dos componentes. Essa inspeção usa contexto isolado e não comprova o comportamento nativo, a câmera nem uma sessão real.
- `git diff --check`, governança, scans de segredos e `qa:production-guards`: resultados finais registrados no PR.
- Logs e imagens locais fora do Git: diretório `overlay-direct-actions` da prévia desta conversa, incluindo `cards-full-unit.log`, `cards-focused-tests.log`, `cards-android-compile.log` e `actual-components-qa.json`. Não contêm dados de uma nova corrida operacional.

## Riscos e QA pendente

O visual externo e o executor nativo exigem novo build Android. OTA sozinha não atualiza o Kotlin instalado. Esta etapa não realizou deploy, OTA, instalação ou envio às lojas.

Falta o QA físico da versão compilada: chegada/início/conclusão sandbox em segundo plano, confirmação sem trazer Leaf à frente, erro/repetição, contagem regressiva, recolher/reposicionar/expandir e posição sobre o navegador preferido. No Leaf, conferir a manobra e a rota sem encobrir o veículo com textos longos. No passageiro, conferir Horizonte, expansão, chat e barra durante a mesma corrida. O enquadramento real não é considerado aprovado com base em testes unitários ou RN Web.

## Rollback e fora do escopo

Reverter o commit dos desenhos devolve a apresentação anterior; para o Android já distribuído, o rollback da janela exige novo build publicado pelo processo autorizado. Não existe migração de dados. O commit anterior das ações diretas permanece separado para revisão ou reversão independente.

Intocados: demais telas e controles da interface, mapa/câmera/roteamento, ofertas de corrida, KYC, backend, Pix, tarifas, promoção, ledger, reembolso, voz, notificações de sistema, lojas e infraestrutura. Nenhuma ação de produção autorizada historicamente foi reaproveitada para publicar esta mudança.
