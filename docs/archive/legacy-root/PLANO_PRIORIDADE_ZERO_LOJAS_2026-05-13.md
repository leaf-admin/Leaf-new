# Plano Prioridade Zero - Submissao App Store e Google Play

Data: 2026-05-13  
Objetivo: levar Leaf para revisao App Store e Google Play com pacote consistente, sem pendencias criticas de loja.

## Decisao Atual

Ainda nao e hora de apertar "submit" publico.

Podemos seguir imediatamente para a etapa final de lojas: fechar dominio/legal, assets, metadata, privacy forms, review accounts, builds finais e smoke via canais oficiais de teste.

Go para submissao so depois de:
- links legais publicos e finais em HTTPS 200;
- App Privacy/Data Safety preenchidos;
- review accounts testadas;
- screenshots/assets finais;
- build iOS via TestFlight e Android via Internal Testing validadas;
- smoke minimo de app instalado pelo canal de loja.

## Bloqueadores Antes Do Submit

### P0.1 - Dominio e links oficiais

- [ ] `leaf.app.br/privacy` ou URL final equivalente respondendo HTTPS 200.
- [ ] `leaf.app.br/terms` ou URL final equivalente respondendo HTTPS 200.
- [ ] `leaf.app.br/delete-account` ou URL final equivalente respondendo HTTPS 200.
- [ ] `leaf.app.br/support` ou URL final equivalente respondendo HTTPS 200.
- [ ] Link de reembolso/politica financeira publicado ou coberto em termos.
- [ ] Nenhum link oficial de loja apontando para `sslip.io`, localhost, ngrok ou pagina temporaria.

Critério de aceite: `curl -I` retorna 200/3xx esperado e o conteudo final bate com o que sera declarado nas lojas.

### P0.2 - Contas de revisao

- [ ] Passageiro de review ativo: `+55 21 10293-8475`, codigo `992111`.
- [ ] Motorista de review ativo: `+55 21 12345-6789`, codigo `992000`.
- [ ] Motorista aprovado e com veiculo ativo.
- [ ] Ambos sem corrida presa, saldo inconsistente ou estado antigo.
- [ ] Documentar passo a passo nas review notes da Apple e no App Access do Google.
- [ ] Validar login em build release limpa antes de enviar.

Critério de aceite: revisor consegue entrar, solicitar/aceitar corrida, abrir suporte e excluir conta sem pedir ajuda externa.

### P0.3 - App Privacy e Data Safety

- [ ] Inventario final de dados coletados:
  - telefone, nome, email quando aplicavel;
  - localizacao precisa;
  - localizacao em background para motorista, se usada;
  - dados de pagamento/transacao;
  - historico de corridas;
  - mensagens de chat/suporte;
  - documentos/fotos de motorista/veiculo se KYC estiver ativo;
  - diagnosticos/crash logs;
  - identificadores tecnicos.
- [ ] Apple App Privacy preenchido.
- [ ] Google Data Safety preenchido.
- [ ] Declarar compartilhamento com provedores necessarios: Firebase/Google, mapas/rotas, Woovi, observabilidade/crash se aplicavel.
- [ ] Confirmar se ha tracking entre apps/sites. Se nao houver, declarar sem tracking.

Critério de aceite: respostas de privacidade batem com o app real, SDKs e politicas publicas.

### P0.4 - Background location

- [ ] Texto de permissao explica uso durante corridas para motorista.
- [ ] Prominent disclosure Android antes da permissao sensivel.
- [ ] Justificativa Google Play Background Location preenchida.
- [ ] Video curto de demonstracao anexado no Play Console.
- [ ] Review notes Apple explicando uso da localizacao do motorista em corrida ativa.

Critério de aceite: o app funciona sem surpresa para passageiro e motorista, e a loja entende por que o motorista precisa de localizacao operacional.

### P0.5 - Assets finais

- [ ] Icone final iOS validado.
- [ ] Icone final Android validado.
- [ ] Splash Android/iOS consistente.
- [ ] Screenshots iOS finais nas dimensoes exigidas.
- [ ] Screenshots Android finais.
- [ ] Feature graphic Google Play.
- [ ] Preview/video apenas se ajudar revisao, sem mocks de QA.
- [ ] Nenhuma screenshot com status "Reconectando", debug, sandbox, em calculo ou dado interno.

Critério de aceite: assets representam o app real e os fluxos principais: cadastro, passageiro, motorista, corrida, navegacao, chat/suporte.

### P0.6 - Metadata de loja

- [ ] Nome, subtitulo/short description e descricao final.
- [ ] Sem "beta", "em breve", "teste", "Android" na App Store ou concorrentes.
- [ ] Explicar claramente operacao no Brasil/Rio quando aplicavel.
- [ ] Precos/taxas descritos onde necessario, sem linguagem tecnica.
- [ ] Categoria correta.
- [ ] Classificacao etaria correta.
- [ ] Contato de suporte correto.
- [ ] Notas de revisao com credenciais, cenario de teste e observacoes sobre pagamento sandbox.

