# Checklist De Abertura Para Producao

Data: 2026-07-01
Produto: Leaf
Objetivo: decidir abertura controlada e depois abertura ampla em producao, sem regressao do ciclo de corrida.

## Estado Atual De Referencia

- Branch de trabalho: `codex/p0-p1-no-regression-hardening`
- OTA production publicada:
  - runtime: `1.0.4`
  - update group: `88335f5e-5e89-43fc-85aa-f93eb29970ec`
  - Android update ID: `019f1df3-4a03-732d-be7e-daf54f913cee`
  - iOS update ID: `019f1df3-4a03-7cfb-932d-d6ea84fc24e7`
- Condicao atual recomendada: GO apenas para producao assistida com cohort pequeno.
- Condicao para abertura ampla: todos os itens P0 abaixo fechados com evidencia.

## Regra De Decisao

- P0 aberto: NO-GO para abertura ampla.
- P1 aberto: permitido apenas em producao assistida se houver mitigacao documentada.
- P2 aberto: nao bloqueia producao, mas deve entrar no backlog de pos-lancamento.
- Qualquer divergencia financeira, tela vazia, regressao de estado de corrida, Pix sem despacho ou corrida sem rastreabilidade: P0 e pausa imediata.

## P0 - Release, Versionamento E Rastreabilidade

- [x] Worktree limpa ou dirty worktree completamente justificada em relatorio de release.
- [x] Commits atomicos criados para todo codigo/teste/config que entrou na RC.
- [x] Commit SHA da RC registrado.
- [x] Tag de release criada ou release candidate registrada com hash imutavel.
- [x] OTA group, runtime, canal e update IDs registrados em `QA/current-e2e` ou pasta de release.
- [ ] Builds instaladas nos devices conferidas contra runtime correto (`1.0.4`).
- [x] Rollback documentado: EAS rollback/republish do grupo anterior e responsavel definido.
- [x] Nenhuma mudanca de regra financeira, pagamento, taxa, split, pedagio, refund ou KYC sem aprovacao explicita.

Evidencia do congelamento: `QA/release-candidates/2026-07-07-rc1/manifest.md`.

## P0 - Baseline Tecnico Obrigatorio

- [x] `git diff --check`
- [x] `npm run governance:check`
- [x] `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
- [x] `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
- [x] `npm --prefix mobile-app run qa:production-guards`
- [x] `npm --prefix leaf-websocket-backend run config:validate`
- [x] `npm --prefix mobile-app run test:unit -- --runInBand leaf-native-navigation-banner.test.js leaf-native-navigation-engine.test.js driver-online-toggle.test.js`
- [x] `npm --prefix mobile-app run test:unit -- --runInBand prototype-ride-screens.test.js`
- [x] Backend unit direcionado executado se houver qualquer diff backend na RC.

Evidencia do bloco 2: `QA/release-candidates/2026-07-07-rc2/block-2-validation.md`.
Evidencia do bloco 3: `QA/release-candidates/2026-07-07-rc3/block-3-live-activities-push-validation.md`.

## P0 - Runtime, OTA E App Instalado

- [ ] Android real recebeu OTA production `1.0.4`.
- [ ] iOS real recebeu OTA production `1.0.4`.
- [ ] App abre hidratado sem tela vazia.
- [ ] Passageiro sem corrida ativa abre na home limpa.
- [ ] Motorista sem corrida ativa abre na home limpa.
- [ ] Estado pre-corrida nao persiste cotacao/pagamento expirado.
- [ ] Estado em corrida persiste corretamente ao fechar/reabrir.
- [ ] Nenhuma tela fica apenas com mapa e rota sem card/acao.
- [ ] Banner "Fora da rota" nao aparece na UI.
- [ ] Banner superior oferece "Navegar com Waze ou Google Maps" quando aplicavel.
- [ ] Hot link externo abre Waze/Google Maps/Apple Maps conforme plataforma.

## P0 - Backend, Socket E Pagamento

