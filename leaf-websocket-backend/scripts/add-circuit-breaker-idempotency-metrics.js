#!/usr/bin/env node
/**
 * Script para adicionar métricas Prometheus em Circuit Breakers e Idempotency
 */

const fs = require('fs');
const path = require('path');

// 1. Adicionar métricas no Circuit Breaker Service
const circuitBreakerPath = path.join(__dirname, '../services/circuit-breaker-service.js');
if (fs.existsSync(circuitBreakerPath)) {
  let content = fs.readFileSync(circuitBreakerPath, 'utf8');
  
  // Adicionar import
  if (!content.includes("require('../utils/prometheus-metrics')")) {
    content = content.replace(
      /const { logger } = require\('\.\.\/utils\/logger'\);/,
      `const { logger } = require('../utils/logger');\nconst { metrics } = require('../utils/prometheus-metrics');`
    );
  }
  
  // Adicionar métricas quando estado muda
  content = content.replace(
    /this\.state = 'OPEN';/g,
    `this.state = 'OPEN';\n            metrics.setCircuitBreakerState(this.name, 'OPEN');`
  );
  
  content = content.replace(
    /this\.state = 'CLOSED';/g,
    `this.state = 'CLOSED';\n            metrics.setCircuitBreakerState(this.name, 'CLOSED');`
  );
  
  content = content.replace(
    /this\.state = 'HALF_OPEN';/g,
    `this.state = 'HALF_OPEN';\n            metrics.setCircuitBreakerState(this.name, 'HALF_OPEN');`
  );
  
  // Adicionar métrica quando falha é registrada
  content = content.replace(
    /async recordFailure\(\) \{/,
    `async recordFailure() {\n        metrics.recordCircuitBreakerFailure(this.name);`
  );
  
  fs.writeFileSync(circuitBreakerPath, content);
  console.log('✅ Métricas adicionadas em circuit-breaker-service.js');
}

// 2. Adicionar métricas no Idempotency Service
const idempotencyPath = path.join(__dirname, '../services/idempotency-service.js');
if (fs.existsSync(idempotencyPath)) {
  let content = fs.readFileSync(idempotencyPath, 'utf8');
  
  // Adicionar import
  if (!content.includes("require('../utils/prometheus-metrics')")) {
    content = content.replace(
      /const { logger } = require\('\.\.\/utils\/logger'\);/,
      `const { logger } = require('../utils/logger');\nconst { metrics } = require('../utils/prometheus-metrics');`
    );
  }
  
  // Adicionar métricas no checkAndSet
  content = content.replace(
    /if \(result === 'OK' \|\| result === true\) \{[\s\S]*?return \{ isNew: true, cachedResult: null \};/,
    `if (result === 'OK' || result === true) {\n                // Chave criada = primeira vez (não é duplicado)\n                logger.debug(\`✅ [Idempotency] Nova requisição: \${key}\`);\n                metrics.recordIdempotency(key.split(':')[0] || 'unknown', false); // miss\n                return { isNew: true, cachedResult: null };`
  );
  
  content = content.replace(
    /if \(cachedResult\) \{[\s\S]*?return \{[\s\S]*?isNew: false,[\s\S]*?cachedResult: JSON\.parse\(cachedResult\)[\s\S]*?\};/,
    `if (cachedResult) {\n                    logger.debug(\`✅ [Idempotency] Retornando resultado cached para: \${key}\`);\n                    metrics.recordIdempotency(key.split(':')[0] || 'unknown', true); // hit\n                    return { \n                        isNew: false, \n                        cachedResult: JSON.parse(cachedResult) \n                    };`
  );
  
  content = content.replace(
    /return \{ isNew: false, cachedResult: null \};/,
    `metrics.recordIdempotency(key.split(':')[0] || 'unknown', true); // hit (duplicado sem cache)\n                return { isNew: false, cachedResult: null };`
  );
  
  fs.writeFileSync(idempotencyPath, content);
  console.log('✅ Métricas adicionadas em idempotency-service.js');
}

// 3. Adicionar métricas no middleware CircuitBreaker (streams)
const streamsCircuitBreakerPath = path.join(__dirname, '../middleware/streams/CircuitBreaker.js');
if (fs.existsSync(streamsCircuitBreakerPath)) {
  let content = fs.readFileSync(streamsCircuitBreakerPath, 'utf8');
  
  // Adicionar import
  if (!content.includes("require('../../utils/prometheus-metrics')")) {
    content = content.replace(
      /class CircuitBreaker \{/,
      `const { metrics } = require('../../utils/prometheus-metrics');\n\nclass CircuitBreaker {`
    );
  }
  
  // Adicionar métricas quando estado muda
  content = content.replace(
    /this\.state = 'OPEN';/g,
    `this.state = 'OPEN';\n      metrics.setCircuitBreakerState(this.name, 'OPEN');`
  );
  
  content = content.replace(
    /this\.state = 'CLOSED';/g,
    `this.state = 'CLOSED';\n      metrics.setCircuitBreakerState(this.name, 'CLOSED');`
  );
  
  content = content.replace(
    /this\.state = 'HALF_OPEN';/g,
    `this.state = 'HALF_OPEN';\n      metrics.setCircuitBreakerState(this.name, 'HALF_OPEN');`
  );
  
  // Adicionar métrica quando falha é registrada
  content = content.replace(
    /this\.metrics\.failedRequests\+\+;/g,
    `this.metrics.failedRequests++;\n      metrics.recordCircuitBreakerFailure(this.name);`
  );
  
  fs.writeFileSync(streamsCircuitBreakerPath, content);
  console.log('✅ Métricas adicionadas em middleware/streams/CircuitBreaker.js');
}

console.log('\n✅ Métricas de Circuit Breakers e Idempotency integradas!');