Critério de aceite: um revisor entende o produto em menos de 2 minutos e consegue testar sem improvisar.

### P0.7 - Builds finais por canal oficial

- [ ] Reinstalar dependencias apos limpeza local.
- [ ] iOS Archive release.
- [ ] Upload para TestFlight.
- [ ] Android AAB release assinado.
- [ ] Upload para Internal Testing.
- [ ] Instalar app a partir de TestFlight/Internal Testing, nao via build local.
- [ ] Rodar smoke minimo em ambos.

Critério de aceite: o mesmo artefato que sera enviado para revisao foi instalado e testado.

## Smoke Final Obrigatorio

Executar em iOS e Android a partir dos canais oficiais:

- [ ] Cold start sem crash.
- [ ] Login passageiro com conta de review.
- [ ] Login motorista com conta de review.
- [ ] Motorista fica online com veiculo ativo.
- [ ] Passageiro solicita corrida apenas com motorista disponivel.
- [ ] Motorista aceita.
- [ ] Navegacao interna mostra polyline real e instrucao.
- [ ] Chat em tempo real funciona durante corrida.
- [ ] Suporte abre ticket vinculado a corrida.
- [ ] Corrida inicia e finaliza.
- [ ] Recibo/avaliacao aparecem.
- [ ] Status final sem corrida presa para ambos.
- [ ] Excluir conta acessivel.
- [ ] Links legais abrem corretamente.

Aceite: 1 corrida completa em iOS e 1 corrida completa em Android, usando builds dos canais oficiais, com screenshots/logs/bookingId.

## Pacote De Evidencias Para Revisao

Criar pasta final:

`/Users/izaakdias/Documents/Leaf-new/reports/store-submit-YYYYMMDD/`

Conteudo:
- `app-store-review-notes.md`
- `google-play-review-notes.md`
- `privacy-data-inventory.md`
- `links-check.txt`
- `ios-testflight-smoke.md`
- `android-internal-testing-smoke.md`
- screenshots finais;
- video background location Android, se exigido;
- bookingIds dos smokes finais;
- build numbers e commit SHA.

## Ordem De Execucao Recomendada

1. Fechar links legais no dominio final.
2. Preparar review accounts e resetar estados.
3. Preencher App Privacy/Data Safety.
4. Preparar metadata e review notes.
5. Gerar assets finais.
6. Reinstalar dependencias e gerar builds finais.
7. Subir TestFlight/Internal Testing.
8. Rodar smoke oficial iOS/Android.
9. Montar pacote de evidencias.
10. Submit Apple.
11. Submit Google.

## Go/No-Go

GO para submissao quando todos os P0 acima estiverem fechados e o smoke oficial passar nos dois sistemas.

NO-GO se qualquer item abaixo falhar:
- app crasha em cold start;
- review account nao entra;
- motorista nao fica online;
- corrida nao finaliza;
- links legais falham;
- privacy/data safety incompleto;
- background location sem justificativa;
- build enviada nao foi a mesma testada;
- conta fica presa em corrida ativa;
- pagamento/saldo/repasse diverge no smoke final.

## Gate Estatico Obrigatorio

Antes de considerar GO operacional, rodar:

`node scripts/prelaunch/assert-store-go-static.cjs`

Resultado esperado para prosseguir:
- `Status final: GO para checklist estatico`.
- Zero falhas por host temporario/local (`sslip.io`, `localhost`, `ngrok`, `.local`).
- Zero credenciais antigas de review (`+55 11 99999-9999`, `+55 11 88888-8888`, `teste123`, `Leaf@Review2026!`) em docs/configs de loja.
- URLs legais em HTTPS no dominio final Leaf.
- Flags de QA/review/bypass desligadas no ambiente de preflight e em `eas.json`.
- Permissoes sensiveis Android/iOS coerentes com App Privacy e Data Safety.

Qualquer `FAIL` nesse script e NO-GO para App Store e Google Play, mesmo que os smokes tecnicos passem. `WARN` exige revisao manual e deve virar item no pacote `reports/store-submit-YYYYMMDD/`.

O preflight mobile tambem passa a executar esse gate via:

`bash mobile-app/scripts/store-console-preflight.sh`

## Fontes Oficiais

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple App Privacy Details: https://developer.apple.com/app-store/app-privacy-details/
- Apple Account Deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple Screenshot Specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Google Play Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play Background Location: https://support.google.com/googleplay/android-developer/answer/9799150
- Google Play Account Deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play Preview Assets: https://support.google.com/googleplay/android-developer/answer/9866151
