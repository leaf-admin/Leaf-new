#!/usr/bin/env node
/**
 * Script para integrar métricas Prometheus automaticamente
 * 1. Adicionar endpoint /metrics no server.js
 * 2. Integrar métricas nos Commands
 * 3. Integrar métricas nos Events
 * 4. Integrar métricas nos Listeners
 * 5. Integrar métricas no Redis
 */

const fs = require('fs');
const path = require('path');

// 1. Adicionar endpoint /metrics no server.js
const serverPath = path.join(__dirname, '../server.js');
if (fs.existsSync(serverPath)) {
  let content = fs.readFileSync(serverPath, 'utf8');
  
  // Verificar se já tem endpoint /metrics
  if (!content.includes('app.get(\'/metrics\'')) {
    // Adicionar import
    if (!content.includes("require('./utils/prometheus-metrics')")) {
      content = content.replace(
        /const metricsRoutes = require\('\.\/routes\/metrics'\);/,
        `const metricsRoutes = require('./routes/metrics');\nconst { getMetrics } = require('./utils/prometheus-metrics');`
      );
    }
    
    // Adicionar endpoint após outras rotas
    content = content.replace(
      /(app\.use\('\/', metricsRoutes\);)/,
      `$1\n\n    // ✅ Prometheus metrics endpoint\n    app.get('/metrics', async (req, res) => {\n        try {\n            res.set('Content-Type', 'text/plain');\n            const metrics = await getMetrics();\n            res.send(metrics);\n        } catch (error) {\n            res.status(500).send('Erro ao obter métricas');\n        }\n    });`
    );
    
    fs.writeFileSync(serverPath, content);
    console.log('✅ Endpoint /metrics adicionado ao server.js');
  } else {
    console.log('⏭️  Endpoint /metrics já existe no server.js');
  }
}

// 2. Integrar métricas nos Commands
const commandsDir = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('Command.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Adicionar import
  if (!content.includes("require('../utils/prometheus-metrics')")) {
    content = content.replace(
      /const traceContext = require\('\.\.\/utils\/trace-context'\);/,
      `const traceContext = require('../utils/trace-context');\nconst { metrics } = require('../utils/prometheus-metrics');`
    );
  }
  
  // Adicionar métricas no execute()
  const commandName = file.replace('Command.js', '');
  
  // Adicionar timer no início
  content = content.replace(
    /async execute\(\) \{/,
    `async execute() {\n        const startTime = Date.now();`
  );
  
  // Adicionar métricas no sucesso (antes do return success)
  content = content.replace(
    /(return CommandResult\.success\([^)]+\));/g,
    `metrics.recordCommand('${commandName}', (Date.now() - startTime) / 1000, true);\n                $1`
  );
  
  // Adicionar métricas na falha (antes do return failure)
  content = content.replace(
    /(return CommandResult\.failure\([^)]+\));/g,
    `metrics.recordCommand('${commandName}', (Date.now() - startTime) / 1000, false);\n                $1`
  );
  
  // Adicionar métricas no catch
  content = content.replace(
    /} catch \(error\) \{[\s\S]*?return CommandResult\.failure\(error\.message\);/,
    (match) => {
      return match.replace(
        /return CommandResult\.failure\(error\.message\);/,
        `metrics.recordCommand('${commandName}', (Date.now() - startTime) / 1000, false);\n                return CommandResult.failure(error.message);`
      );
    }
  );
  
  fs.writeFileSync(filePath, content);
  console.log(`✅ Métricas adicionadas em ${file}`);
}

// 3. Integrar métricas no event-sourcing.js
const eventSourcingPath = path.join(__dirname, '../services/event-sourcing.js');
if (fs.existsSync(eventSourcingPath)) {
  let content = fs.readFileSync(eventSourcingPath, 'utf8');
  
  // Adicionar import
  if (!content.includes("require('../utils/prometheus-metrics')")) {
    content = content.replace(
      /const { logStructured, logError } = require\('\.\.\/utils\/logger'\);/,
      `const { logStructured, logError } = require('../utils/logger');\nconst { metrics } = require('../utils/prometheus-metrics');`
    );
  }
  
  // Adicionar métrica quando evento é publicado
  content = content.replace(
    /(await this\.redis\.xadd\(streamKey, '\*',[^)]+\));/,
    `$1\n            metrics.recordEventPublished(eventType);`
  );
  
  fs.writeFileSync(eventSourcingPath, content);
  console.log('✅ Métricas adicionadas em event-sourcing.js');
}

