# Plano de escala e proteção do banco Leaf

Data: 25/10/2026, São Paulo. Base inspecionada: `6f69baf23`, branch `codex/driver-navigation-map-visibility`.

## Objetivo e limites

Eliminar dependência do histórico global e de varreduras globais nos fluxos críticos, limitar trabalho por requisição/ciclo e impedir que consultas administrativas prejudiquem corridas. Preservar Pix, ledger, taxas, promoção, KYC, recibos e isolamento sandbox/operacional.

Este é um plano, não uma implementação nem uma comprovação de capacidade. Inspeção estática do checkout local; nenhuma credencial de produção usada, banco consultado, configuração implantada ou teste de carga executado nesta revisão. O código implantado e os índices/configurações efetivamente ativos ainda precisam ser verificados em etapa separada autorizada.

Manter Redis, Firestore e RTDB inicialmente. Usar serviços, outbox, workers e ferramentas já existentes; sem novas dependências, serviços, cron jobs ou workers neste plano. Nenhum executor externo/delegação autorizado.

Complexidade abaixo descreve trabalho e volume transferido pelo código da aplicação, não uma promessa sobre os algoritmos internos do Firebase. Variáveis: A=corridas ativas; D=motoristas; R=histórico de corridas; V=veículos; H=recibos de um usuário; S=buscas ativas; K=registros da área consultada; P=tamanho de página.

## Evidência e classificação

| Achado | Evidência local | Situação |
| --- | --- | --- |
| Recibos baixam H, ordenam e recortam | `leaf-websocket-backend/services/receipt-service.js:925`; rota `routes/receipts.js:330` | Rota registrada; O(H) transferência e O(H log H) ordenação, mesmo página pequena |
| Localização percorre bookings:active quando falta vínculo | `bootstrap/register-socket-update-location-handler.js:701` | Fallback de fluxo crítico; O(A) por localização nessa condição. Normal usa índice direto, habilitado por padrão no código |
| H3 coleta buscas e viagens globais antes de filtrar bbox | `services/h3-map-service.js:618`, `:776`, `:843` | Serviço usado por rota de mapa; cache reduz frequência, não crescimento do miss |
| Cache H3 cresce com chaves distintas e não possui teto | `services/h3-map-service.js:454`, `:490` | Expiração remove apenas a chave relida; dados de viewports não revisitados podem permanecer em memória |
| Listagem completa de motoristas faz scans aninhados | `routes/dashboard/08-driver-plans-and-status.js:70`, `:84`, `:278` | Rota registrada, O(D×(R+V)), paginação no fim. Não foi encontrada chamada dela na tela principal de motoristas atual; não tratar como todo uso do dashboard |
| Métricas modernas leem corridas do período; fallbacks leem raiz RTDB | `services/modern-metrics-service.js:228`; `routes/metrics.js:241`; `routes/dashboard/03-overview-stats.js:231` | Fluxo registrado; O(R do período) ou O(R global) no fallback. Auditoria também lê todos os logs selecionados (`services/audit-service.js:466`) |
| GPS lista todos os IDs pendentes e escolhe prefixo fixo | `services/trip-location-persistence-service.js:881`, `:924` | Worker existente usa limite padrão 200/ciclo, um chunk por viagem; sem cursor justo. Risco de postergação precisa ser reproduzido, não já medido |
| Ciclos de flush podem sobrepor-se | `workers/worker-trip-location.js:69` | setInterval async sem guarda de ciclo; lock por viagem existe, mas não elimina sobreposição de seleção/ciclos |
| KEYS em cache administrativo | `utils/advanced-cache.js:100`, `:293`; `bootstrap/register-http-routes.js:67` | Rota /cache registrada. KEYS varre o keyspace inteiro. SCAN em loop até cursor zero também continua O(N) no total |
| Paginação acumulativa | `utils/firestore-pagination.js:28`, `:108` | Código ineficiente, mas sem chamadas ativas encontradas. Não atribuir a ele o custo atual dos recibos |
| Histórico completo no DataLoader GraphQL | `utils/optimized-dataloader.js:237` | Referência em resolver GraphQL; GraphQL aparece desabilitado no bootstrap. Guardar como risco de reativação, não gargalo operacional comprovado |

