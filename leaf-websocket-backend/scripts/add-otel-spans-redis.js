#!/usr/bin/env node
/**
 * Script para adicionar spans OpenTelemetry nas operações Redis
 */

const fs = require('fs');
const path = require('path');

// 1. Adicionar spans no redis-pool.js
const redisPoolPath = path.join(__dirname, '../utils/redis-pool.js');
if (fs.existsSync(redisPoolPath)) {
  let content = fs.readFileSync(redisPoolPath, 'utf8');
  
  // Adicionar imports
  if (!content.includes("require('./tracer')")) {
    content = content.replace(
      /const Redis = require\('ioredis'\);/,
      `const Redis = require('ioredis');\nconst { getTracer } = require('./tracer');\nconst { SpanStatusCode } = require('@opentelemetry/api');`
    );
  }
  
  // Criar wrapper para operações críticas
  const wrapperCode = `
// ✅ Wrapper para adicionar spans em operações Redis críticas
function wrapRedisOperation(redis) {
  const tracer = getTracer();
  const originalHget = redis.hget.bind(redis);
  const originalHgetall = redis.hgetall.bind(redis);
  const originalHset = redis.hset.bind(redis);
  const originalGet = redis.get.bind(redis);
  const originalSet = redis.set.bind(redis);
  const originalDel = redis.del.bind(redis);
  
  redis.hget = async function(...args) {
    const span = tracer.startSpan('redis.hget', {
      attributes: { 'redis.command': 'hget', 'redis.key': args[0] }
    });
    try {
      const result = await originalHget(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  
  redis.hgetall = async function(...args) {
    const span = tracer.startSpan('redis.hgetall', {
      attributes: { 'redis.command': 'hgetall', 'redis.key': args[0] }
    });
    try {
      const result = await originalHgetall(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  
  redis.hset = async function(...args) {
    const span = tracer.startSpan('redis.hset', {
      attributes: { 'redis.command': 'hset', 'redis.key': args[0] }
    });
    try {
      const result = await originalHset(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  
  redis.get = async function(...args) {
    const span = tracer.startSpan('redis.get', {
      attributes: { 'redis.command': 'get', 'redis.key': args[0] }
    });
    try {
      const result = await originalGet(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  
  redis.set = async function(...args) {
    const span = tracer.startSpan('redis.set', {
      attributes: { 'redis.command': 'set', 'redis.key': args[0] }
    });
    try {
      const result = await originalSet(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  
  redis.del = async function(...args) {
    const span = tracer.startSpan('redis.del', {
      attributes: { 'redis.command': 'del', 'redis.key': args[0] }
    });
    try {
      const result = await originalDel(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  
  return redis;
}
`;
  
  // Adicionar wrapper após criar conexão
  if (!content.includes('wrapRedisOperation')) {
    content = content.replace(
      /module\.exports = \{/,
      `${wrapperCode}\n\nmodule.exports = {`
    );
    
    // Aplicar wrapper no getConnection
    content = content.replace(
      /getConnection\(\) \{[\s\S]*?return this\.connection;/,
      `getConnection() {\n        if (!this.connection) {\n            throw new Error('Redis não está conectado. Chame ensureConnection() primeiro.');\n        }\n        return wrapRedisOperation(this.connection);`
    );
  }
  
  fs.writeFileSync(redisPoolPath, content);
  console.log('✅ redis-pool.js atualizado com spans OpenTelemetry');
}

console.log('\n✅ Spans OpenTelemetry adicionados às operações Redis!');

