/**
 * 🎯 Prometheus Metrics
 * 
 * Métricas para exportação no formato Prometheus
 */

const promClient = require('prom-client');

// Criar registry
const register = new promClient.Registry();
const sanitizeLabelValue = (value, fallback = 'unknown', maxLength = 40) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!normalized) return fallback;
    return normalized.slice(0, maxLength);
};

// Coletar métricas padrão (CPU, memória, etc)
promClient.collectDefaultMetrics({ register });

// ==================== COMMANDS ====================

// Latência de Commands (histogram)
const commandDuration = new promClient.Histogram({
    name: 'leaf_command_duration_seconds',
    help: 'Duração de execução de commands em segundos',
    labelNames: ['command_name', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register]
});

// Contador de Commands (sucesso/falha)
const commandTotal = new promClient.Counter({
    name: 'leaf_command_total',
    help: 'Total de commands executados',
    labelNames: ['command_name', 'status'],
    registers: [register]
});

// ==================== EVENTS ====================

// Contador de Events publicados
const eventPublished = new promClient.Counter({
    name: 'leaf_event_published_total',
    help: 'Total de events publicados',
    labelNames: ['event_type'],
    registers: [register]
});

// Contador de Events consumidos
const eventConsumed = new promClient.Counter({
    name: 'leaf_event_consumed_total',
    help: 'Total de events consumidos',
    labelNames: ['event_type', 'listener_name'],
    registers: [register]
});

