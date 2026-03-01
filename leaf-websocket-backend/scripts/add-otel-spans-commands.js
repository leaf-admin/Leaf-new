#!/usr/bin/env node
/**
 * Script para adicionar spans OpenTelemetry nos Commands restantes
 */

const fs = require('fs');
const path = require('path');

const commandsToProcess = [
  'CompleteTripCommand',
  'CancelRideCommand'
];

for (const commandName of commandsToProcess) {
  const filePath = path.join(__dirname, '../commands', `${commandName}.js`);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // 1. Adicionar imports
  if (!content.includes("require('../utils/tracer')")) {
    content = content.replace(
      /const traceContext = require\('\.\.\/utils\/trace-context'\);/,
      `const traceContext = require('../utils/trace-context');\nconst { getTracer } = require('../utils/tracer');\nconst { SpanStatusCode } = require('@opentelemetry/api');`
    );
  }
  
  // 2. Adicionar span no início do execute()
  content = content.replace(
    /async execute\(\) \{[\s\S]*?\/\/ ✅ OBSERVABILIDADE: Executar com traceId[\s\S]*?return await traceContext\.runWithTraceId\(this\.traceId, async \(\) => \{/,
    `async execute() {
        // ✅ OBSERVABILIDADE: Executar com traceId + OpenTelemetry span
        const tracer = getTracer();
        const span = tracer.startSpan('${commandName}.execute', {
            attributes: {
                'command.name': '${commandName}',
                'booking.id': this.bookingId,
                'trace.id': this.traceId
            }
        });
        
        return await traceContext.runWithTraceId(this.traceId, async () => {`
  );
  
  // 3. Adicionar span.end() e status nos returns
  // Failure cases
  content = content.replace(
    /return CommandResult\.failure\('Corrida não encontrada'\);/g,
    `span.setStatus({ code: SpanStatusCode.ERROR, message: 'Corrida não encontrada' });\n                span.end();\n                return CommandResult.failure('Corrida não encontrada');`
  );
  
  content = content.replace(
    /return CommandResult\.failure\('Motorista não autorizado para ([^']+) esta corrida'\);/g,
    `span.setStatus({ code: SpanStatusCode.ERROR, message: 'Motorista não autorizado' });\n                span.end();\n                return CommandResult.failure('Motorista não autorizado para $1 esta corrida');`
  );
  
  content = content.replace(
    /return CommandResult\.failure\(\s*`([^`]+)`\s*\);/g,
    (match, msg) => {
      return `span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid state transition' });\n                span.end();\n                return CommandResult.failure(\`${msg}\`);`;
    }
  );
  
  // Success case - antes do return final
  content = content.replace(
    /(logStructured\('info', '${commandName} executado com sucesso'[\s\S]*?\);)\s*(\/\/ Retornar resultado)/,
    `$1\n\n                span.setStatus({ code: SpanStatusCode.OK });\n                span.end();\n\n                $2`
  );
  
  // Error catch
  content = content.replace(
    /} catch \(error\) \{[\s\S]*?logStructured\('error', '([^']+) falhou'/,
    `} catch (error) {\n                span.recordException(error);\n                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });\n                span.end();\n                \n                logStructured('error', '$1 falhou'`
  );
  
  fs.writeFileSync(filePath, content);
  console.log(`✅ ${commandName} atualizado com spans OpenTelemetry`);
}

console.log('\n✅ Todos os Commands atualizados!');

