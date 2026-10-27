# Escala do banco — migração, custo e ativação

26/10/2026. Este roteiro prepara uma operação futura. Nenhum passo de produção foi executado. As flags novas estão desligadas no exemplo; isso não comprova a configuração dos hosts. Implementação/testes locais não autorizam credenciais, publicação, console, backfill real ou carga em ambiente pago.

## Pacote e dependências

Plano: `docs/validation/DATABASE_SCALE_PLAN_2026-10-25.md`. Registro por etapa e JSONs: `docs/validation/DATABASE_SCALE_IMPLEMENTATION.md` e `docs/validation/evidence/`.

PRs empilhados: #425 → #426 → #427 → #428 → #429 → #430 → #432 → #433 → #434 → #435 → migração/validação final. Revisar toda a cadeia, não apenas o último diff. A navegação #424 não integra esta mudança. Antes de publicar: integrar mudanças aprovadas, resolver conflitos reais, repetir validação no `main` limpo e registrar SHA/imagem/configuração do pacote. CI não publica backend nem ativa flags.

| Superfície | Writer | Reader | Prontidão antes de ligar leitura |
| --- | --- | --- | --- |
| H3 regional | `ENABLE_H3_REGIONAL_WRITES` | `ENABLE_H3_REGIONAL_READS` | Paridade espacial/estado; marcador com generation Redis atual |
| Histórico de recibos | `ENABLE_RECEIPT_HISTORY_WRITES` | `ENABLE_RECEIPT_HISTORY_READS` | Por proprietário/papel/namespace/contexto, identidade e revisão |
| Métricas/resumos de motorista | `ENABLE_OPS_METRIC_WRITES` | `ENABLE_OPS_METRIC_READS` | Cobertura histórica por fonte, ausência de pendências e atestados por tipo |
| Diretório completo de motoristas | Fontes atuais + inspeção | `ENABLE_ADMIN_DRIVER_CURSOR_READS` | Perfis `usertype=driver`, `createdAt` ISO canônico, índice e cobertura conferidos |
| Listagem principal de usuários | Fonte atual | `ENABLE_ADMIN_USER_CURSOR_READS` | Queries/índices de filtros conferidos, forward/reverse no contrato real |
| Inicialização de usuário novo | `ENABLE_NEW_USER_READ_MODEL_INIT` | Flags acima | Somente retorno novo de Admin Auth `createUser`, nunca data mutável do perfil |

O fallback de métricas para o RTDB (`ENABLE_LEGACY_METRICS_FALLBACK`) foi removido na saída do RTDB (domínio 7): sem a fonte moderna, a rota responde 503.

## Autorizações e pré-voo

Preparar para Izaak aprovar ações concretas separadas: (a) leitura/inventário limitado do ambiente, (b) índices/regras/configuração, (c) deploy, (d) backfill com número de lotes e custo, (e) ativação de leitores. Não reutilizar autorização de uma corrida QA ou de outro PR para essas ações.

Antes de acesso a hosts, ler `SANTIAGO_CUTOVER_RUNBOOK.md`; backend somente Santiago pelo script aprovado, a partir de `main` limpo. Não alterar stack/compose/nginx compartilhado do Contabo. Conferir DNS/identidade conforme AGENTS; nada aqui é instrução de failover automático.

Inventário proposto, somente após autorização: SHA/imagem de gateways e workers; flags efetivas por processo; geração/autoridade Redis; versão, `maxmemory`, política de evicção, memória e lag; contagem/idade de buffers e outboxes; índices efetivamente servidos; configuração TTL real dos chunks; cobertura/formato de cadastros e recibos; janelas/contextos sandbox. Usar contagens, amostras pequenas e cursores, nunca download de raízes sem orçamento. Saídas que contenham dados reais ficam fora do Git com acesso restrito.

Gate obrigatório de GPS: buffers pendentes sem TTL destrutivo exigem memória monitorada e política coerente com `noeviction`. Não aplicar `FLUSHDB`, trim destrutivo, expiração de pendências ou remoção de manifests para ganhar espaço. Saturação deve ser observada e sinalizada com retry, preservando dados já aceitos. A capacidade durável depende de latência/quota reais, não só de ingestão Redis.

## Simulação e migração por lotes

Biblioteca `leaf-websocket-backend/scripts/maintenance/database-read-models.cjs` recebe adapters explicitamente; não carrega credenciais, cria endpoint ou agenda trabalho. `apply=false` é padrão. Escritas exigem referência explícita de manutenção; essa string é trilha operacional e prevenção de acidente, não substitui autorização humana ou autenticação. Nenhum marcador de prontidão é criado pela biblioteca. O validador de configuração recusa readers sem writers e métricas escritas com a outbox consumidora desabilitada.

CLI local reproduzível, somente em stores privados sintéticos:

```bash
node leaf-websocket-backend/scripts/benchmark/database-migration-local.cjs /tmp/leaf-migration-local.json
```