// 4. Integrar métricas nos Listeners
const listenersDir = path.join(__dirname, '../listeners');
if (fs.existsSync(listenersDir)) {
  const listenerFiles = fs.readdirSync(listenersDir).filter(f => f.endsWith('.js') && !f.includes('index'));
  
  for (const file of listenerFiles) {
    const filePath = path.join(listenersDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Adicionar import
    if (!content.includes("require('../utils/prometheus-metrics')")) {
      content = content.replace(
        /const { logStructured } = require\('\.\.\/utils\/logger'\);/,
        `const { logStructured } = require('../utils/logger');\nconst { metrics } = require('../utils/prometheus-metrics');`
      );
    }
    
    // Adicionar métricas no handle()
    const listenerName = file.replace('.js', '');
    
    content = content.replace(
      /async handle\(event\) \{/,
      `async handle(event) {\n        const startTime = Date.now();\n        const eventType = event.eventType || 'unknown';`
    );
    
    // Adicionar métricas no sucesso (final do handle)
    content = content.replace(
      /(\s+)(logStructured\('info', '[^']+', \{[\s\S]*?\}\);)/,
      `$1metrics.recordListener('${listenerName}', (Date.now() - startTime) / 1000, true);\n$1metrics.recordEventConsumed(eventType, '${listenerName}');\n$1$2`
    );
    
    // Adicionar métricas no catch
    if (content.includes('} catch (error) {')) {
      content = content.replace(
        /} catch \(error\) \{[\s\S]*?throw error;/,
        (match) => {
          return match.replace(
            /throw error;/,
            `metrics.recordListener('${listenerName}', (Date.now() - startTime) / 1000, false);\n            throw error;`
          );
        }
      );
    }
    
    fs.writeFileSync(filePath, content);
    console.log(`✅ Métricas adicionadas em ${file}`);
  }
}

// 5. Integrar métricas no Redis (já feito no script anterior, mas vamos garantir)
const redisPoolPath = path.join(__dirname, '../utils/redis-pool.js');
if (fs.existsSync(redisPoolPath)) {
  let content = fs.readFileSync(redisPoolPath, 'utf8');
  
  // Adicionar import se não existir
  if (!content.includes("require('./prometheus-metrics')")) {
    content = content.replace(
      /const traceContext = require\('\.\/trace-context'\);/,
      `const traceContext = require('./trace-context');\nconst { metrics } = require('./prometheus-metrics');`
    );
  }
  
  // Verificar se wrapRedisOperation já tem métricas
  if (content.includes('wrapRedisOperation') && !content.includes('metrics.recordRedis')) {
    // Adicionar métricas no wrapper
    content = content.replace(
      /redis\.hget = async function\(\.\.\.args\) \{[\s\S]*?const span = tracer\.startSpan/,
      `redis.hget = async function(...args) {\n        const startTime = Date.now();\n        const span = tracer.startSpan`
    );
    
    content = content.replace(
      /redis\.hget = async function\(\.\.\.args\) \{[\s\S]*?span\.setStatus\(\{ code: SpanStatusCode\.OK \}\);/,
      (match) => {
        return match.replace(
          /span\.setStatus\(\{ code: SpanStatusCode\.OK \}\);/,
          `span.setStatus({ code: SpanStatusCode.OK });\n            metrics.recordRedis('hget', (Date.now() - startTime) / 1000, true);`
        );
      }
    );
    
    content = content.replace(
      /span\.setStatus\(\{ code: SpanStatusCode\.ERROR \}\);/,
      `span.setStatus({ code: SpanStatusCode.ERROR });\n            metrics.recordRedis('hget', (Date.now() - startTime) / 1000, false);`
    );
  }
  
  fs.writeFileSync(redisPoolPath, content);
  console.log('✅ Métricas Redis verificadas/atualizadas');
}

console.log('\n✅ Integração de métricas Prometheus concluída!');
console.log('📊 Acesse http://localhost:3001/metrics para ver as métricas');

