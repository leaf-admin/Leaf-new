/**
 * Script de teste para validar propagação de traceId
 */

const { validateTraceId, validateTracePropagation, ensureValidTraceId } = require('../utils/trace-validator');
const traceContext = require('../utils/trace-context');

console.log('🧪 Testando validação de traceId...\n');

// Teste 1: Validar traceId válido
console.log('Teste 1: Validar traceId válido');
const validTraceId = traceContext.generateTraceId('test');
const isValid = validateTraceId(validTraceId, 'test');
console.log(`✅ TraceId válido: ${validTraceId} -> ${isValid ? 'PASSOU' : 'FALHOU'}\n`);

// Teste 2: Validar traceId inválido (vazio)
console.log('Teste 2: Validar traceId vazio');
const isEmptyValid = validateTraceId('', 'test');
console.log(`✅ TraceId vazio: ${isEmptyValid ? 'FALHOU (esperado)' : 'PASSOU'}\n`);

// Teste 3: Validar traceId inválido (null)
console.log('Teste 3: Validar traceId null');
const isNullValid = validateTraceId(null, 'test');
console.log(`✅ TraceId null: ${isNullValid ? 'FALHOU (esperado)' : 'PASSOU'}\n`);

// Teste 4: Validar traceId inválido (formato errado)
console.log('Teste 4: Validar traceId com formato inválido');
const isFormatValid = validateTraceId('invalid-format', 'test');
console.log(`✅ TraceId formato inválido: ${isFormatValid ? 'FALHOU (esperado)' : 'PASSOU'}\n`);

// Teste 5: Garantir traceId válido (gera novo se inválido)
console.log('Teste 5: Garantir traceId válido (gera novo se inválido)');
const ensuredTraceId = ensureValidTraceId('invalid', 'test');
const isEnsuredValid = validateTraceId(ensuredTraceId, 'test');
console.log(`✅ TraceId garantido: ${ensuredTraceId} -> ${isEnsuredValid ? 'PASSOU' : 'FALHOU'}\n`);

// Teste 6: Validar propagação de traceId
console.log('Teste 6: Validar propagação de traceId através de múltiplos pontos');
const traceData = {
    handler: { traceId: validTraceId },
    command: { traceId: validTraceId },
    event: { traceId: validTraceId, metadata: { traceId: validTraceId } },
    listener: { traceId: validTraceId }
};
const propagationResult = validateTracePropagation(traceData);
console.log(`✅ Propagação válida: ${propagationResult.valid ? 'PASSOU' : 'FALHOU'}`);
if (propagationResult.errors.length > 0) {
    console.log(`   Erros: ${propagationResult.errors.join(', ')}`);
}
if (propagationResult.warnings.length > 0) {
    console.log(`   Avisos: ${propagationResult.warnings.join(', ')}`);
}
console.log(`   TraceIds: ${JSON.stringify(propagationResult.traceIds, null, 2)}\n`);

// Teste 7: Validar propagação com traceIds diferentes (deve gerar warning)
console.log('Teste 7: Validar propagação com traceIds diferentes');
const traceData2 = {
    handler: { traceId: validTraceId },
    command: { traceId: traceContext.generateTraceId('cmd') },
    event: { traceId: validTraceId }
};
const propagationResult2 = validateTracePropagation(traceData2);
console.log(`✅ Propagação com traceIds diferentes: ${propagationResult2.valid ? 'PASSOU' : 'FALHOU'}`);
if (propagationResult2.warnings.length > 0) {
    console.log(`   ⚠️  Avisos (esperados): ${propagationResult2.warnings.join(', ')}`);
}
console.log();

console.log('✅ Todos os testes concluídos!');