Ele não aceita endpoint ou credencial remota. Usa JARs já em cache, Redis privado por Unix socket e emuladores em loopback, encerra seus processos e remove seu diretório temporário. Não apresentar esses fixtures como banco ou sessão real.

Funções disponíveis para um adapter de manutenção previamente aprovado:

- `metricBatch`: até100 fontes +1 sentinela, ordem por ID e checkpoint de posição/coleção. Transações usam o snapshot canônico corrente e o mesmo checkpoint de contribuição do runtime. Repetir lote não soma de novo. Cobrir `rides`, distribuições e auditoria, separando coleções sandbox. Não executar efeitos de pagamento, contador promocional, recibo ou ledger.
- `receiptBatch`: até100 recibos +1 sentinela por chave do RTDB, incluindo a ordem de chaves numéricas. Resolve aliases históricos de proprietário com helpers existentes; verifica contexto/ID e fonte antes/depois. Só escreve identidade/projeções e invalida `ready`; não regrava recibo financeiro, referência de booking ou seus timestamps. Fonte alterada exige retry do lote, não avanço do checkpoint. Leitores ficam desligados durante a migração. Writers homogêneos devem estar ativos antes do primeiro passe.
- `directoryBatch`: inspeção de até100 perfis +1. Relata aliases e datas fora do schema; não modifica cadastro por suposição. Normalizações de perfil precisam de plano separado com valor original preservado. Confirmar que todos os writers relevantes mantêm o formato; registros de credenciais de senha são outra coleção e não devem ser confundidos com perfis.
- `regionalBatch`: uma página HSCAN de viagens ou SCAN de buscas por chamada, até1.000 entradas/4MiB verificados após resposta. SCAN também encontra buscas fora do índice legado. Releitura por identidade antes de semear, até4 operações concorrentes e verificação de generation antes/depois. COUNT é sugestão; excesso recusa o lote. Redis trocado exige reinício da reconciliação. Nenhum scan em loop até zero dentro de um request.

Persistir checkpoint fora do Git somente após sucesso completo do lote, com escrita atômica do arquivo (temporário + rename), acesso restrito, SHA do pacote, fonte/namespace, cutoff e totais acumulados. Falha repete o checkpoint anterior. `passComplete=true` significa apenas que o passe terminou; **não significa paridade, ausência de novas fontes ou prontidão**.

Antes da primeira aplicação: dry-run com quantidade máxima de lotes, I/O estimado, limite de bytes, concorrência4 ou menor, critério de abortar e janela de execução. Capturar versões/digests necessários para auditoria e conciliação. Interromper por quota, erro, schema/contexto inválido, aumento de latência crítica ou backlog sem recuperação. Não aumentar lotes para esconder atraso.

## Paridade e atestados

Usar exportação/amostra e cursores aprovados, cobrindo aliases e o namespace inteiro necessário. O helper `parityAccumulator` calcula count/XOR/soma de hashes com memória constante, independente da ordem; não é uma prova criptográfica de integridade financeira nem substitui conciliação de fonte. Para RTDB, normalizar a semântica de `null`/objeto vazio com `normalizeRealtimeValue`. Conferir também IDs, valores, contexto, ordenação e acessibilidade de detalhes. Não comparar apenas contagens.

Recibos: comparar resumos esperados da fonte canônica com itens da projeção para cada proprietário/papel/contexto, incluindo aliases antigos e correções. Finalizar somente sem migração em voo, com writers novos homogêneos; qualquer fonte alterada durante backfill mantém prontidão inválida. Preservar revisão de cursor e testar409 após correção. Registros órfãos/conflitantes pedem conciliação, não exclusão automática.

Métricas: conferir buckets contra as mesmas fontes e recorte temporal. O modo agregado usa dias completos em São Paulo, inclusive7d/30d, máximo31dias; isso difere do legado móvel/horário do host. Atestados `metrics_ride_v1`, `metrics_distribution_v1` e `metrics_audit_v1` exigem schema1, timezone,16shards e cobertura; auditoria acumulada também exige `allTime=true`. Conferir ausência de tarefas pendentes do tipo e namespaces. Estatística de motorista só recebe `complete=true` após cobertura de **todo** o histórico daquele motorista, não somente o mês testado.

H3: comparar área/estado/movimento/terminais em amostra limitada, conferir cobertura do seed e buscas não indexadas. Marcador regional é vinculado à geração atual; um passe completo não prova consistência entre todos os processos. Falha de writer invalida prontidão.

Nenhum atestado certifica o futuro por si só: manter writers homogêneos, observar falhas/lag e retirar leitor se a projeção deixar de ser confiável. Não validar em sombra duplicando scans globais do request antigo.

## Usuários novos

Inicializador opt-in ligado somente às duas criações de usuário do custom OTP no backend. Recebe o `UserRecord` recém-retornado pelo Admin Auth; idade máxima5min e nenhuma leitura adicional de Auth. Cria meta de histórico operacional e estatística inicial sem zerar totais já existentes. Cadastro antigo não fica novo porque `profile.createdAt` mudou.

