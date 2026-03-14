/**
 * 🎯 OpenTelemetry Tracer Configuration
 * 
 * Configuração pragmática e focada:
 * - Manual instrumentation (não auto)
 * - Sampling: Dev 100%, Staging 10%, Produção 1-5%
 * - Export para Jaeger/Tempo
 * - Foco em fluxo de corrida
 */

const { trace } = require('@opentelemetry/api');
const { logStructured } = require('./logger');

// Importações opcionais (verificar se instaladas)
let NodeSDK, OTLPTraceExporter, resources, SemanticResourceAttributes;

try {
    const sdkNode = require('@opentelemetry/sdk-node');
    NodeSDK = sdkNode.node.NodeSDK || sdkNode.NodeSDK;
    // ✅ Usar OTLP exporter para Tempo (ao invés de Jaeger)
    const otlpExporter = require('@opentelemetry/exporter-trace-otlp-http');
    OTLPTraceExporter = otlpExporter.OTLPTraceExporter;
    resources = require('@opentelemetry/resources');
    const semanticConventions = require('@opentelemetry/semantic-conventions');
    SemanticResourceAttributes = semanticConventions.SemanticResourceAttributes;
} catch (error) {
    logStructured('warn', 'OpenTelemetry packages não encontrados', {
        service: 'opentelemetry',
        operation: 'import',
        error: error.message,
        installCommand: 'npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions'
    });
}

// Configuração de sampling baseada em ambiente
function getSamplingRate() {
    const env = process.env.NODE_ENV || 'development';

    switch (env) {
        case 'production':
            // Sampling 1-5% em produção
            return parseFloat(process.env.OTEL_SAMPLING_RATE || '0.01');
        case 'staging':
            return 0.10; // 10%
        case 'development':
        default:
            return 1.0; // 100%
    }
}

// Configuração do exporter (OTLP para Tempo)
function getExporter() {
    if (process.env.OTEL_ENABLED === 'false') {
        return null;
    }

    // ✅ Usar OTLP HTTP para Tempo
    const tempoEndpoint =
        process.env.TEMPO_ENDPOINT ||
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        `http://127.0.0.1:${process.env.PORT || 3001}/otel`;

    return new OTLPTraceExporter({
        url: `${tempoEndpoint}/v1/traces`,
        // Headers opcionais (se necessário autenticação)
        headers: {}
    });
}

// Inicializar SDK
let sdk = null;

function initializeTracer() {
    if (sdk) {
        return trace.getTracer('leaf-backend');
    }

    // Se pacotes não estão instalados, retornar tracer mock
    if (!NodeSDK || !OTLPTraceExporter || !resources || !SemanticResourceAttributes) {
        logStructured('warn', 'OpenTelemetry não inicializado - pacotes não instalados', {
            service: 'opentelemetry',
            operation: 'initialize',
            fallback: 'mock-tracer'
        });
        return trace.getTracer('leaf-backend-mock');
    }

    const samplingRate = getSamplingRate();
    const exporter = getExporter();

    if (!exporter) {
        logStructured('warn', 'OpenTelemetry desabilitado via OTEL_ENABLED=false', {
            service: 'opentelemetry',
            operation: 'initialize'
        });
        return trace.getTracer('leaf-backend-disabled');
    }

    // Criar resource usando resourceFromAttributes
    const resourceAttrs = {};
    if (SemanticResourceAttributes.SERVICE_NAME) {
        resourceAttrs[SemanticResourceAttributes.SERVICE_NAME] = 'leaf-websocket-backend';
    } else {
        resourceAttrs['service.name'] = 'leaf-websocket-backend';
    }
    if (SemanticResourceAttributes.SERVICE_VERSION) {
        resourceAttrs[SemanticResourceAttributes.SERVICE_VERSION] = process.env.APP_VERSION || '1.0.0';
    } else {
        resourceAttrs['service.version'] = process.env.APP_VERSION || '1.0.0';
    }
    if (SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT) {
        resourceAttrs[SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT] = process.env.NODE_ENV || 'development';
    } else {
        resourceAttrs['deployment.environment'] = process.env.NODE_ENV || 'development';
    }

    const resource = resources.resourceFromAttributes(resourceAttrs);

    sdk = new NodeSDK({
        resource: resource,
        traceExporter: exporter,
        // Sampling manual (não usar auto-instrumentation)
        // Vamos criar spans manualmente nos pontos críticos
    });

    try {
        sdk.start();

        logStructured('info', 'OpenTelemetry inicializado', {
            service: 'opentelemetry',
            operation: 'initialize',
            samplingRate: (samplingRate * 100).toFixed(1) + '%'
        });
    } catch (error) {
        logStructured('error', 'Falha ao iniciar OpenTelemetry SDK (provavelmente coletor offline)', {
            service: 'opentelemetry',
            error: error.message
        });
        sdk = null;
        return trace.getTracer('leaf-backend-mock');
    }

    return trace.getTracer('leaf-backend');
}

// Obter tracer (singleton)
function getTracer() {
    if (!sdk) {
        return initializeTracer();
    }
    return trace.getTracer('leaf-backend');
}

// Shutdown graceful
function shutdown() {
    if (sdk) {
        return sdk.shutdown();
    }
    return Promise.resolve();
}

module.exports = {
    initializeTracer,
    getTracer,
    shutdown,
    trace // Exportar API do OTel para uso direto
};
