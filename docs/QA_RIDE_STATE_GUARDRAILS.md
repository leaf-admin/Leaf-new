# Diretiva canonica de QA: fluxo de corrida

## Objetivo

Blindar o ciclo de corrida contra regressao de estado, oscilacao de tarifa, rota sintetica indevida e divergencia financeira entre app, backend, dashboard e recibo.

Este documento e a referencia para smoke real, testes automatizados e analise de evidencia do fluxo passageiro/motorista.

## Premissas obrigatorias

- O teste de corrida sempre precisa de passageiro e motorista disponiveis.
- Passageiro e motorista devem estar na mesma regiao operacional ou a geofence deve estar explicitamente desativada/expandida antes do pagamento.
- Pagamento deve usar sandbox Woovi por flag/usuario de teste, sem virar o app inteiro para sandbox.
- Se o sandbox automatico nao confirmar o Pix, a aprovacao manual pelo dashboard e permitida para validar o fluxo, mas deve ser registrada como excecao.
- A corrida so pode iniciar depois de pagamento confirmado pelo backend.
- O valor bruto do passageiro, o valor do recibo, a taxa Leaf e o liquido do motorista nao podem mudar durante o ciclo da corrida.
- O app nao pode renderizar preco temporario/local quando existe cotacao backend pendente.
- A polyline deve ser unica: sem linha reta temporaria antes da rota real.
- A polyline deve usar segmentos de transito quando o backend retornar essa informacao.
- O transporte Socket.IO deve ser websocket-only no app. Polling recorrente nao e aceitavel como mecanismo normal de estado.

## Estados canonicos

1. `idle`: mapa inicial, sem corrida ativa.
2. `destination_selected`: destino preenchido e rota real aguardada.
3. `quoted`: cotacao backend recebida e congelada ate expiracao.
4. `payment_pending`: Pix criado, corrida ainda nao despachada.
5. `payment_confirmed`: pagamento confirmado pelo backend.
6. `searching_driver`: oferta/despacho em andamento.
7. `accepted`: motorista aceitou.
8. `arrived`: motorista chegou ao embarque.
9. `started`: corrida iniciada.
10. `completed`: corrida finalizada.
11. `rating`: avaliacao disponivel.
12. `receipt`: recibo final.
13. `idle_after_completion`: retorno ao mapa apos avaliacao/recibo.

## Regras de navegacao

- Durante `accepted`, `arrived` e `started`, a corrida e o estado canonico da tela.
- Toque no mapa, backdrop, gesto de drag ou botao de voltar interno nao pode reduzir para mapa puro nem voltar para estado anterior.
- Saida de corrida ativa so ocorre por cancelamento aprovado, incidente de seguranca aprovado ou finalizacao confirmada.
- `completed` deve trocar a superficie para recibo/avaliacao sem permitir retorno para `started`.
- Apos enviar avaliacao, o usuario deve voltar ao mapa em estado limpo.
- Relancar o app apos corrida concluida deve hidratar `idle_after_completion`, nao corrida ativa antiga.

## Testes automatizados obrigatorios

### Unitario/UI mobile

- `prototype-ride-screens`: garantir que sheet ativa bloqueia backdrop e drag em `accepted`, `arrived` e `started`.
- `prototype-ride-screens`: garantir que `completed` navega para recibo e nunca reabre corrida em andamento.
- `prototype-ride-screens`: garantir que avaliacao submetida retorna ao mapa.
- `destination-quote-recalculation`: garantir que tarifa fica oculta enquanto cotacao backend esta pendente.
- `destination-quote-recalculation`: garantir que deriva de GPS nao recalcula a tarifa congelada dentro do bucket valido.
- `prototype-map-route`: garantir que fallback sintetico nao publica linha reta quando rota real e obrigatoria.
- `socket-service-transports`: garantir que nenhum cliente Socket usa `polling`.

### Smoke real Android

O runner deve capturar screenshot, XML, eventos backend e relatorio JSON por etapa:

1. Preflight do device, app e runtime.
2. Leitura de GPS atual e validacao de geofence antes de destino/pagamento.
3. Seed/validacao de motorista disponivel, online, elegivel e na mesma area.
4. Insercao de destino.
5. Aguardar rota real com polyline unica e, quando disponivel, segmentos de transito.
6. Aguardar cotacao backend e confirmar estabilidade do valor.
7. Criar Pix sandbox por usuario.
8. Confirmar Pix pelo backend/Woovi sandbox ou registrar aprovacao manual.
9. Confirmar que dispatch so iniciou apos pagamento confirmado.
10. Aceite do motorista.
11. Teste de regressao por toque no mapa/backdrop durante `accepted`.
12. Chegada ao embarque.
13. Teste de regressao por toque no mapa/backdrop durante `arrived`.
14. Inicio da corrida.
15. Teste de regressao por toque no mapa/backdrop durante `started`.
16. Finalizacao.
17. Recibo.
18. Avaliacao.
19. Retorno ao mapa.
20. Cold relaunch e validacao de estado limpo.

## Evidencia minima

- `real-smoke-report.json`
- `logcat-analysis.json`
- Screenshots e XML por etapa
- Ride id, charge id, passenger id e driver id de teste
- Cotacao backend original
- Valor bruto, taxa Leaf, liquido do motorista e recibo final
- Eventos de pagamento, aceite, inicio, fim e avaliacao
- Consistencia canonica do dashboard para o mesmo ride id, quando a credencial tiver permissao financeira

## Falhas P0

- Pagamento confirmado antes de geofence bloquear regiao.
- Valor de corrida divergente entre cotacao, app, dashboard, recibo ou liquido do motorista.
- Estado visual avancar antes do aceite real do motorista.
- Estado regredir de `accepted`, `arrived` ou `started` para mapa puro.
- Corrida finalizada reaparecer como ativa apos toque no mapa, voltar ou relaunch.
- Polyline reta exibida antes da rota real.
- Polling Socket recorrente em app de producao.

## Falhas P1

- Dados do veiculo incompletos no estado aceito quando existem no cadastro/CRLV.
- ETA de embarque vazio quando backend possui distancia ou tempo.
- Recibo sem dados veiculares ja conhecidos.
- Aprovacao manual de pagamento usada sem registro no relatorio.

## Criterio de aceite

Uma rodada so e considerada fechada quando o relatorio real mostra:

- `criticalCount = 0` em logcat.
- Pagamento confirmado antes do dispatch.
- Motorista aceitou via evento real ou sandbox controlado documentado.
- Nenhuma regressao por toque/backdrop em estados ativos.
- Valores financeiros consistentes ponta a ponta.
- Recibo e avaliacao concluidos.
- App volta para mapa limpo apos avaliacao e apos relaunch.