Outros caminhos de criação/perfis anteriores e contextos sandbox novos não são atestados automaticamente: permanecem no leitor conservador e entram no processo de migração. Não aprovar ativação universal alegando cobertura desses caminhos sem inventário. Falha do inicializador não derruba autenticação nem autoriza retorno de histórico vazio como completo. Custo habilitado: duas transações pequenas RTDB e uma transação de leitura/escrita Firestore por UID novo; nenhuma chamada extra a provedor de Pix/mapa/Auth.

## Custos, retenção e limites

Custos dependem de registros/bytes/quota e tentativas reais; emulador não comprova cobrança. Orçamento deve anteceder aplicação/ativação:

| Operação nova | Trabalho aproximado habilitado |
| --- | --- |
| Snapshot canônico com projeção | +1 escrita de tarefa no mesmo batch |
| Materializar contribuição comum de ride | 4–5 leituras e3–4 escritas FS, além da escrita canônica/tarefa e retries |
| Auditoria daily+lifetime | 5 leituras/4 escritas FS por contribuição, além da origem/tarefa |
| Refresh frio de31dias | 496 buckets +2 controles, sem histórico de rides; documentos ausentes também podem ter custo |
| Refresh repetido | Cache identificado por até60s/processo, sem nova consulta dentro desse cache |
| Diretório de20 motoristas | 42 registros FS +20 veículos no ensaio; não é uma consulta única nem custo zero |
| Histórico de10 recibos | Duas leituras pequenas de meta e até11 resumos no novo caminho |

Cache por processo não é cache compartilhado: múltiplas instâncias multiplicam misses. Em base pequena, buckets podem custar mais que consulta legada pequena. Avaliar orçamento total com volume/frequência reais antes de ligar writers.

Não houve mudança de retenção. Campo `expiresAt` não comprova TTL ativo. Checkpoints derivados crescem com histórico e são necessários para idempotência; apagar checkpoint sozinho pode duplicar contribuição. Estimar bytes por corrida com amostra aprovada, incluindo trilha, resumos, índices e outboxes. Qualquer TTL, retenção financeira, limpeza de fonte canônica ou configuração de console exige decisão separada. Não criar cron de limpeza paralelo; reutilizar manutenção existente com orçamento e aprovação.

## Ativação, observação e rollback

O ciclo existente da outbox usa lote30 no bootstrap (serviço padrão20, teto100),4 transações simultâneas de projeção e250ms entre ciclos produtivos. Vazio/falha total volta ao intervalo ocioso existente,10s por padrão; o próximo ciclo só começa após o anterior terminar. Não admite novos itens depois de10s no lote, preservando os não iniciados; I/O já em voo não é cancelado. Falha total não acelera polling. Isso remove o teto artificial de3tarefas/s do timer antigo, mas não prova taxa de I/O real. Carga permanente pode manter relatórios em503/atualização se o backlog não zerar: essa degradação não pode atingir corridas.

Primeiro writers aditivos homogêneos; depois backfill/paridade e atestados; só então leitores por superfície/coorte. Antes de cada ação externa, obter a autorização específica. Observar p95/p99 críticos, erros, rejeições administrativas, event-loop, memória Redis/RSS, idade/volume de buffers e tarefas, retries, lag e idade do cache. Sem labels por usuário/rideId. Métricas derivadas são relatórios; não substituir fonte financeira.

Regra inicial de comparação local: p95/p99 críticos não piorarem mais de10% sob mesma carga e proteção de recursos. Rejeição503 administrativa é uma degradação explícita e deve aparecer no resultado; não comparar como se fosse o mesmo throughput concluído. Capacidade do host gerenciado ainda exige ensaio autorizado, com teto de custo. Teste curto de ingestão não comprova estabilidade durável indefinida.

Abortar leitor por paridade quebrada, identidade/contexto errado, pendência sem recuperação ou latência crítica fora do orçamento. Leitores desligam primeiro. Preservar fontes e projeções; reduzir trabalho administrativo em vez de reativar scan global. Legado só dentro dos limites; pode permanecer indisponível acima deles.

GPS: preservar manifesto/chunk/fila. Drenar com o writer v2 e verificar antes de voltar worker antigo; `.add` antigo em lote já criado pode duplicar pontos. Nunca misturar writers de metadados sem CAS e novos. Rollback do ajuste nullable reintroduz a regressão e não é recomendado.

Métricas/recibos: desligar readers e manter materialização até conferir/drenar tarefas em voo. Não apagar checkpoint/bucket/item para reverter. Outbox CAS protege ACK de payload novo, mas não resolve a semântica antiga de última escrita canônica concorrente; correções concorrentes na fonte precisam de conciliação/versionamento específico. Relatórios complexos de coorte/região/conversão/KYC seguem o legado limitado e podem503, sem promessa de projeção completa dessas dimensões.