## Critérios globais

1. Nenhuma ação GPS, aceite, chegada, início, pagamento ou encerramento depende de ler todos os usuários, corridas, recibos ou chaves do Redis.
2. Toda consulta recebe orçamento explícito de registros, bytes, tempo e concorrência. Um timeout de cliente não interrompe necessariamente uma operação no servidor: eliminar a operação ruim, não apenas envolvê-la em Promise.race.
3. Índices de consulta são derivados; backend/estado financeiro continuam autoridade. Resultado parcial ou desatualizado deve ser indicado, sem inventar saldo, total, disponibilidade ou conclusão.
4. Fallback não pode ficar mais caro justamente quando um serviço falha. Usar recuperação específica, última projeção válida identificada ou erro explícito conforme o domínio.
5. Não mudar frequência/amostragem GPS, retenção legal/financeira ou regras comerciais para passar teste de desempenho.
6. Separar carga das corridas e consultas administrativas por limites e concorrência. Nova instância/replica/cluster só se medições posteriores justificarem; não assumir que outro banco lógico Redis fornece isolamento de CPU.
7. Cursor e toda projeção devem respeitar proprietário, role e namespace financeiro; índices não ampliam autorização.

## Etapa 0 — baseline e ensaio reproduzível

Antes dos PRs funcionais, mapear chamadas e métricas existentes e preparar fixtures sintéticas determinísticas. Nenhum benchmark aponta para endpoints/chaves de produção por padrão; Redis local separado, Firebase Emulator e rede de provedores bloqueada. Revisar os scripts de carga existentes antes de executá-los: alguns testes antigos usam o ambiente compartilhado.

Registrar versão do código, Redis, Node, limites de CPU/memória, número de processos, dataset, semente, frequência GPS, concorrência, aquecimento e duração. Métricas: p50/p95/p99 de ações e consultas; comandos/bytes Redis por ação; leituras/escritas Firebase; atraso de localização; idade máxima dos buffers; lag/pending de streams; event-loop lag; CPU/RSS; erros/retries; hit/miss/evicções/freshness. Sem labels de alta cardinalidade como bookingId/userId.

Matriz sintética proposta, ampliada gradualmente e interrompida por limites do laboratório:

- D e A: 100, 1.000, 10.000; cargas combinadas e distribuição concentrada/dispersa. A é subconjunto de motoristas, não somar cenários impossíveis.
- GPS: mesma frequência efetiva do sistema, cenário inicial de referência 1 Hz; 10.000 ativos significam 10.000 eventos/s simulados, não capacidade prometida.
- R: 1.000, 100.000, 1.000.000 registros sintéticos; H: 10, 1.000, 10.000 por usuário; S: escalonado conforme carga.
- Área H3 fixa com K constante enquanto cresce a base fora da área; muitas áreas distintas para estressar cache.
- Concorrência administrativa 1/5/20 leitores, com limites de tráfego; mistura com ações críticas.
- Bordas do flush: 199/200/201/1.000 viagens pendentes, algumas sempre produzindo pontos e outras chegando depois.

SLOs de latência e limites de escrita serão fechados a partir do baseline no hardware declarado. Gate inicial proposto: nenhuma regressão superior a 10% de p95/p99 das ações críticas sob a mesma carga; sem crescimento contínuo de backlog em carga sustentada abaixo da capacidade medida. A 10× de histórico irrelevante, página fixa não deve ler 10× dados. Contagens de operação/limites são gates determinísticos; tempos precisam de repetição.

Entregável: tabela antes/depois, fixtures, comandos seguros, custos por ação e teto de capacidade observado, sem extrapolar um laptop para Santiago.

## PR 1 — contenção de trabalho e cache (P1)

Arquivos prováveis: `utils/advanced-cache.js`, `utils/redis-scan.js`, `routes/cache-monitoring.js`, `services/h3-map-service.js`, métricas existentes e testes.

