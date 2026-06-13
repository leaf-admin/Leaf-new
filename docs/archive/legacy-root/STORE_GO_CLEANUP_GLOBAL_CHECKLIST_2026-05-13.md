# Checklist Global GO Lojas + Limpeza Segura - Leaf

Data: 2026-05-13  
Escopo: App Store, Google Play e limpeza de artefatos/legado sem alterar a superficie funcional do app.

## Decisao Executiva

Status de loja hoje: NO-GO ate fechar metadata, dominio publico final para politicas/termos/delecao, assets, privacidade e contas de revisao.

Status tecnico do app: GO tecnico condicionado as evidencias recentes de fluxo iOS/Android, mas precisa empacotamento final de loja com os mesmos binarios/flags e sem sujeira de QA visivel.

Evidencias tecnicas recentes que devem ser preservadas:
- iOS Release: `/Users/izaakdias/Documents/Leaf-new/reports/native-navigation-ios-release-5x-go-20260512_172219/`
- Android Release: `/Users/izaakdias/Documents/Leaf-new/reports/native-navigation-android-release-5x-go-20260512_184714/`
- Store preflight: `/Users/izaakdias/Documents/Leaf-new/mobile-app/reports/store/store-preflight-2026-05-11.md`
- Play Store review videos: `/Users/izaakdias/Documents/Leaf-new/reports/playstore-review-2026-05-04/`

## Regra De Ouro

Nao remover nada de runtime nesta fase sem uma PR separada e teste release iOS/Android depois. O objetivo aqui e deixar claro o que bloqueia loja, o que e lixo local gerado, o que e legado publico perigoso e o que ainda parece ativo apesar do nome ruim.

Observacao sobre landing page: a landing em si nao deve reprovar teste do app, desde que nao seja usada como URL oficial de politica de privacidade, termos, delecao de conta, suporte ou metadata da loja. A limpeza da landing e recomendada por marca/compliance, mas nao deve ser tratada como bloqueador tecnico do binario se as URLs oficiais estiverem corretas.

## GO App Store

- [ ] Build release instalada em dispositivo/simulador limpo, sem crash no primeiro uso.
- [ ] Backend de review ativo, acessivel e sem depender de tunel local.
- [ ] App Review Notes com contas corretas e ativas:
  - Passageiro: `+55 21 10293-8475`, codigo `992111`.
  - Motorista: `+55 21 12345-6789`, codigo `992000`.
  - Se houver senha de review, documentar no App Store Connect e validar antes do envio.
- [ ] Fluxo de exclusao de conta disponivel dentro do app, sem exigir contato humano para iniciar.
- [ ] URL publica de exclusao de conta no dominio final, HTTPS 200.
- [ ] Politica de privacidade em dominio final, HTTPS 200, sem usar `sslip.io` como URL publica final.
- [ ] Termos de uso, politica de reembolso, suporte e contato publico em HTTPS 200.
- [ ] App Privacy preenchido com dados reais coletados:
  - telefone, nome, email quando aplicavel;
  - localizacao precisa e, para motorista, localizacao em background se usada;
  - dados financeiros/transacao;
  - historico de corrida;
  - mensagens de suporte/chat;
  - identificadores, diagnosticos e crash logs;
  - fotos/documentos se KYC/veiculo pedir upload.
- [ ] Declarar tracking apenas se houver tracking real entre apps/sites; caso contrario, manter como nao tracking.
- [ ] Permissoes iOS revisadas: textos claros para localizacao, camera, fotos, notificacoes e background location.
- [ ] Justificativa de background location centrada em seguranca/operacao da corrida, nao em conveniencia generica.
- [ ] Screenshots finais por tamanho exigido, feitos em build release, sem mocks quebrados, logs, banners de QA ou dados internos.
- [ ] Metadata sem "beta", "em breve", "teste", "Android", concorrentes ou promessas nao entregues.
- [ ] Descricao curta e clara: o que o Leaf faz, para quem, onde opera e quais fluxos principais existem.
- [ ] Precos e taxas explicados de forma simples onde forem relevantes: taxa operacional por faixa, Woovi/intermediacao, taxa diaria suspensa.
- [ ] Classificacao etaria coerente.
- [ ] Conteudo, imagens, mapas, videos e icones com direito de uso.
- [ ] Nenhuma funcionalidade oculta para revisores.
- [ ] Todas as features complexas descritas em review notes, com videos quando necessario.
- [ ] Contato de suporte de revisao atualizado.
- [ ] Teste em tamanhos de tela principais iPhone pequeno, medio e grande.
- [ ] HIG sanity check: navegacao, modais, permissoes, contraste, toque minimo, safe area e textos sem corte.