- [ ] Backend produtivo esta no mesmo estado logico esperado pela RC.
- [ ] Socket.IO produtivo ativo com Redis adapter obrigatorio.
- [ ] Sem polling como mecanismo principal de estado de corrida.
- [ ] Sem bypass de pagamento em producao.
- [ ] Usuarios reais usam Woovi production.
- [ ] Usuarios de teste usam Woovi sandbox por flag/user profile.
- [ ] Webhook Woovi confirmado e validado.
- [ ] Criacao de Pix falha de forma recuperavel, com retry controlado e sem tela vazia.
- [ ] Pagamento confirmado dispara criacao/dispatch da corrida apenas uma vez.
- [ ] Idempotencia garantida para charge, booking, dispatch, aceite, cancelamento, fim e recibo.
- [ ] Se Pix expirar, app mostra alerta e retorna para home limpa de cotacao, sem reabrir modal expirado.

## P0 - Motoristas, Geofence E Disponibilidade

- [ ] Regiao piloto definida e documentada.
- [ ] Geofence ativa/expandida para a regiao do piloto.
- [ ] Raio operacional de motorista elegivel confirmado: 5 km geografico.
- [ ] Sem motorista elegivel antes do Pix bloqueia pagamento.
- [ ] Motorista tester/real com KYC valido, CNH/CRLV/liveness/face compare aprovados.
- [ ] Motorista consegue ficar online sem tela "Bem vindo" reaparecendo.
- [ ] Timer online cumulativo dentro da janela de 24h.
- [ ] Ao atingir 12h online, motorista fica offline e recebe mensagem de limite diario.
- [ ] Ao cancelar pelo passageiro antes do aceite, card some do motorista com estado "corrida cancelada".

## P0 - E2E De Corrida Obrigatorio

- [ ] Passageiro seleciona partida e destino.
- [ ] Rota canonica renderiza uma vez, sem linha reta intermediaria.
- [ ] Polyline usa segmentos de trafego quando disponiveis.
- [ ] Categoria mostra preco canonico.
- [ ] Breakdown mostra tarifa base, adicional de embarque, pedagio quando houver, taxas e total.
- [ ] Sem motorista elegivel: pagamento fica bloqueado antes do Pix.
- [ ] Com motorista elegivel: Pix e criado em Woovi correto.
- [ ] Pagamento confirmado.
- [ ] Passageiro entra em busca de motorista sem estado confuso "criando corrida".
- [ ] Motorista recebe offer card com passageiro, partida, destino, distancia, tempo, rota e valor liquido correto.
- [ ] Motorista aceita.
- [ ] Passageiro ve motorista a caminho com rota ate embarque.
- [ ] Motorista ve rota ate embarque.
- [ ] Chegada ao embarque nao exige codigo inexistente.
- [ ] Inicio da corrida atualiza ambos os lados.
- [ ] Durante a corrida, rota aparece para passageiro e motorista.
- [ ] Camera de navegacao nao oscila zoom sem motivo.
- [ ] Passageiro nao consegue regredir estado tocando no mapa/bottomsheet.
- [ ] Motorista nao consegue regredir estado tocando no mapa/bottomsheet.
- [ ] Corrida finaliza.
- [ ] Recibo do passageiro aparece com valor bruto correto.
- [ ] Recibo do motorista aparece com liquido correto.
- [ ] Avaliacao funciona.
- [ ] Apos avaliacao, app volta para home limpa.

## P0 - Reconciliacao Financeira

- [ ] Valor da cotacao = valor do Pix = recibo passageiro.
- [ ] Valor liquido motorista = bruto - taxas aprovadas - pass-throughs aplicaveis.
- [ ] Pedagio aparece explicitamente quando rota passa por praca conhecida.
- [ ] Leaf fee usa politica aprovada, sem regra nova.
- [ ] Refund em cancelamento pos-pagamento e registrado e rastreavel.
- [ ] Dashboard Leaf mostra o mesmo bruto da corrida.
- [ ] Woovi mostra cobranca no ambiente correto.
- [ ] IDs registrados: quote, charge, booking, receipt, ledger/refund quando houver.

