# Escala do banco — registro de implementação

## Objetivo e progresso
Implementar DATABASE_SCALE_PLAN_2026-10-25.md em mudanças separadas. Base794edfcb7 (main), em worktree próprio; PR de navegação424 preservado. **Iniciativa em andamento: primeira etapa pronta para revisão, demais etapas ainda não implementadas neste commit.** Nenhum deploy/backfill/console autorizado ou executado.

## Etapa1 — cache e admissão
Invalidação de cache por versões de namespace, sem KEYS/DEL global. Versões expiram em2h, maior que todos os TTLs configurados neste serviço (máximo600s); valores de gerações antigas expiram naturalmente. Métricas e cache espacial também participam da versão. Contagens globais por padrão deixam de ser calculadas e retornamnull/countsAvailable:false, não zero. Padrão arbitrário de invalidação recebe400; tipo/usuário/global têm suporte explícito. Monitor de cache requer operador autorizado e limita20requisições/min por processo/IP. Erro upstream não chama fetchFunction duas vezes.

H3: cache FIFO com TTL fixo, teto256entradas/8MiB de bytes serializados estimados (não heap total); expirados removidos em acessos/inserções, sem timer. No máximo8cálculos distintos simultâneos por processo; viewport igual compartilha promessa. Cache usa chave do viewport solicitado mesmo quando resolução é reduzida. Mudanças não alteram tarifa, payload de células ou frequência GPS.

## Arquivos e testes
utils/advanced-cache.js, utils/bounded-ttl-cache.js, routes/cache-monitoring.js, services/h3-map-service.js, testes database-scale-guards,cache-monitoring-auth,h3-map-budget; benchmark seguro database-scale-local.cjs e este registro/plano/JSON.

ENV_FILE=/dev/null npm --prefix leaf-websocket-backend run test:unit -- --runInBand --watchman=false --collectCoverage=false: **355suítes/3114testes passaram**. config:validate passou com NODE_ENV=test, sem credenciais; isso não valida configuração de produção. Guards básicos executados no registro. Inicialmente o compartilhamento de node_modules falhou por dependências backend ausentes; npm ci --workspaces=false --ignore-scripts instalou apenas o lockfile backend no worktree, sem mudanças de manifest/lock.

## Evidência
[JSON bruto](evidence/database-scale-cache-local-2026-10-25.json). Script inicia Redis8.6.3 novo em Unix socket privado, port0, sem persistência, maxmemory256MiB/noeviction; remove apenas seu processo/diretório. Módulos isolados por VM impedem imports de bootstrap/Firebase; nenhuma credencial, chamada externa ou dado real. Baseline usa código real794edfcb7 para cache, candidato usa arquivos atuais. Fixtures têm alvo1k/10k/100kchaves; actualKeyspaceBeforeQueries registra o tamanho real após as exclusões do baseline.

No degrau100k, stats antigo fez12KEYS+INFO, novo apenasINFO; invalidação antiga KEYS+DEL/≈306KB de retorno, nova1SET/4bytes JSON de resposta. Tempos de uma execução variam e não são p95 nem prova de throughput. Após10kviewports, cache antigo retinha10kentradas, novo256/9216bytes estimados no fixture. Limites/contagem de comandos são evidência determinística; tempos são microbenchmark no M1Pro, não capacidade do Santiago ou do app completo.

## Riscos, reversão e fora do escopo
Primeira leitura na nova versão de cache é miss; chaves antigas ficam até TTL. Consumidores administrativos devem aceitar contagensnull e invalidation metadata; não são contagens de chaves deletadas. Cache cheio pode elevarmiss, porém admissão impede fila local ilimitada. Limites por processo não representam limite global entre gateways. Rollback por revert deste commit; não ativar KEYS/consultas globais como fallback automático em pico. Cache derivado, sem migração de fonte canônica.

Fora desta etapa: localização, persistência GPS, projeçãoH3 regional, recibos, relatórios/listagens, índices/TTL de Firebase e migração de histórico. Permanecem na iniciativa; sem mudança financeira/KYC/mobile, novas dependências, jobs ou publicação.