## GO Google Play

- [ ] AAB release assinado e instalado via Internal Testing antes do envio publico.
- [ ] Backend de review ativo e acessivel durante todo o periodo de revisao.
- [ ] App Access com credenciais corretas:
  - Passageiro: `+55 21 10293-8475`, codigo `992111`.
  - Motorista: `+55 21 12345-6789`, codigo `992000`.
- [ ] Data Safety preenchido exatamente com dados coletados, compartilhados, criptografia em transito e opcao de delecao.
- [ ] URL publica de politica de privacidade HTTPS 200.
- [ ] URL publica de exclusao de conta HTTPS 200 e equivalente ao fluxo dentro do app.
- [ ] Declaracao de background location aprovada quando o app pedir localizacao em segundo plano.
- [ ] Video de background location anexado, mostrando por que o motorista precisa disso durante/apos fluxo de corrida.
- [ ] Prominent disclosure de localizacao em background antes da permissao Android.
- [ ] Permissoes Android revisadas: localizacao, notificacoes, camera, storage/fotos; nada alem do necessario.
- [ ] Store listing sem "beta", "em breve", concorrentes ou claims nao comprovaveis.
- [ ] Feature graphic, icone 512, screenshots phone e demais assets obrigatorios prontos.
- [ ] Classificacao de conteudo preenchida.
- [ ] Target audience coerente, sem criancas como publico-alvo.
- [ ] Release notes claras, sem mencionar testes internos ou concorrentes.
- [ ] Teste em telas Android pequena, media e grande.
- [ ] Crash-free smoke em cold start, login, corrida, chat, suporte, saque, exclusao de conta.
- [ ] Sem bypass publico de QA, debug menu, host local, chave sandbox visivel ou fluxo escondido.

## Checklist Compartilhado De Produto Antes Do Envio

- [ ] Passageiro novo cadastra, solicita corrida e finaliza avaliacao.
- [ ] Passageiro existente loga e retoma estado correto.
- [ ] Motorista novo cadastra, aguarda ativacao e nao entra online sem aprovacao.
- [ ] Motorista aprovado entra online com veiculo ativo.
- [ ] Motorista com mais de um veiculo seleciona o veiculo do dia.
- [ ] Corrida completa: quote, aceite, chegada, inicio, rota, chat, suporte, finalizacao, recibo e avaliacao.
- [ ] Navegacao interna mostra polyline real, instrucao, distancia proxima manobra, camera follow e some ao finalizar.
- [ ] Navegacao externa abre Google Maps/Waze/Apple Maps conforme plataforma.
- [ ] Chat em tempo real funciona para passageiro e motorista durante corrida.
- [ ] Suporte cria tickets rastreaveis: geral, corrida, reembolso, objeto perdido e pagamento.
- [ ] Saque mostra taxa diaria R$ 9,90 tachada/zerada enquanto suspensa.
- [ ] Ledger final bate com valor bruto, taxa Woovi, taxa operacional e repasse.
- [ ] Passageiro e motorista terminam sem corrida ativa presa.
- [ ] Cancelamento depois do aceite mostra aviso de possiveis cobrancas.
- [ ] Geofence permite iniciar apenas dentro da area definida e finalizar fora dela dentro do Rio quando permitido.
- [ ] Observabilidade por bookingId/correlationId cobre app, backend, Redis, financeiro e suporte.

## Pendencias Que Bloqueiam Loja