## P0 - Suporte, Dashboard E Operacao Assistida

- [ ] Dashboard mostra usuarios, motoristas, corridas, pagamentos e recibos corretamente.
- [ ] Operador consegue acompanhar corrida em tempo real.
- [ ] Suporte abre chamado com ride/payment/user context.
- [ ] Orquestrador de suporte classifica severidade.
- [ ] Chat em tempo real funciona em corrida ativa.
- [ ] Falha de chat mostra erro claro, nao tela vazia.
- [ ] Logs backend correlacionam sessao, booking, payment e socket.
- [ ] Woovi dashboard monitorado durante rodada assistida.
- [ ] Runbook de pausa: como parar convites, bloquear regiao, rollback OTA e acionar suporte.

## P0 - Seguranca, KYC E Compliance

- [ ] Politica de seguranca publicada e acessivel.
- [ ] Termos, privacidade, reembolso e exclusao de conta publicados.
- [ ] Usuario real nao acessa ferramentas de teste.
- [ ] Cliente mobile nao chama Google paid provider diretamente fora das APIs Leaf.
- [ ] Firebase/Google configurados sem warning critico.
- [ ] Warning de KYC biometrico estrito aceito formalmente ou resolvido antes de expansao ampla.
- [ ] Motorista sem KYC valido nao consegue ficar ativo.
- [ ] Nenhuma credencial ou segredo novo versionado.

## P1 - Experiencia E Polimento Para Escala

- [ ] Card de busca de motorista mostra valor, timer, partida e chegada com ETA.
- [ ] Preferencias da viagem em modal limpo, sem card confuso.
- [ ] Offer card do motorista nao usa labels genericos como "Local combinado" ou "Motorista".
- [ ] Live/dynamic island revisada para nao duplicar informacao inutil.
- [ ] Modal de falha de pagamento sem botao branco com texto branco.
- [ ] Mapa da tela "motorista a caminho" enquadra rota ate embarque.
- [ ] Placa, modelo e cor aparecem consistentes no app e recibo.
- [ ] Polyline e camera calibradas nos principais estados da corrida.

## P1 - Monitoramento E Limites Operacionais

- [ ] Alertas de erro de Pix, webhook, dispatch, socket disconnect e refund.
- [ ] Alertas de divergencia financeira.
- [ ] Alertas de tela vazia/estado invalido via eventos ou logs.
- [ ] Dashboard de motorista online e disponibilidade por regiao.
- [ ] Dashboard de funil: destino, quote, Pix, pagamento, busca, aceite, inicio, fim, avaliacao.
- [ ] Limite de motoristas online 12h/dia monitorado.

## Plano De Producao Assistida

- [ ] Cohort inicial: 2 passageiros reais controlados.
- [ ] Cohort inicial: 2 motoristas reais/validados.
- [ ] 1 operador acompanhando dashboard, backend logs, Woovi e suporte.
- [ ] 1 rodada sem motorista elegivel para validar bloqueio pre-Pix.
- [ ] 1 rodada com cancelamento pelo passageiro antes do aceite.
- [ ] 1 rodada completa ponta a ponta.
- [ ] Evidencia coletada: screenshots, logs, IDs, valores, recibos e resultado financeiro.
- [ ] Janela de teste com rollback pronto.

## Gate Para Abertura Ampla

- [ ] 3 corridas reais assistidas completas sem P0.
- [ ] 1 cancelamento/refund assistido sem divergencia.
- [ ] 1 caso sem motorista bloqueado antes do Pix.
- [ ] 24h sem alerta critico de pagamento/socket/estado.
- [ ] Reconciliacao financeira de 100% das corridas assistidas.
- [ ] Suporte apto a responder incidentes com contexto de corrida.
- [ ] Decisao final GO assinada por produto/operacao/engenharia.

## Decisao

- [ ] NO-GO
- [ ] GO para producao assistida
- [ ] GO para abertura ampla

Responsavel pela decisao:
Data/hora:
Observacoes:
