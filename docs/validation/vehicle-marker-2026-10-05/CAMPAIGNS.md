# Cor cadastrada e formatos de campanha — 05/10/2026

## Objetivo

Usar no mapa a cor do veículo registrado e permitir substituir o desenho por campanhas de marketing, mantendo o movimento, orientação e rota já implementados.

## Escopo concluído

- A identidade da viagem vem dos payloads Leaf. Para o motorista fora de viagem, a cor do veículo ativo no catálogo/estado de ativação tem prioridade sobre o perfil antigo. Durante uma viagem, prevalece o veículo da viagem.
- Selecionar ou editar um veículo pelo fluxo existente atualiza o estado remoto de ativação, sem mudar as exigências de aprovação ou de operação offline.
- O mesmo SVG atende home, ofertas, viagem do passageiro e viagem do motorista, inclusive marcadores próximos e overlays projetados iOS/Android. O mapa compartilhado continua usando Google Maps.
- Treze famílias de pintura: preto, branco, prata, cinza, vermelho, azul, verde, amarelo, marrom, bege, laranja, roxo e rosa. Aceita nomes PT/EN e variantes como branca/preta/vermelha. A paleta representa a família de cor, não uma amostra exata da pintura física. Informação ausente/desconhecida usa o fallback grafite.
- Registro de formatos vetoriais: `leaf_vehicle` e `halloween_pumpkin`. Outros formatos podem usar o upload PNG/WebP já existente, sem uma nova implementação por campanha.
- O painel permite escolher formato ao criar a campanha e trocar o formato de campanhas existentes. Criar mantém status pausado. Imagem personalizada tem seu próprio caminho; um desenho vetorial escolhido não é sobrescrito por uma URL antiga.
- Marcadores novos não têm teto de impressões que faça o desenho desaparecer depois de alguns acessos; banners continuam com sua validação/limites anteriores. Impressão é registrada por campanha, usuário e arte.
- Backend continua governando status, público, prioridade, início/fim e feature flags. As datas são incluídas no payload/cache para o app retirar a arte ao encerrar a janela, inclusive com o mapa aberto e sem rede.
- Campanha desabilitada na consulta seguinte, cache vencido, chave desconhecida e falha de imagem usam o carro padrão. Troca de usuário/papel e respostas antigas não vazam a arte anterior. Voltar ao foreground consulta a configuração novamente; não foi acrescentado polling.

## Como operar no Campaign Center

1. Selecionar **Mapa da corrida — marcador de veículo** (`ride_map` / `vehicle_marker`).
2. Informar nome interno e público. Selecionar **Carro · cor do veículo cadastrado**, **Halloween · abóbora** ou **Imagem personalizada**.
3. Para personalizadas, enviar PNG/WebP transparente, idealmente 512×512, sem texto. Centralizar no mesmo frame, manter a frente para cima e respeitar a margem segura do slot. O app orienta a arte pela direção no mapa.
4. Definir início/fim e prioridade. Revisar com a campanha pausada e ativar pela ação existente quando desejado.
5. Na tabela, o seletor **Formato no mapa** troca os desenhos já incluídos. Para uma nova imagem, criar uma campanha com a arte e sua janela, usando o fluxo existente.
6. Pausar/encerrar a campanha restaura o carro padrão. Uma alteração de configuração chega na próxima consulta do app; não é um push imediato para um mapa já aberto. O fim agendado conhecido pelo app tem timer local.

O carro padrão segue a cor cadastrada. A abóbora e imagens promocionais têm as cores do criativo; a identidade real do veículo continua sendo exibida nos dados da viagem.

### Adicionar um formato vetorial no futuro

Implementar o SVG e registrar sua função em `VEHICLE_MARKER_SHAPES` em `leafVehicleArtwork.js`, mantendo frame 64×64, centro 32×32 e tamanho de uso 42 pt. Expor a chave no catálogo do slot/backend e no fallback do seletor do painel. Um novo vetor incluído exige disponibilizar esse JS ao app (OTA compatível ou release); uma imagem personalizada não exige alterar o código após este suporte estar distribuído. Clientes com chave desconhecida mantêm o carro padrão.

## Arquivos alterados

Mobile:

- `src/components/prototype/leafVehicleArtwork.js`: paletas, registro de formatos e vetor da abóbora.
- `src/components/prototype/LeafVehicleMarker.js`: seleção da arte vetorial.
- `src/components/prototype/vehicleMarkerIdentity.js`: prioridade da identidade/cor registrada.
- `src/components/prototype/PrototypeMapLayer.js`: shape em todos os marcadores, aliases de cor, recuperação de falha de imagem e atualização do marcador nativo.
- `src/hooks/useCampaignAssetOverride.js`: formatos sem upload, sessão, cache/respostas, foreground e expiração.
- `src/services/runtime/campaignCenterService.js`: preservação de início/fim.
- `src/screens/prototype/RobotaxiHomeScreen.js`, `RobotaxiTripScreen.js`, `RobotaxiDriverOfferScreen.js`, `RobotaxiDriverTripScreen.js`, `RobotaxiVehiclesScreen.js`: integração com cor canônica/formato e atualização do catálogo selecionado.
- `__tests__/leaf-vehicle-artwork.test.js`, `vehicle-marker-identity.test.js`, `campaign-vehicle-asset.test.js`, `campaign-center-service.test.js`, `prototype-map-layer-viewport.test.js`, `prototype-new-surfaces.test.js`: desenho, cores, seleção, cache, janela, sessão, falha e integração.

Backend/dashboard:

- `leaf-websocket-backend/services/campaign-center-service.js`: catálogo de formas e janela no payload do app.
- `leaf-websocket-backend/tests/unit/services/campaign-center-service.unit.test.js`: público, agendamento, pausa e atualização de formas.
- `leaf-dashboard-js/app/campaign-center/page.js`: seletor, atualização, upload e payload de marcador.
- `leaf-dashboard-js/scripts/tests/campaign-marker-contract.cjs`: executa os predicados/construtores reais do formulário e verifica payloads e permissões, sem rede.

Evidências: gerador `build-review.cjs`, `review.html`, `review-campaign-pumpkin.jpg`, `review-campaign-detail.jpg`, `review-campaign-silver.jpg`, `validation-results-campaigns.json` e este relatório. O relatório anterior conserva a evidência das revisões anteriores do desenho.

## Testes executados

- Mobile completo: **180 suítes / 1.507 testes PASS**, 47,452 s (`npm --prefix mobile-app run test:unit -- --runInBand`).
- Backend direcionado: **5 suítes / 68 testes PASS**, 1,292 s. Campanhas/rotas, identidade do veículo, elegibilidade e estado de ativação.
- Dashboard: contratos de suporte/KYC/roles PASS; lint PASS; build de produção webpack PASS; contrato de marcador PASS; smoke de navegação PASS, com chamadas aos provedores pagos bloqueadas pelo teste existente.
- `qa:backoffice` foi iniciado pelo comando padrão. No worktree, foi necessário vincular as dependências já instaladas no checkout principal. O build webpack passou; o smoke padrão Turbopack não aceitou o symlink externo. O mesmo smoke passou usando webpack e o Chrome instalado, pois o Chromium de testes estava ausente. Nenhuma dependência ou configuração do produto foi alterada para isso.
- `git diff --check`, `governance:check`, scanner de segredos tracked, guard de segredos e `qa:production-guards` PASS.
- `config:validate` foi executado: **não valida o runtime**, pois o worktree isolado está sem `.env` e faltam campos Woovi. Nenhuma credencial foi carregada; este resultado não é evidência de configuração de produção.

## Evidência e limites

[Prévia interativa local](http://127.0.0.1:64005/review.html) usa o vetor e a geometria extraídos do código, com seleção de cor/formato e oito direções. O mapa é uma referência estática e as posições são ilustrativas. Não é evidência de GPS, booking ou campanha em produção.

Testes de unidade verificam a cor chegando ao SVG, troca de cor/formato, falha do upload, atualização do catálogo, parser nativo SVG e expiração com a tela montada. Não foi executada uma corrida real/dispositivo físico para este ajuste. Campanhas existentes não foram publicadas nem alteradas remotamente.

## Riscos

- O suporte precisa estar distribuído no JS do app e no dashboard/backend para a operação usar todos os novos controles/datas. Os candidatos IPA/APK/AAB anteriores não foram reconstruídos.
- Após pausa/troca no painel, um mapa já aberto recebe a alteração na próxima consulta; fim agendado já recebido é removido localmente.
- Criativo personalizado precisa de transparência, centro e orientação corretos; imagem de baixa qualidade continuará baixa mesmo rotacionada. Falha de download retorna ao SVG.

## Rollback

Pausar a campanha pelo fluxo existente devolve o carro padrão após nova consulta; o fim da janela também faz isso. Para rollback de código, reverter somente o commit deste bloco na branch `codex/vehicle-marker-refinement`, retornando à revisão V2 (`a376af3e0`), sem reverter as correções anteriores de movimento. No checkout principal, restaurar apenas estes arquivos para suas versões anteriores, preservando o índice e alterações de outras tarefas.

## Fora do escopo

Tarifa, Pix, split, saque, KYC, lógica da viagem, requisições pagas de mapa, deploy de produção, publicação de campanha, builds e submissões às lojas. Fonte permanece React Native; nada de OpenCode/Maestri ou migração nativa.