- Substituir KEYS de caminhos acessíveis por índices/counters ou SCAN com cursor persistente entre páginas/ciclos, limite de tempo/bytes e cancelamento. Não trocar KEYS por um loop que acumula todo o keyspace antes de responder.
- Invalidar namespaces em lotes; não fazer DEL com lista sem limite. Preservar compatibilidade de invalidação e TTL.
- Teto de entradas e bytes aproximados no cache H3, remoção efetiva de expirados com trabalho limitado e política de evicção; reaproveitar estruturas existentes.
- Coalescer requisições simultâneas equivalentes, limitar cálculos H3 concorrentes. Não arredondar bbox alterando contrato visual ou cobertura sem testes.
- Proteger endpoints administrativos com limites por classe/concorrência usando middleware existente; conferir autenticação já aplicada antes de qualquer alteração.

Aceite: chamadas de monitoramento/invalidação não executam KEYS; cache permanece no teto após dezenas de milhares de viewports distintos e expiração; carga administrativa não desencadeia varredura global nem explosão de concorrência. Cache correto e sem vazamento entre escopos.

Rollback: desativar apenas a nova política de cache/projeção ou reduzir concorrência; nunca restaurar KEYS irrestrito como mecanismo automático de emergência. Dados persistentes não mudam.

## PR 2 — vínculo motorista/corrida sem varredura GPS (P1)

Arquivos: `utils/active-trip-index.js`, `bootstrap/register-socket-update-location-handler.js`, transições de aceite/início/reassociação/fim e testes.

- Auditar todos os escritores/limpadores do vínculo, incluindo crash, reconnect, TTL, cancelamento e reassociação; manter validação backend de motorista/corrida/lease.
- Tirar HGETALL bookings:active do caminho por localização. Recuperar pelo vínculo/lease/hash específico validado; coordenar reparo idempotente usando fluxo/worker existente e orçamento limitado.
- Estado inconclusivo não pode associar posição à corrida sugerida pelo cliente, encerrar viagem, mudar KYC ou descartar silenciosamente dados essenciais. Definir comportamento explícito: sinalizar reconexão/recuperação, manter apenas o dado validável e reparar com segurança.
- Hashes de booking com rota grande: avaliar HMGET dos campos necessários no caminho frequente; mudanças apenas após provar que todos os campos críticos continuam presentes.

Aceite: teste com 100/1.000/10.000 corridas e índices ausentes prova número limitado de consultas por fix, sem leitura global. Cobrir índice stale, corrida errada, corrida encerrada, perda de Redis, corrida concorrente com KYC e recuperação após crash. Nenhuma posição enviada a passageiro de outra corrida.

Rollback: manter schema compatível e voltar à última versão segura do índice; em falha, modo limitado de recuperação com sinalização. Não recolocar scan global em cada fix. Risco principal: consistência, não só latência.

## PR 3 — GPS com fila justa e pressão controlada (P1)

Arquivos: `services/trip-location-persistence-service.js`, `workers/worker-trip-location.js`, `workers/WorkerManager.js` apenas se necessário, finalização e testes.

- Substituir SMEMBERS + slice(0,200) por seleção justa incremental, preferencialmente estrutura ordenada por próximo vencimento e claim/ack/reschedule atômicos no Redis existente. Escolha final depende da reprodução do problema; SSCAN COUNT é sugestão e não limite rígido de retorno.
- Lotes limitados por viagens, pontos, bytes e tempo. Recuperação de índice incremental; sem scan completo frequente.
- Evitar sobreposição de ciclos; concorrência de persistência pequena, medida e limitada. Claim com token/lease e tratamento de renovação/expiração para retries lentos.
- Ack/descarte do buffer somente após confirmação durável, com IDs de chunk determinísticos/idempotentes. Não cortar streams/buffers com dados não persistidos para obter memória estável.
- Revisar LRANGE sem limite na reconstrução excepcional: usar metadados canônicos e chunks/páginas limitadas. Resumo incompleto não vira valor financeiro inventado; manter revisão/erro conforme contrato atual.
- Medir idade máxima, taxa de entrada/saída, retries e backlog; usar health/degradação existentes. Definir reação quando entrada excede capacidade sem amostrar/perder GPS por decisão não aprovada.