// Lag de Events (tempo entre publish e consume)
const eventLag = new promClient.Histogram({
    name: 'leaf_event_lag_seconds',
    help: 'Lag entre publicação e consumo de events em segundos',
    labelNames: ['event_type', 'listener_name'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
});

// ==================== LISTENERS ====================

// Latência de Listeners
const listenerDuration = new promClient.Histogram({
    name: 'leaf_listener_duration_seconds',
    help: 'Duração de execução de listeners em segundos',
    labelNames: ['listener_name', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register]
});

// Contador de Listeners (sucesso/falha)
const listenerTotal = new promClient.Counter({
    name: 'leaf_listener_total',
    help: 'Total de listeners executados',
    labelNames: ['listener_name', 'status'],
    registers: [register]
});

// ==================== REDIS ====================

// Latência de operações Redis
const redisDuration = new promClient.Histogram({
    name: 'leaf_redis_duration_seconds',
    help: 'Duração de operações Redis em segundos',
    labelNames: ['operation', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [register]
});

// Contador de erros Redis
const redisErrors = new promClient.Counter({
    name: 'leaf_redis_errors_total',
    help: 'Total de erros Redis',
    labelNames: ['operation'],
    registers: [register]
});

// ==================== CIRCUIT BREAKERS ====================

// Estado dos Circuit Breakers (gauge)
const circuitBreakerState = new promClient.Gauge({
    name: 'leaf_circuit_breaker_state',
    help: 'Estado do circuit breaker (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
    labelNames: ['circuit_name'],
    registers: [register]
});

// Contador de falhas de Circuit Breakers
const circuitBreakerFailures = new promClient.Counter({
    name: 'leaf_circuit_breaker_failures_total',
    help: 'Total de falhas em circuit breakers',
    labelNames: ['circuit_name'],
    registers: [register]
});

// ==================== IDEMPOTENCY ====================

// Contador de idempotency hits/misses
const idempotencyTotal = new promClient.Counter({
    name: 'leaf_idempotency_total',
    help: 'Total de requisições idempotentes (hit/miss)',
    labelNames: ['operation', 'result'],
    registers: [register]
});

// ==================== MÉTRICAS DE NEGÓCIO (KPIs) ====================

// Corridas solicitadas/min
const ridesRequested = new promClient.Counter({
    name: 'leaf_rides_requested_total',
    help: 'Total de corridas solicitadas',
    labelNames: ['city', 'service_type'],
    registers: [register]
});

// Corridas aceitas/min
const ridesAccepted = new promClient.Counter({
    name: 'leaf_rides_accepted_total',
    help: 'Total de corridas aceitas',
    labelNames: ['city', 'service_type'],
    registers: [register]
});

// Corridas canceladas
const ridesCancelled = new promClient.Counter({
    name: 'leaf_rides_cancelled_total',
    help: 'Total de corridas canceladas',
    labelNames: ['city', 'reason'],
    registers: [register]
});

// Corridas concluídas
const ridesCompleted = new promClient.Counter({
    name: 'leaf_rides_completed_total',
    help: 'Total de corridas concluídas',
    labelNames: ['city', 'service_type'],
    registers: [register]
});

// Tempo até aceite (P95)
const timeToAccept = new promClient.Histogram({
    name: 'leaf_time_to_accept_seconds',
    help: 'Tempo desde solicitação até aceite em segundos',
    labelNames: ['city'],
    buckets: [1, 5, 10, 30, 60, 120, 300],
    registers: [register]
});

// Tempo total da corrida
const rideTotalDuration = new promClient.Histogram({
    name: 'leaf_ride_total_duration_seconds',
    help: 'Duração total da corrida (solicitação até conclusão) em segundos',
    labelNames: ['city'],
    buckets: [60, 300, 600, 900, 1800, 3600],
    registers: [register]
});

// Event backlog (gauge)
const eventBacklog = new promClient.Gauge({
    name: 'leaf_event_backlog',
    help: 'Número de eventos pendentes no Redis Streams',
    labelNames: ['event_type'],
    registers: [register]
});

// Workers ativos
const activeWorkers = new promClient.Gauge({
    name: 'leaf_workers_active',
    help: 'Número de workers ativos',
    labelNames: ['worker_type'],
    registers: [register]
});

// ==================== HOTPATH / REALTIME ====================

// Event loop lag (ms)
const eventLoopLagMeanMs = new promClient.Gauge({
    name: 'leaf_event_loop_lag_mean_ms',
    help: 'Média de event loop lag em milissegundos',
    registers: [register]
});

const eventLoopLagP95Ms = new promClient.Gauge({
    name: 'leaf_event_loop_lag_p95_ms',
    help: 'P95 de event loop lag em milissegundos',
    registers: [register]
});

const eventLoopLagMaxMs = new promClient.Gauge({
    name: 'leaf_event_loop_lag_max_ms',
    help: 'Máximo de event loop lag em milissegundos',
    registers: [register]
});

// Volume de updates realtime (presença/localização)
const realtimeUpdatesTotal = new promClient.Counter({
    name: 'leaf_realtime_updates_total',
    help: 'Total de updates realtime processados por canal e resultado',
    labelNames: ['channel', 'result'],
    registers: [register]
});

// Latência de operações críticas (hot path)
const hotpathDuration = new promClient.Histogram({
    name: 'leaf_hotpath_duration_seconds',
    help: 'Latência das operações críticas no hot path',
    labelNames: ['path', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
});

// Volume de operações Redis no hot path
const redisHotpathOps = new promClient.Counter({
    name: 'leaf_redis_hotpath_ops_total',
    help: 'Total de operações Redis no hot path por caminho e operação',
    labelNames: ['path', 'operation'],
    registers: [register]
});

// ==================== H3 MAP ====================

const h3CellsRequests = new promClient.Counter({
    name: 'leaf_h3_cells_request_total',
    help: 'Total de requisições do mapa H3 por superfície e modo',
    labelNames: ['surface', 'mode'],
    registers: [register]
});

const h3CellsComputeMs = new promClient.Histogram({
    name: 'leaf_h3_cells_compute_ms',
    help: 'Tempo de computação do payload H3 em milissegundos',
    labelNames: ['surface', 'mode'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register]
});

const h3CellsCacheHit = new promClient.Counter({
    name: 'leaf_h3_cells_cache_hit_total',
    help: 'Total de hits de cache do mapa H3',
    labelNames: ['surface', 'mode'],
    registers: [register]
});

const h3CellsCacheMiss = new promClient.Counter({
    name: 'leaf_h3_cells_cache_miss_total',
    help: 'Total de misses de cache do mapa H3',
    labelNames: ['surface', 'mode'],
    registers: [register]
});

const h3CellsReturned = new promClient.Counter({
    name: 'leaf_h3_cells_returned_total',
    help: 'Total de células H3 retornadas por superfície e modo',
    labelNames: ['surface', 'mode'],
    registers: [register]
});

const h3RefreshHints = new promClient.Counter({
    name: 'leaf_h3_refresh_hint_total',
    help: 'Total de hints de refresh H3 emitidos por superfície e motivo',
    labelNames: ['surface', 'reason'],
    registers: [register]
});

const pricingEvaluations = new promClient.Counter({
    name: 'leaf_pricing_evaluation_total',
    help: 'Total de avaliações de pricing por estado operacional e source de baseline',
    labelNames: ['result', 'operational_state', 'baseline_source'],
    registers: [register]
});

const pricingDynamicQuotes = new promClient.Counter({
    name: 'leaf_pricing_dynamic_quotes_total',
    help: 'Total de avaliações de pricing com dinâmica aplicada',
    labelNames: ['operational_state'],
    registers: [register]
});

const pricingMinimumFareApplied = new promClient.Counter({
    name: 'leaf_pricing_minimum_fare_applied_total',
    help: 'Total de avaliações de pricing que caíram no valor mínimo',
    labelNames: ['operational_state'],
    registers: [register]
});

const pricingPressureScore = new promClient.Histogram({
    name: 'leaf_pricing_score_pressao',
    help: 'Distribuição do score de pressão operacional',
    labelNames: ['operational_state'],
    buckets: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1],
    registers: [register]
});

const pricingExceptionScore = new promClient.Histogram({
    name: 'leaf_pricing_score_excecao',
    help: 'Distribuição do score de exceção operacional',
    labelNames: ['operational_state'],
    buckets: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1],
    registers: [register]
});

const pricingBaselineMaterializations = new promClient.Counter({
    name: 'leaf_pricing_baseline_materialization_total',
    help: 'Total de execuções da materialização de baseline de pricing',
    labelNames: ['result'],
    registers: [register]
});

const pricingBaselineMaterializationDuration = new promClient.Histogram({
    name: 'leaf_pricing_baseline_materialization_duration_seconds',
    help: 'Duração em segundos da materialização de baseline de pricing',
    labelNames: ['result'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [register]
});

const pricingBaselineMaterializedCells = new promClient.Counter({
    name: 'leaf_pricing_baseline_materialized_cells_total',
    help: 'Total de células observadas durante a materialização de baseline de pricing',
    labelNames: ['status'],
    registers: [register]
});

const rideHealthStateTotal = new promClient.Gauge({
    name: 'leaf_ride_health_state_total',
    help: 'Total atual de corridas em estados operacionais monitorados',
    labelNames: ['state'],
    registers: [register]
});

const rideHealthStuckTotal = new promClient.Gauge({
    name: 'leaf_ride_health_stuck_total',
    help: 'Total atual de corridas presas em estados operacionais monitorados',
    labelNames: ['state'],
    registers: [register]
});

const rideHealthRecentTotal = new promClient.Gauge({
    name: 'leaf_ride_health_recent_total',
    help: 'Total recente de corridas em estados operacionais monitorados',
    labelNames: ['state'],
    registers: [register]
});

const rideHealthAlertsTotal = new promClient.Counter({
    name: 'leaf_ride_health_alert_total',
    help: 'Total de alertas emitidos pelo monitor operacional de corridas',
    labelNames: ['alert_type', 'severity'],
    registers: [register]
});

// ==================== EXPORT ====================

/**
 * Obter métricas no formato Prometheus
 */
async function getMetrics() {
    return await register.metrics();
}

/**
 * Helpers para registrar métricas
 */
const metrics = {
    // Commands
    recordCommand: (commandName, durationSeconds, success) => {
        const status = success ? 'success' : 'failure';
        commandDuration.observe({ command_name: commandName, status }, durationSeconds);
        commandTotal.inc({ command_name: commandName, status });
    },
    
    // Events
    recordEventPublished: (eventType) => {
        eventPublished.inc({ event_type: eventType });
    },
    
    recordEventConsumed: (eventType, listenerName, lagSeconds) => {
        eventConsumed.inc({ event_type: eventType, listener_name: listenerName });
        if (lagSeconds !== undefined) {
            eventLag.observe({ event_type: eventType, listener_name: listenerName }, lagSeconds);
        }
    },
    
    // Listeners
    recordListener: (listenerName, durationSeconds, success) => {
        const status = success ? 'success' : 'failure';
        listenerDuration.observe({ listener_name: listenerName, status }, durationSeconds);
        listenerTotal.inc({ listener_name: listenerName, status });
    },
    
    // Redis
    recordRedis: (operation, durationSeconds, success) => {
        const status = success ? 'success' : 'failure';
        redisDuration.observe({ operation, status }, durationSeconds);
        if (!success) {
            redisErrors.inc({ operation });
        }
    },
    
    // Circuit Breakers
    setCircuitBreakerState: (circuitName, state) => {
        // 0=CLOSED, 1=OPEN, 2=HALF_OPEN
        const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
        circuitBreakerState.set({ circuit_name: circuitName }, stateValue);
    },
    
    recordCircuitBreakerFailure: (circuitName) => {
        circuitBreakerFailures.inc({ circuit_name: circuitName });
    },
    
    // Idempotency
    recordIdempotency: (operation, hit) => {
        const result = hit ? 'hit' : 'miss';
        idempotencyTotal.inc({
            operation: sanitizeLabelValue(operation, 'unknown'),
            result
        });
    },
    
    // ==================== MÉTRICAS DE NEGÓCIO ====================
    
    // Corridas
    recordRideRequested: (city = 'unknown', serviceType = 'standard') => {
        ridesRequested.inc({ city, service_type: serviceType });
    },
    
    recordRideAccepted: (city = 'unknown', serviceType = 'standard') => {
        ridesAccepted.inc({ city, service_type: serviceType });
    },
    
    recordRideCancelled: (city = 'unknown', reason = 'unknown') => {
        ridesCancelled.inc({ city, reason });
    },
    
    recordRideCompleted: (city = 'unknown', serviceType = 'standard') => {
        ridesCompleted.inc({ city, service_type: serviceType });
    },
    
    // Tempo até aceite
    recordTimeToAccept: (seconds, city = 'unknown') => {
        timeToAccept.observe({ city }, seconds);
    },
    
    // Duração total da corrida
    recordRideTotalDuration: (seconds, city = 'unknown') => {
        rideTotalDuration.observe({ city }, seconds);
    },
    
    // Event backlog
    setEventBacklog: (count, eventType = 'all') => {
        eventBacklog.set({ event_type: eventType }, count);
    },
    
    // Workers ativos
    setActiveWorkers: (count, workerType = 'listener') => {
        activeWorkers.set({ worker_type: workerType }, count);
    },

    // Event loop lag
    setEventLoopLag: (meanMs = 0, p95Ms = 0, maxMs = 0) => {
        eventLoopLagMeanMs.set(Number.isFinite(meanMs) ? meanMs : 0);
        eventLoopLagP95Ms.set(Number.isFinite(p95Ms) ? p95Ms : 0);
        eventLoopLagMaxMs.set(Number.isFinite(maxMs) ? maxMs : 0);
    },

    // Realtime update volume
    recordRealtimeUpdate: (channel = 'unknown', result = 'processed', count = 1) => {
        realtimeUpdatesTotal.inc({
            channel: sanitizeLabelValue(channel, 'unknown'),
            result: sanitizeLabelValue(result, 'processed')
        }, Number.isFinite(count) && count > 0 ? count : 1);
    },

    // Hot path latency
    recordHotpathLatency: (path, durationSeconds, success = true) => {
        hotpathDuration.observe({
            path: sanitizeLabelValue(path, 'unknown'),
            status: success ? 'success' : 'failure'
        }, Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0);
    },

    // Redis ops in hot path
    recordRedisHotpathOp: (path, operation, count = 1) => {
        redisHotpathOps.inc({
            path: sanitizeLabelValue(path, 'unknown'),
            operation: sanitizeLabelValue(operation, 'unknown')
        }, Number.isFinite(count) && count > 0 ? count : 1);
    },

    // H3 map
    recordH3CellsRequest: (surface = 'dashboard', mode = 'supply_demand') => {
        h3CellsRequests.inc({
            surface: sanitizeLabelValue(surface, 'dashboard'),
            mode: sanitizeLabelValue(mode, 'supply_demand')
        });
    },

    recordH3CellsCompute: (surface = 'dashboard', mode = 'supply_demand', durationMs = 0) => {
        h3CellsComputeMs.observe({
            surface: sanitizeLabelValue(surface, 'dashboard'),
            mode: sanitizeLabelValue(mode, 'supply_demand')
        }, Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0);
    },

    recordH3CellsCache: (surface = 'dashboard', mode = 'supply_demand', hit = false) => {
        const labels = {
            surface: sanitizeLabelValue(surface, 'dashboard'),
            mode: sanitizeLabelValue(mode, 'supply_demand')
        };
        if (hit) {
            h3CellsCacheHit.inc(labels);
            return;
        }
        h3CellsCacheMiss.inc(labels);
    },

    recordH3CellsReturned: (surface = 'dashboard', mode = 'supply_demand', count = 0) => {
        h3CellsReturned.inc({
            surface: sanitizeLabelValue(surface, 'dashboard'),
            mode: sanitizeLabelValue(mode, 'supply_demand')
        }, Number.isFinite(count) && count > 0 ? count : 0);
    },

    recordH3RefreshHint: (surface = 'driver', reason = 'unknown', count = 1) => {
        h3RefreshHints.inc({
            surface: sanitizeLabelValue(surface, 'driver'),
            reason: sanitizeLabelValue(reason, 'unknown')
        }, Number.isFinite(count) && count > 0 ? count : 1);
    },

    recordPricingEvaluation: ({
        success = true,
        operationalState = 'NORMAL',
        baselineSource = 'unknown',
        dynamicApplied = false,
        minimumFareApplied = false,
        scorePressao = 0,
        scoreExcecao = 0
    } = {}) => {
        const labels = {
            result: success ? 'success' : 'failure',
            operational_state: sanitizeLabelValue(operationalState, 'normal'),
            baseline_source: sanitizeLabelValue(baselineSource, 'unknown')
        };

        pricingEvaluations.inc(labels);

        if (dynamicApplied) {
            pricingDynamicQuotes.inc({
                operational_state: labels.operational_state
            });
        }

        if (minimumFareApplied) {
            pricingMinimumFareApplied.inc({
                operational_state: labels.operational_state
            });
        }

        pricingPressureScore.observe(
            { operational_state: labels.operational_state },
            Number.isFinite(scorePressao) ? scorePressao : 0
        );
        pricingExceptionScore.observe(
            { operational_state: labels.operational_state },
            Number.isFinite(scoreExcecao) ? scoreExcecao : 0
        );
    },

    recordPricingBaselineMaterialization: ({
        success = true,
        durationSeconds = 0,
        candidateCells = 0,
        processedCells = 0,
        failedCells = 0
    } = {}) => {
        const result = success ? 'success' : 'failure';

        pricingBaselineMaterializations.inc({ result });
        pricingBaselineMaterializationDuration.observe(
            { result },
            Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0
        );

        if (Number.isFinite(candidateCells) && candidateCells > 0) {
            pricingBaselineMaterializedCells.inc({ status: 'candidate' }, candidateCells);
        }
        if (Number.isFinite(processedCells) && processedCells > 0) {
            pricingBaselineMaterializedCells.inc({ status: 'processed' }, processedCells);
        }
        if (Number.isFinite(failedCells) && failedCells > 0) {
            pricingBaselineMaterializedCells.inc({ status: 'failed' }, failedCells);
        }
    },

    setRideHealthStateCount: (state = 'unknown', count = 0) => {
        rideHealthStateTotal.set(
            { state: sanitizeLabelValue(state, 'unknown') },
            Number.isFinite(count) && count >= 0 ? count : 0
        );
    },

    setRideHealthStuckCount: (state = 'unknown', count = 0) => {
        rideHealthStuckTotal.set(
            { state: sanitizeLabelValue(state, 'unknown') },
            Number.isFinite(count) && count >= 0 ? count : 0
        );
    },

    setRideHealthRecentCount: (state = 'unknown', count = 0) => {
        rideHealthRecentTotal.set(
            { state: sanitizeLabelValue(state, 'unknown') },
            Number.isFinite(count) && count >= 0 ? count : 0
        );
    },

    recordRideHealthAlert: (alertType = 'unknown', severity = 'warning', count = 1) => {
        rideHealthAlertsTotal.inc({
            alert_type: sanitizeLabelValue(alertType, 'unknown'),
            severity: sanitizeLabelValue(severity, 'warning')
        }, Number.isFinite(count) && count > 0 ? count : 1);
    }
};

module.exports = {
    getMetrics,
    metrics,
    register
};
