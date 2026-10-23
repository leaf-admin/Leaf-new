# Ações do flutuante externo Android

## Objetivo e escopo concluído

O botão da etapa no flutuante deve executar a ação sem abrir o Leaf e exigir outro toque. O corpo do card continua abrindo o aplicativo. Após a escolha de Izaak, os desenhos Faixa (motorista dentro/fora) e Horizonte (passageiro) foram implementados em um commit separado neste PR. Escopo e evidências visuais estão em `FLOATING_CARDS_FAIXA_HORIZONTE_2026-10-23.md`. Nenhuma dessas alterações foi publicada nesta etapa.

O botão nativo agora emite um evento para o runtime existente, com corrida, ação e identificador da solicitação. A janela mostra confirmação em andamento, bloqueia toques duplicados e recebe sucesso somente após o comando existente confirmar a execução. Falhas e ausência de confirmação aparecem na própria janela, sem abrir Activity automaticamente.

O executor revalida corrida e etapa antes e depois da leitura do GPS, usa as tolerâncias já existentes e não faz encerramento antecipado pelo flutuante. Início, chegada e conclusão usam as mesmas funções do runtime, idempotência e validações do backend. Sem nova API, dependência, worker ou regra financeira.

## Arquivos alterados

- `mobile-app/native/ride-overlay/android/LeafRideOverlayWindow.kt`: ação direta, confirmação, timeout e bloqueio de duplicidade na janela.
- `mobile-app/native/ride-overlay/android/LeafRideOverlayModule.kt`: ponte do evento e resultado, sem iniciar Activity.
- `mobile-app/src/services/LeafRideOverlay.js`: listener, executor, escopo da solicitação e confirmação ao nativo.
- `mobile-app/src/services/executeDriverOverlayAction.js`: execução limitada à corrida/etapa e localização atuais.
- `mobile-app/src/screens/prototype/prototypeRideRuntime.js`: conecta o executor às funções existentes e o remove ao sair do papel de motorista.
- `mobile-app/__tests__/leaf-ride-overlay.test.js` e `driver-overlay-action.test.js`: confirmação após ACK, duplicidade, falha, corrida antiga, troca de corrida durante GPS, etapa e tolerâncias.
- Este documento.

## Testes e evidência

- 32 testes passaram em três suítes: overlay, executor de ações e regressão da notificação persistente. Resolver local existente utilizado para manter uma única instância de React Native neste checkout.
- Transformação Babel dos três arquivos JS de implementação: passou.
- `:app:compileDebugKotlin --offline`: passou, Android SDK 36 e Java 17. Templates nativos atuais copiados para a árvore Android gerada apenas para a compilação; sem instalar APK, assinatura de produção ou acesso aos celulares.
- `git diff --check`, governança, secret guards e `qa:production-guards`: passaram.
- Prévia com 12 designs fora do Git: seis flutuantes externos e seis cards do passageiro, sem carrinho dentro de círculo na barra. Conferidas 252 combinações de tamanho (320/390/736), tema e etapa/progresso. As interações da prévia não executam operações reais.

## Riscos e validação pendente

Esta mudança exige novo build Android. OTA sozinha não troca o módulo Kotlin do 1.0.11 instalado. Nenhuma publicação, instalação, envio à loja ou novo E2E físico foi realizado neste PR.

Antes de aceitar o funcionamento no aparelho: testar chegada, início e conclusão sandbox com Leaf em segundo plano; garantir que a Activity continue em segundo plano e que o passageiro receba cada transição; testar socket indisponível, clique repetido, botão antigo, timeout e atualização de etapa durante a confirmação. Se o runtime estiver indisponível, a janela deve informar a falha e oferecer reconexão manual, sem simular sucesso.

O timeout da janela não desfaz uma ação já recebida pelo servidor. A conclusão efetiva vem do backend e os comandos existentes mantêm a idempotência. Notificações/Live Update e o card de oferta externo conservam seus fluxos anteriores; este PR modifica o botão da janela flutuante da corrida.

## Rollback e fora do escopo

Reverter este PR e gerar/republicar o Android anterior pelo processo autorizado. Não há migração ou exclusão de dados. O retorno ao comportamento nativo anterior exige build, não somente OTA.

Intocados: backend, Pix, promoção, pedágio, ledger, regras de corrida, voz, demais telas e controles, lojas e provedores pagos. Os novos desenhos de componentes JS também se aplicam ao iOS quando uma versão autorizada os distribuir; a janela nativa externa continua sendo Android.