Aceite: justiça comprovada acima de 200 viagens; todas atendidas dentro do orçamento definido. Crash entre gravar/ack, Redis reconnect, Firestore indisponível/lento, duplicatas/fora de ordem e encerramento durante flush não perdem pontos nem duplicam chunks. Testar drenagem posterior e não sobreposição. Dinheiro/pedágio/counter iguais ao oráculo canônico.

Rollback: leitor compatível com buffers novos e antigos, manter drains/ack existentes enquanto fila esvazia; só trocar seletor após conciliação. Nunca apagar fila para reverter.

## PR 4 — H3 regional (P1)

Arquivos: `services/h3-map-service.js`, `services/booking-search-index.js`, `services/pricing-h3-read-model-service.js` se semanticamente compatível, escritores de lifecycle/localização e testes.

- Verificar se o read model H3 já existente atende disponibilidade, demanda e viagens ativas exigidas pelo mapa. Reusar o que for equivalente; não confundir contagem de preço com mapa individual de corridas.
- Consultar células/região e dados necessários do viewport; tirar HGETALL global de viagens e leitura global de buscas da geração normal do mapa.
- Atualizar índices nas transições existentes com operações idempotentes, movimento entre células, TTL/freshness e namespace. Reparo limitado no processamento existente.
- Limitar células, membros, payload e orçamento GEO. Se exceder cobertura, agregar/coarsen conforme contrato; nunca omitir arbitrariamente os primeiros N e apresentar mapa completo.
- Dado stale/índice ausente deve resultar em sinalização ou cache antigo identificado, sem voltar a scan global; política de preço permanece inalterada.

Meta: custo proporcional às células e dados relevantes (K), não a todas as viagens fora da área. GEO com COUNT limita resultado, mas não garante custo constante no servidor em região densa: incluir esse caso no benchmark.

Aceite: K constante com base externa 10×/100× não multiplica leitura de registros externos. Testar fronteiras, movimento, terminal, dados duplicados, expiração e reconciliação. Comparar resultado com oráculo de scan apenas no laboratório. Contrato mobile/dashboard preservado.

Rollback: projeção aditiva com versão; leitor anterior apenas em ambiente/volume controlado, sem habilitar scan ilimitado como fallback em pico. Durante falha, mapa pode sinalizar indisponibilidade sem comprometer corrida.

## PR 5 — recibos por usuário/data com cursor (P1)

Arquivos: `services/receipt-service.js`, `routes/receipts.js`, persistência de recibos, cliente de histórico, `config/firebase/database.rules.json`/índices se necessário e testes.

- Criar projeção pequena de listagem por proprietário, role, namespace e chave ordenável data+rideId; guardar detalhes canônicos no registro atual, sem copiar mapa/base64 para cada item.
- Paginação keyset com cursor vinculado ao escopo e desempate estável. Compatibilidade com offset durante transição deve ser explícita e limitada, sem ler histórico inteiro escondido.
- Escrita idempotente a partir da mesma finalização/outbox atual; suporte a recibo corrigido/versionado sem duplicação. Não alterar valores, totais, acesso ou isolamento sandbox.
- Leitura de página deve buscar até P+1 resumos (ou orçamento documentado) e detalhes só quando necessário. Total exato global é decisão de contrato: manter via projeção reconciliável ou apresentar total disponível conforme UX aprovada, não fabricar contagem.
- Registros antigos precisam de backfill por lotes com checkpoint, dry-run, estimativa de leitura/escrita e retomada. Não ocultar histórico por ativar índice vazio. Migração somente após paridade.

Aceite: H=10/1.000/10.000, página fixa tem volume aproximadamente fixo; sem repetição/perda entre páginas em ordem estável, datas iguais, novas entradas/correções e cursor inválido. Recibo continua acessível por dono/role/contexto correto; backend impede enumeração de terceiros.

Rollback: escrita dupla temporária, formato anterior preservado; troca de leitura por versão, com limites. Backfill nunca altera recibo financeiro original.