- [ ] Corrigir dominio publico final: `leaf.app.br` deve responder HTTPS 200 para privacidade, termos, suporte e exclusao de conta; landing apenas se for usada como link oficial/metadata.
- [ ] Remover ou substituir qualquer dependencia publica de `sslip.io` em metadata de loja.
- [ ] Atualizar documentos/metadata que ainda citam contas antigas de teste `+55 11...`.
- [ ] Garantir que as URLs oficiais usadas nas lojas nao apontem para paginas com "em breve", concorrentes ou assets copiados de referencia.
- [ ] Regenerar screenshots finais depois da limpeza de metadata/landing.
- [ ] Fechar declaracoes App Privacy/Data Safety com inventario real dos SDKs e dados.
- [ ] Preparar review notes unificadas para Apple e Google.
- [ ] Rodar `node scripts/prelaunch/assert-store-go-static.cjs` e fechar todos os `FAIL` antes de submissao.

## Gate Estatico Apple/Google

Arquivo: `/Users/izaakdias/Documents/Leaf-new/scripts/prelaunch/assert-store-go-static.cjs`

Esse gate e propositalmente conservador e cobre:
- links legais HTTPS e sem host temporario/local;
- URLs finais sob dominio Leaf ou alerta manual para dominio alternativo;
- credenciais antigas de review removidas de docs/configs de loja;
- copy sensivel em docs de submissao: `beta`, `em breve`, `mock`, `bypass`, `sandbox`, concorrentes e termos de teste;
- mencao de Android em contexto Apple/App Store;
- flags de QA/review/bypass desligadas no ambiente/eas;
- permissoes sensiveis declaradas ou bloqueadas em `app.config.js`.

Semaforo:
- `FAIL`: NO-GO para App Store e Google Play.
- `WARN`: exige triagem manual e evidencia no pacote final.
- Sem `FAIL`: GO apenas para o checklist estatico; ainda depende dos consoles oficiais e smoke TestFlight/Internal Testing.

O script foi conectado ao `mobile-app/scripts/store-console-preflight.sh`, entao qualquer preflight de loja passa a falhar se a superficie de submissao ainda contiver host temporario, credencial antiga ou bypass/teste exposto em docs/configs de loja.

### Rodada Store/Compliance 2026-05-14

Comandos executados:
- `node scripts/prelaunch/assert-store-go-static.cjs` -> PASS, 0 `FAIL`, 16 `WARN`.
- `bash mobile-app/scripts/store-console-preflight.sh` -> PASS, 20 passou, 0 falhou, relatorio em `/Users/izaakdias/Documents/Leaf-new/mobile-app/reports/store/store-preflight-2026-05-14.md`.
- `rg` de strings sensiveis em `mobile-app/src`, `mobile-app/docs`, docs de loja e scripts de prelaunch -> achados classificados abaixo.

Diagnostico da rodada:
- Material pronto de submissao Apple/Google foi atualizado para `https://api.leaf.app.br/*` e contas de review atuais.
- Links legais finais responderam HTTP 200: privacy, terms, refund e account deletion.
- Perfis EAS de release (`production`, `production-apk`, `release-test`) mantem `APP_REVIEW`, `E2E_TEST`, payment bypass e test user tools desligados.
- Perfis EAS de review/desenvolvimento com `APP_REVIEW=true` continuam como `WARN`; nao usar esses perfis para submissao publica.
- Docs historicos ainda citam `sslip.io` como evidencia antiga; nao usar esses documentos como fonte de metadata de loja.
- Scripts QA/prelaunch ainda tem defaults `sslip.io` para rodadas antigas; nao sao runtime core nem metadata, mas devem receber override `API_BASE_URL/WS_URL` ou migracao em limpeza separada.
- Runtime ainda contem servicos/rotas de bypass/test user/mock controlados por policy; sem remocao nesta rodada por estar fora do escopo e exigir teste release separado.

Semaforo da rodada:
- GO estatico: sim.
- GO preflight de links/configs: sim.
- GO para submissao publica: nao, enquanto os itens manuais de console e smoke oficial abaixo continuarem abertos.

## Limpeza Segura Executada Em 2026-05-13

Workspace apos limpeza: ~5.5G. Removidos apenas caches/builds/logs/temp/evidencias temporarias geradas localmente:

- `node_modules/`
- `mobile-app/ios/build/`
- `mobile-app/android/app/build/`
- `mobile-app/.expo/`
- `.expo/`
- `mobile-app/test-results/`
- `leaf-dashboard-js/.next/`
- `leaf-websocket-backend/coverage/`
- `leaf-websocket-backend/logs/`
- `tmp/`
- `tmp-evidence/`
- `ngrok.pid`
- Todos os `.DS_Store` encontrados no workspace.
- Diretorios vazios removidos quando aplicavel: `emulator`, `platform-tools`, `platforms`, `system-images`, `store-assets`.

Nada de runtime, codigo-fonte, configs de produto ou relatorios GO foi removido nesta etapa.

## Lixo Local Gerado - Ja Limpo / Pode Recriar

Esses itens sao gerados por build/teste/cache/evidencia temporaria. Devem sair do workspace antes de empacotar loja, preservando apenas os relatorios GO listados acima.

- [x] `/Users/izaakdias/Documents/Leaf-new/.DS_Store`
- [x] `/Users/izaakdias/Documents/Leaf-new/docs/.DS_Store`
- [x] `/Users/izaakdias/Documents/Leaf-new/node_modules/`
- [x] `/Users/izaakdias/Documents/Leaf-new/mobile-app/ios/build/`
- [x] `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/`
- [x] `/Users/izaakdias/Documents/Leaf-new/mobile-app/.expo/`
- [x] `/Users/izaakdias/Documents/Leaf-new/.expo/`
- [x] `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/`
- [x] `/Users/izaakdias/Documents/Leaf-new/leaf-dashboard-js/.next/`
- [x] `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/coverage/`
- [x] `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/logs/`
- [x] `/Users/izaakdias/Documents/Leaf-new/tmp/`
- [x] `/Users/izaakdias/Documents/Leaf-new/tmp-evidence/`
- [x] `/Users/izaakdias/Documents/Leaf-new/ngrok.pid`
- [x] Root SDK/cache vazios se nao usados: `/emulator`, `/platform-tools`, `/platforms`, `/system-images`, `/store-assets`.

## Evidencias Antigas - Arquivar, Nao Misturar Com GO

Manter so as evidencias finais de GO e mover o restante para arquivo externo ou `reports/archive/` fora do pacote de trabalho.

- `/Users/izaakdias/Documents/Leaf-new/reports/` tem ~1.5G, com muitas rodadas intermediarias.
- Preservar os diretorios GO iOS/Android de 2026-05-12.
- Preservar videos finais de review de background location, se ainda forem os corretos.
- Arquivar logs soltos grandes em `/Users/izaakdias/Documents/Leaf-new/reports/*.log`.
- Arquivar screenshots soltas na raiz:
  - `/Users/izaakdias/Documents/Leaf-new/01-driver-app-opened.png`
  - `/Users/izaakdias/Documents/Leaf-new/02-map-loaded.png`
  - `/Users/izaakdias/Documents/Leaf-new/03-online-button-visible.png`
  - `/Users/izaakdias/Documents/Leaf-new/04-driver-online.png`
  - `/Users/izaakdias/Documents/Leaf-new/05-online-confirmed.png`
  - `/Users/izaakdias/Documents/Leaf-new/driver-login-home-ready.png`
  - `/Users/izaakdias/Documents/Leaf-new/ios-auth-login-success.png`
  - `/Users/izaakdias/Documents/Leaf-new/ios-driver-home-after-login.png`
- Arquivar screenshots soltas em `/Users/izaakdias/Documents/Leaf-new/mobile-app/*.png`.

## Legado/Irrelevante - Candidatos A Remocao Com PR Separada

Esses itens parecem fora da superficie atual do app, mas devem ser removidos em uma branch de limpeza com teste depois.

- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/deprecated/`
  - Nao apareceu referencia ativa em `mobile-app/src`, `mobile-app/App.js` ou configs principais na varredura.
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/deprecated/examples/`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/deprecated/components/`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/deprecated/screens/`
- Scripts soltos de teste no mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-*.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-*.cjs`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-*.sh`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/activate-test-user*.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/activate-test-customer.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/build-release-test.sh`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/setup-testflight.sh`
- Backend deprecated:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/deprecated/`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/deprecated/routes/admin-users.js`
- Backend arquivos soltos de teste/simulacao:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/test-*.js`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/stress-test-e2e-rides-*.json`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/test_output.txt`
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/test-receipt.pdf`
- Backend rotas debug:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/routes/auth-routes-debug.js`
  - Remover apenas depois de confirmar que nao e montada em nenhum server/deploy.
- Resultados Maestro antigos:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/`
- Patch antigo:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/APP_LOGIC_BEHAVIOR_DIFF_2026-03-24.patch`
- Scripts temporarios:
  - `/Users/izaakdias/Documents/Leaf-new/scripts/validation/run-wave4-extension-only-temp.sh`
  - `/Users/izaakdias/Documents/Leaf-new/scripts/maintenance/test-server.js`
  - `/Users/izaakdias/Documents/Leaf-new/scripts/maintenance/dashboard-nginx-temp.conf`

## Legado Com Nome Ruim Mas Ativo - Nao Remover Agora

- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-legacy-notification-handlers.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/bootstrap/register-socket-legacy-bridge-handler.js`

Observacao: apesar de "legacy" no nome, ambos aparecem requeridos em `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.js`. So remover depois de migrar os eventos e fechar teste E2E de corrida/chat/notificacao.

## Superficie Publica De Atencao

Esses itens nao sao "lixo local". Eles nao reprovam o app por si so, salvo se forem usados como links oficiais de politica, termos, delecao de conta, suporte ou metadata. Ainda assim, devem ser ajustados antes de expor o dominio publicamente por marca/compliance.

- `/Users/izaakdias/Documents/Leaf-new/landing-page/em-breve.html`
- Links em `/Users/izaakdias/Documents/Leaf-new/landing-page/index.html` que apontam para "Em breve".
- `/Users/izaakdias/Documents/Leaf-new/landing-page/calculadora.html`
  - Contem mencoes a Uber/99 e deve sair da superficie publica antes de loja.
- `/Users/izaakdias/Documents/Leaf-new/landing-page/assets/referencia-files/`
  - Contem arquivos de referencia/concorrentes e nao deve ir para dominio publico final.
- Qualquer copy de loja ou landing mencionando concorrentes, "beta", "em breve", app Android no iOS ou promessas nao entregues.

## Itens Para Revisao Manual Antes De Limpar

- `/Users/izaakdias/Documents/Leaf-new/mobile-app/common/`
- `/Users/izaakdias/Documents/Leaf-new/mobile-app/common-local/`
- `/Users/izaakdias/Documents/Leaf-new/web-app/`
- `/Users/izaakdias/Documents/Leaf-new/services/`
- `/Users/izaakdias/Documents/Leaf-new/deploy-package/`
- `/Users/izaakdias/Documents/Leaf-new/internal-go-live-guide.sh`
- `/Users/izaakdias/Documents/Leaf-new/test-endpoints.sh`
- `/Users/izaakdias/Documents/Leaf-new/provedor-legadokey`
- `/Users/izaakdias/Documents/Leaf-new/provedor-legadokey.pub`

Esses nomes parecem operacionais/legados, mas podem estar ligados a deploy, historico de infra ou scripts de validacao. Nao deletar sem dono definido.

## Ordem Recomendada De Execucao

1. Congelar evidencias GO e criar snapshot antes da limpeza.
2. Fechar dominio final `leaf.app.br` com privacy/terms/support/account deletion em HTTPS 200.
3. Corrigir metadata e URLs oficiais; limpar landing se ela for exposta publicamente ou linkada pelas lojas.
4. Atualizar contas de review em todos os documentos e consoles.
5. Preencher App Privacy e Google Data Safety com inventario real de dados/SDKs.
6. Limpar lixo local gerado: builds, caches, logs, `.DS_Store`, `tmp`, `tmp-evidence`.
7. Arquivar evidencias antigas, preservando apenas pacotes GO.
8. Abrir PR separada para remover `mobile-app/src/deprecated` e arquivos soltos de teste.
9. Rodar release smoke iOS/Android depois da limpeza.
10. Gerar pacote final de assets, screenshots e review notes.

## Fontes Oficiais De Referencia

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple App Privacy Details: https://developer.apple.com/app-store/app-privacy-details/
- Apple Account Deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple Screenshot Specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Google Play Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play Background Location: https://support.google.com/googleplay/android-developer/answer/9799150
- Google Play Account Deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play Preview Assets: https://support.google.com/googleplay/android-developer/answer/9866151
