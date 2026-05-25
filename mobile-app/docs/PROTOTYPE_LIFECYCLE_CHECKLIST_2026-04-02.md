# Checklist de Lifecycle - Protótipo Robotaxi

## Regras desta bateria
- `MapView` é o background principal. Nenhuma navegação de teste deve depender de atalhos de backend.
- O frontend pilota o lifecycle da corrida.
- Antes de **cada screenshot**, aguardar `15s` para estabilização visual dos simuladores.
- Ordem de execução:
  1. cenário ideal completo
  2. exceções e resiliência

## Dispositivos
- `iPhone 17 Pro`: passageiro
- `iPhone 16e`: motorista

## Cenário Ideal
- [x] `IDEAL-01` Motorista online na home
- [x] `IDEAL-02` Passageiro abre destino e solicita corrida
- [x] `IDEAL-03` Pagamento mock confirmado
- [x] `IDEAL-04` Passageiro entra em `Procurando motorista`
- [x] `IDEAL-05` Motorista recebe oferta
- [x] `IDEAL-06` Motorista aceita corrida
- [x] `IDEAL-07` Motorista marca `Cheguei ao embarque`
- [x] `IDEAL-08` Motorista inicia viagem
- [x] `IDEAL-09` Motorista finaliza viagem
- [x] `IDEAL-10` Recibo aparece no motorista
- [x] `IDEAL-11` Recibo aparece no passageiro
- [x] `IDEAL-12` Passageiro avalia a corrida

## Exceções de Oferta / Matching
- [ ] `EXC-01` Categoria indisponível bloqueada no quote
- [ ] `EXC-02` Solicitação permanece aberta por até `3 min`
- [ ] `EXC-03` Primeira recusa do motorista entra em cooldown
- [ ] `EXC-04` Segunda recusa exclui o mesmo booking para o mesmo motorista
- [ ] `EXC-05` Nenhum motorista disponível leva ao estado final correto

## Exceções de Pagamento / Solicitação
- [ ] `EXC-06` Alterar destino antes do pagamento recalcula quote
- [ ] `EXC-07` Alterar origem antes do pagamento recalcula quote
- [ ] `EXC-08` Valor da corrida congela após criação do booking
- [ ] `EXC-09` Card do motorista nunca mostra valor bruto transitório

## Resiliência de App / Sessão
- [ ] `EXC-10` Relaunch do motorista durante oferta retoma sem flash indevido
- [ ] `EXC-11` Relaunch do motorista durante corrida ativa retoma estado correto
- [ ] `EXC-12` Relaunch do passageiro durante busca retoma estado correto
- [ ] `EXC-13` Relaunch do passageiro no pós-corrida retoma recibo/avaliação

## Navegação / UI
- [ ] `EXC-14` Menu e submenus não quebram contexto do mapa
- [ ] `EXC-15` Sem overlay duplicado em `Procurando motorista`
- [ ] `EXC-16` Sem zoom indevido no motorista durante oferta
- [ ] `EXC-17` `Voltar ao mapa` limpa corretamente overlays e polylines residuais

## Registro desta rodada
- Build: release iOS de simulador recompilada e instalada nos dois devices
- Artefatos:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/02-passenger-request-passenger.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/02-passenger-request-driver.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/03-driver-accept-passenger.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/03-driver-accept-driver.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/04-driver-arrived-passenger.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/04-driver-arrived-driver.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/05-driver-start-passenger.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/05-driver-start-driver.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/06-driver-complete-passenger.png`
  - `/tmp/leaf-continue-20260403-driver-receipt-final/driver.png`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/.maestro/results/lifecycle_ideal_20260403_105224/07-passenger-rate-passenger.png`
  - `/tmp/lifecycle-ideal-step01-driver-online-driver-145619.png`
  - `/tmp/lifecycle-ideal-step01-passenger-home-145619.png`
  - `/tmp/lifecycle-ideal-step02-passenger-request-145654-passenger.png`
  - `/tmp/lifecycle-ideal-step02-passenger-request-145654-driver.png`
  - `/tmp/lifecycle-ideal-step03-driver-accepted-passenger-150136.png`
  - `/tmp/lifecycle-ideal-step03-driver-accepted-driver-150136.png`
  - `/tmp/lifecycle-ideal-step04-driver-at-pickup-150411.png`
  - `/tmp/lifecycle-resume-step04-passenger.png`
  - `/tmp/lifecycle-resume-step04-driver.png`
  - `/tmp/lifecycle-resume-step05-passenger.png`
  - `/tmp/lifecycle-resume-step05-driver.png`
  - `/tmp/lifecycle-resume-step06-passenger.png`
  - `/tmp/lifecycle-resume-step06-driver.png`
  - `/tmp/lifecycle-resume-step07-passenger.png`
  - `/tmp/lifecycle-resume-step07-driver.png`
  - `/tmp/short-run-search-passenger.png`
  - `/tmp/short-run-offer-driver.png`
  - `/tmp/started-map-passenger-after-fix.png`
  - `/tmp/started-map-driver-after-fix.png`
- Resultado do cenário ideal:
  - passou de ponta a ponta até recibo e avaliação usando gatilhos de frontend para aceite, chegada, início, conclusão e rating
  - o runner iOS deixou de depender do passo instável do Maestro no motorista; as etapas `accept`, `arrive`, `start` e `complete` agora são acionadas por deep link frontend direto
  - `IDEAL-07`, `IDEAL-08` e `IDEAL-09` passaram em execução real na mesma corrida
  - `IDEAL-10`, `IDEAL-11` e `IDEAL-12` passaram com recibo e submissão de avaliação no passageiro, e com recibo financeiro correto no motorista
  - o aceite do motorista deixou de crashar o app no simulador
  - o enquadramento do mapa do passageiro em `em viagem` foi corrigido; o mapa voltou a mostrar a área local da corrida em vez de abrir a baía inteira
  - o recibo do motorista foi corrigido para exibir `Ganho líquido R$ 15,01`, `Bruto R$ 16,50` e `Taxas R$ 1,49`
  - findings ainda abertos após essa rodada:
    - passageiro continua exibindo `R$ 16,50` no card durante a corrida
    - o mapa do motorista em `em viagem` ainda merece revisão fina de enquadramento/zoom
- Próximo item a validar:
  - validar exceções da oferta e matching
  - revisar o enquadramento do mapa do motorista em `started`
  - decidir se o card do passageiro em `em viagem` deve continuar mostrando bruto contratual ou outra apresentação