## PR 6 — listagens administrativas sem produto cartesiano (P2)

Arquivos: `routes/dashboard/08-driver-plans-and-status.js`, serviços de listagem existentes e testes dashboard/backend.

- Primeiro eliminar loops aninhados: indexar carros e agregar corridas uma vez por leitura já autorizada. Reduz CPU para O(D+R+V), mas isso ainda não é solução final de I/O.
- Página/filtros aplicados no armazenamento/projeção antes da hidratação. Estatísticas por motorista e veículo por vínculo direto; usar outbox/eventos existentes para manter resumos se não houver projeção equivalente.
- Evitar N+1 sequencial e Promise.all sem limite: hidratação em batch pequeno; totais/filtros conforme contrato. Não somar valores financeiros legados sem fonte final/ledger.
- Confirmar consumidor real de cada rota antes de investir; não excluir legado sem autorização. UI principal de drivers atual tem caminho distinto: testar os dois sem presumir que /drivers/complete é a tela principal.

Aceite: página de 50/200 não lê todas as corridas. Aumentar D/R/V não transforma CPU em D×R. Fixtures validam filtros, autorização, classificação e valores anteriores, inclusive legado/sandbox. Sem mudança de plano/taxa.

Rollback: manter endpoint/contrato e projeção aditiva; oferecer dados de estatísticas com freshness/erro explícito quando necessário. Não restabelecer consulta global ilimitada em pico.

## PR 7 — métricas agregadas e legado sob controle (P2)

Arquivos: `services/modern-metrics-service.js`, `services/audit-service.js`, relatórios e métricas existentes, rotas dashboard/metrics, outbox e testes.

- Inventariar resumos já existentes antes de criar novos. Agregações por dia/região/dimensões realmente usadas, de fonte canônica; namespace explícito. Atualizar pelo processamento/outbox existente, idempotente por evento+versão.
- Nada de documento global recebendo todos os eventos sem avaliar contenção. Particionar por período/região e adicionar shards apenas se throughput medido exigir.
- Auditar ciclo de vida de hashes, streams, chunks e índices órfãos: estimar bytes por corrida e retenção; conferir se a expiração realmente está configurada, não apenas se existe campo expiresAt. O checkout não comprova políticas TTL/índices ativos no Firebase. Preservar retenção financeira/operacional atual; qualquer alteração de retenção ou console exige decisão separada. Reutilizar limpeza existente com lotes limitados.
- Tratar retries, cancelamento, estorno, correção e evento tardio com a regra atual. Resumos de receita/saldo não substituem ledger; reconciliar contra a fonte final.
- Queries de período leem buckets/índices, sem carregar todas as corridas/logs. Relatórios detalhados usam cursor/streaming limitado. Requests arbitrários têm janela/orçamento explícitos, sem cortar dados silenciosamente.
- Remover fallback RTDB global de fluxos frequentes; falha retorna projeção identificada como stale ou erro, sem publicar zero como se fosse resultado real. Backfill diário incremental, controlado.
- Utilitário de paginação sem consumidores e DataLoader GraphQL desabilitado: registrar contrato/testes para impedir reativação com leitura integral; corrigir cursores ao adotar. Não renomear/apagar legado nesta iniciativa sem autorização.

Aceite: tamanho de resposta/trabalho de um mês depende de buckets/dimensões, não de número de corridas do mês. Replay/duplicação de eventos não altera total; soma confere com fontes financeiras e timezone de São Paulo. Sem novo job e sem aumento de leitura a cada refresh do dashboard.

Rollback: projeções versionadas, dupla conferência temporária em amostra limitada; preservar eventos/checkpoints. Retorno ao caminho antigo somente com orçamento restrito e fora de pico, nunca scan irrestrito automático.

## PR 8 — integração, carga mista e preparação de rollout

Dependências: PRs 1–7 aceitos localmente; cada PR já traz seu teste de complexidade. PR 2 e PR 3 precisam estar seguros antes de aumentar volume de localização; PR 1 antes do ensaio H3 com alta concorrência. Esquemas de PRs 4/5/6/7 são definidos antes de qualquer backfill.

