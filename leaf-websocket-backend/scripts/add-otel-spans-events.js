#!/usr/bin/env node
/**
 * Script para adicionar spans OpenTelemetry nos eventos
 * Os spans devem ser adicionados onde os eventos são publicados/processados
 */

const fs = require('fs');
const path = require('path');

// Adicionar spans no event sourcing
const eventSourcingPath = path.join(__dirname, '../services/event-sourcing.js');
if (fs.existsSync(eventSourcingPath)) {
  let content = fs.readFileSync(eventSourcingPath, 'utf8');
  
  // Adicionar imports se não existir
  if (!content.includes("require('../utils/tracer')")) {
    content = content.replace(
      /const { logStructured, logError } = require\('\.\.\/utils\/logger'\);/,
      `const { logStructured, logError } = require('../utils/logger');\nconst { getTracer } = require('../utils/tracer');\nconst { SpanStatusCode } = require('@opentelemetry/api');`
    );
  }
  
  // Adicionar span na função recordEvent
  content = content.replace(
    /async recordEvent\(eventType, eventData\) \{/,
    `async recordEvent(eventType, eventData) {\n        const tracer = getTracer();\n        const span = tracer.startSpan('event-sourcing.recordEvent', {\n            attributes: {\n                'event.type': eventType,\n                'booking.id': eventData.bookingId || 'N/A',\n                'trace.id': eventData.traceId || 'N/A'\n            }\n        });\n        \n        try {`
  );
  
  // Adicionar span.end() antes dos returns
  content = content.replace(
    /return \{ success: true, eventId \};/g,
    `span.setStatus({ code: SpanStatusCode.OK });\n            span.end();\n            return { success: true, eventId };`
  );
  
  content = content.replace(
    /return \{ success: false, error: error\.message \};/g,
    `span.recordException(error);\n            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });\n            span.end();\n            return { success: false, error: error.message };`
  );
  
  // Fechar try se ainda não tiver catch
  if (!content.includes('} catch (error) {') && content.includes('async recordEvent')) {
    content = content.replace(
      /(\s+)return \{ success: true, eventId \};/,
      `$1return { success: true, eventId };\n        } catch (error) {\n            span.recordException(error);\n            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });\n            span.end();\n            throw error;\n        }`
    );
  }
  
  fs.writeFileSync(eventSourcingPath, content);
  console.log('✅ event-sourcing.js atualizado com spans OpenTelemetry');
}

// Adicionar spans nos listeners
const listenersDir = path.join(__dirname, '../listeners');
if (fs.existsSync(listenersDir)) {
  const listenerFiles = fs.readdirSync(listenersDir).filter(f => f.endsWith('.js') && !f.includes('index'));
  
  for (const file of listenerFiles) {
    const filePath = path.join(listenersDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Adicionar imports
    if (!content.includes("require('../utils/tracer')") && content.includes('async handle(event)')) {
      content = content.replace(
        /const { logStructured } = require\('\.\.\/utils\/logger'\);/,
        `const { logStructured } = require('../utils/logger');\nconst { getTracer } = require('../utils/tracer');\nconst { SpanStatusCode } = require('@opentelemetry/api');`
      );
      
      // Adicionar span no handle
      content = content.replace(
        /async handle\(event\) \{/,
        `async handle(event) {\n        const tracer = getTracer();\n        const listenerName = this.constructor.name;\n        const span = tracer.startSpan(\`\${listenerName}.handle\`, {\n            attributes: {\n                'listener.name': listenerName,\n                'event.type': event.eventType,\n                'booking.id': event.data?.bookingId || 'N/A',\n                'trace.id': event.data?.traceId || 'N/A'\n            }\n        });\n        \n        try {`
      );
      
      // Fechar span no final do handle
      const lines = content.split('\n');
      let inHandle = false;
      let braceCount = 0;
      let handleStartLine = -1;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('async handle(event)')) {
          inHandle = true;
          handleStartLine = i;
        }
        
        if (inHandle) {
          braceCount += (lines[i].match(/\{/g) || []).length;
          braceCount -= (lines[i].match(/\}/g) || []).length;
          
          if (braceCount === 0 && i > handleStartLine) {
            // Adicionar span.end() antes do }
            lines[i] = `            span.setStatus({ code: SpanStatusCode.OK });\n            span.end();\n        } catch (error) {\n            span.recordException(error);\n            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });\n            span.end();\n            throw error;\n        }\n    }`;
            break;
          }
        }
      }
      
      content = lines.join('\n');
      fs.writeFileSync(filePath, content);
      console.log(`✅ ${file} atualizado com spans OpenTelemetry`);
    }
  }
}

console.log('\n✅ Spans OpenTelemetry adicionados aos eventos e listeners!');