- Repetir matriz da etapa 0 no mesmo hardware/dataset. Testes mistos: GPS e transições de corrida concorrentes com relatórios/cache/H3. Injetar perda de índice, cache frio, Firestore lento/indisponível, Redis reconnect, término concorrente, reinício e retries.
- Primeiro smoke, depois degraus, carga sustentada de 30–60 min e burst/recuperação com limites. Interromper antes de swap/OOM/disco crítico. Resultados por degrau, não apenas média ou melhor janela.
- Exigir zero divergência financeira/namespace e zero perda de telemetria após drenagem. Backlog e RSS precisam estabilizar; fairness e tempo de recuperação definidos por cenário. Relatar a faixa em que o sistema satura, não só o último cenário aprovado.
- Testes de contagem de comandos provam independência do histórico global; profiling de latência complementa, não substitui.
- Medir custo incremental: documentos lidos/escritos por corrida, atualização GPS, recibo e refresh; índice/armazenamento/TTL. Simulação e emulador não validam cobrança nem plano de execução real do Firebase. Orçamento total aprovado antes de testar em ambiente pago.

Validação mínima por mudança: `git diff --check`, `npm run governance:check`, scan tracked-only e secret guard; backend `config:validate` e testes unitários. Mudanças mobile: guards e suíte mobile. Dashboard: qa:backoffice/lint/build/smoke com ambiente suportado. Redis real local/Firebase Emulator para atomicidade e consultas; testes de unidade com mock não provam throughput nem indexação.

## Rollout e autorizações separadas

1. PRs pequenos, em branches codex próprias; esta iniciativa não entra no PR de navegação #424. Revisão por diff e evidência específica de cada domínio.
2. Izaak autorizou a implementação após a revisão deste plano. Essa autorização cobre código e testes locais; não autoriza consultas com credenciais, deploy, Firebase console/índices/TTL, backfill, migração de dados ou teste de carga em serviço real.
3. Quando aprovados implementação e staging/local, preparar pacote de release concreto com hashes, versões, schemas, índices, estimativa de leitura/escrita, limites de lote, dry-run e runbook; pedir autorização apenas para as operações externas necessárias.
4. Projeções aditivas/versionadas e compatibilidade reversa primeiro; writers, backfill limitado com checkpoint e verificação de paridade; ativação de leitores depois. Sem duplicar cobrança, consumo promocional ou efeitos de negócio no backfill.
5. Deploy por ação autorizada, a partir de main limpo, seguindo runbook Santiago. Não assumir feature flag existente: nova configuração deve ter defaults seguros e validação.
6. Ativação gradual por superfície/coorte com métricas e critérios de abortar; sem validação em sombra que dobre consultas globais. Downgrade de relatório/mapa não pode interromper pagamento/encerramento/localização.
7. Reversão testada por PR e por versão de schema. Preservar dados e drains; nunca resetar Redis, apagar filas, remover índices usados ou restaurar fallback ilimitado para ganhar tempo.

## Critério de conclusão da iniciativa

- Todos os achados acima têm correção validada ou classificação explícita de caminho inativo com proteção contra reativação; nenhum item desaparece do plano por não afetar o volume atual.
- Nenhum scan global na requisição crítica, recibos paginados de verdade, fila GPS justa, H3 regional, caches limitados, relatórios/listagens independentes do histórico por refresh.
- Tabela antes/depois, custo por ação, capacidade observada e comportamento na falha documentados. Nenhuma promessa de volume sem teste em hardware e infraestrutura declarados.
- Valores financeiros, promoção e isolamento iguais ao oráculo; compatibilidade de UI preservada e rollback ensaiado.

Referências primárias de apoio: Redis KEYS — https://redis.io/docs/latest/commands/keys/ ; cursores Firestore — https://firebase.google.com/docs/firestore/query-data/query-cursors ; filtros/limites RTDB — https://firebase.google.com/docs/database/web/lists-of-data . Índices aceleram seleção, mas não tornam barata uma consulta que pede todos os registros.
