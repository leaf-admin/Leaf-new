/**
 * Script de Teste: Persistência de Chat no Firestore
 * 
 * Testa todas as funcionalidades do ChatPersistenceService com otimizações
 */

const chatPersistenceService = require('./services/chat-persistence-service');
const firebaseConfig = require('./firebase-config');
const admin = require('firebase-admin');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Contador de testes
let testsPassed = 0;
let testsFailed = 0;
let testsTotal = 0;

function test(name, testFn) {
    testsTotal++;
    try {
        log(`\n🧪 Teste: ${name}`, 'cyan');
        const result = testFn();
        if (result instanceof Promise) {
            return result.then(() => {
                testsPassed++;
                log(`✅ PASSOU: ${name}`, 'green');
            }).catch((error) => {
                testsFailed++;
                log(`❌ FALHOU: ${name}`, 'red');
                log(`   Erro: ${error.message}`, 'red');
                console.error(error);
            });
        } else {
            testsPassed++;
            log(`✅ PASSOU: ${name}`, 'green');
        }
    } catch (error) {
        testsFailed++;
        log(`❌ FALHOU: ${name}`, 'red');
        log(`   Erro: ${error.message}`, 'red');
        console.error(error);
    }
}

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE PERSISTÊNCIA DE CHAT\n', 'blue');
    log('='.repeat(60), 'blue');
    
    // IDs de teste
    const testConversationId = `test_conversation_${Date.now()}`;
    const testBookingId = testConversationId;
    const testRideId = testConversationId;
    const testSenderId = `test_sender_${Date.now()}`;
    const testReceiverId = `test_receiver_${Date.now()}`;
    
    // Teste 1: Salvar mensagem
    await test('Salvar mensagem no Firestore (saveMessage)', async () => {
        const messageData = {
            bookingId: testBookingId,
            rideId: testRideId,
            senderId: testSenderId,
            receiverId: testReceiverId,
            message: 'Teste de mensagem de chat',
            senderType: 'passenger',
            timestamp: new Date().toISOString()
        };
        
        const result = await chatPersistenceService.saveMessage(messageData);
        
        if (!result.success) {
            throw new Error(`Falha ao salvar mensagem: ${result.error}`);
        }
        
        log(`   ConversationId: ${testConversationId}`);
        log(`   MessageId: ${result.messageId}`);
        log(`   ExpiresAt: ${result.expiresAt}`);
        
        // Verificar se foi salvo no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('chat_messages').doc(result.messageId).get();
        
        if (!doc.exists) {
            throw new Error('Mensagem não foi criada no Firestore');
        }
        
        const data = doc.data();
        
        if (data.conversationId !== testConversationId) {
            throw new Error(`ConversationId incorreto`);
        }
        
        if (data.message !== 'Teste de mensagem de chat') {
            throw new Error(`Mensagem incorreta`);
        }
        
        if (!data.expiresAt) {
            throw new Error('expiresAt não foi salvo');
        }
        
        // Verificar TTL (deve ser ~30 dias)
        const expiresAtDate = data.expiresAt.toDate();
        const now = new Date();
        const daysUntilExpiry = Math.ceil((expiresAtDate - now) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry < 29 || daysUntilExpiry > 31) {
            throw new Error(`TTL incorreto. Esperado: ~30 dias, Recebido: ${daysUntilExpiry} dias`);
        }
        
        log(`   ✅ Mensagem salva corretamente`);
        log(`   TTL: ${daysUntilExpiry} dias (esperado: 30 dias)`);
    });
    
    // Teste 2: Salvar múltiplas mensagens para testar limite
    await test('Salvar múltiplas mensagens e testar limite (50 mensagens)', async () => {
        const messagesToCreate = 55; // Criar mais que o limite
        const savedMessageIds = [];
        
        for (let i = 0; i < messagesToCreate; i++) {
            const messageData = {
                bookingId: testBookingId,
                rideId: testRideId,
                senderId: testSenderId,
                receiverId: testReceiverId,
                message: `Mensagem ${i + 1}`,
                senderType: i % 2 === 0 ? 'passenger' : 'driver',
                timestamp: new Date().toISOString()
            };
            
            const result = await chatPersistenceService.saveMessage(messageData);
            if (result.success) {
                savedMessageIds.push(result.messageId);
            }
            
            // Pequeno delay para evitar conflitos de timestamp
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        log(`   ✅ ${messagesToCreate} mensagens criadas`);
        
        // Aguardar limpeza automática
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verificar quantas mensagens existem (deve ser <= 50)
        const messages = await chatPersistenceService.getMessages(testConversationId, 100);
        
        if (!messages.success) {
            throw new Error(`Falha ao buscar mensagens: ${messages.error}`);
        }
        
        if (messages.messages.length > 50) {
            throw new Error(`Limite de mensagens não funcionou. Esperado: <= 50, Recebido: ${messages.messages.length}`);
        }
        
        log(`   ✅ Limite funcionando: ${messages.messages.length} mensagens (máximo: 50)`);
    });
    
    // Teste 3: Buscar mensagens
    await test('Buscar mensagens de uma conversa (getMessages)', async () => {
        const result = await chatPersistenceService.getMessages(testConversationId, 50);
        
        if (!result.success) {
            throw new Error(`Falha ao buscar mensagens: ${result.error}`);
        }
        
        if (result.messages.length === 0) {
            throw new Error('Nenhuma mensagem encontrada');
        }
        
        // Verificar ordenação (mais recentes primeiro)
        for (let i = 0; i < result.messages.length - 1; i++) {
            const current = new Date(result.messages[i].timestamp || result.messages[i].createdAt);
            const next = new Date(result.messages[i + 1].timestamp || result.messages[i + 1].createdAt);
            
            if (current < next) {
                throw new Error('Mensagens não estão ordenadas (mais recentes primeiro)');
            }
        }
        
        log(`   ✅ ${result.messages.length} mensagens encontradas`);
        log(`   ✅ Mensagens ordenadas corretamente`);
    });
    
    // Teste 4: Marcar mensagem como lida
    await test('Marcar mensagem como lida (markMessageAsRead)', async () => {
        // Buscar primeira mensagem
        const messages = await chatPersistenceService.getMessages(testConversationId, 1);
        
        if (!messages.success || messages.messages.length === 0) {
            throw new Error('Nenhuma mensagem para marcar como lida');
        }
        
        const messageId = messages.messages[0].id;
        const result = await chatPersistenceService.markMessageAsRead(messageId);
        
        if (!result.success) {
            throw new Error(`Falha ao marcar como lida: ${result.error}`);
        }
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('chat_messages').doc(messageId).get();
        
        if (!doc.exists) {
            throw new Error('Mensagem não encontrada');
        }
        
        const data = doc.data();
        
        if (!data.read) {
            throw new Error('Mensagem não foi marcada como lida');
        }
        
        if (!data.readAt) {
            throw new Error('readAt não foi salvo');
        }
        
        log(`   ✅ Mensagem marcada como lida`);
    });
    
    // Teste 5: Estatísticas da conversa
    await test('Obter estatísticas da conversa (getConversationStats)', async () => {
        const stats = await chatPersistenceService.getConversationStats(testConversationId);
        
        if (!stats.success) {
            throw new Error(`Falha ao obter estatísticas: ${stats.error}`);
        }
        
        if (stats.totalMessages === 0) {
            throw new Error('Total de mensagens não pode ser zero');
        }
        
        if (stats.totalMessages > 50) {
            throw new Error(`Total de mensagens excede o limite. Esperado: <= 50, Recebido: ${stats.totalMessages}`);
        }
        
        if (stats.maxMessages !== 50) {
            throw new Error(`MaxMessages incorreto. Esperado: 50, Recebido: ${stats.maxMessages}`);
        }
        
        if (stats.ttlDays !== 30) {
            throw new Error(`TTLDays incorreto. Esperado: 30, Recebido: ${stats.ttlDays}`);
        }
        
        log(`   ✅ Estatísticas obtidas`);
        log(`   Total: ${stats.totalMessages}`);
        log(`   Lidas: ${stats.readMessages}`);
        log(`   Não lidas: ${stats.unreadMessages}`);
        log(`   Máximo: ${stats.maxMessages}`);
        log(`   TTL: ${stats.ttlDays} dias`);
    });
    
    // Teste 6: Limpar mensagens antigas manualmente
    await test('Limpar mensagens antigas manualmente (cleanupOldMessages)', async () => {
        // Criar mais mensagens
        for (let i = 0; i < 10; i++) {
            await chatPersistenceService.saveMessage({
                bookingId: testBookingId,
                senderId: testSenderId,
                receiverId: testReceiverId,
                message: `Mensagem extra ${i}`,
                senderType: 'passenger'
            });
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Limpar mantendo apenas 20 mensagens
        const result = await chatPersistenceService.cleanupOldMessages(testConversationId, 20);
        
        if (!result.success) {
            throw new Error(`Falha ao limpar: ${result.error}`);
        }
        
        // Verificar
        const messages = await chatPersistenceService.getMessages(testConversationId, 100);
        
        if (messages.messages.length > 20) {
            throw new Error(`Limpeza não funcionou. Esperado: <= 20, Recebido: ${messages.messages.length}`);
        }
        
        log(`   ✅ Limpeza funcionando`);
        log(`   Mensagens após limpeza: ${messages.messages.length}`);
        log(`   Mensagens deletadas: ${result.deletedCount || 0}`);
    });
    
    // Teste 7: Validar estrutura completa
    await test('Validar estrutura completa da mensagem', async () => {
        const messages = await chatPersistenceService.getMessages(testConversationId, 1);
        
        if (!messages.success || messages.messages.length === 0) {
            throw new Error('Nenhuma mensagem para validar');
        }
        
        const message = messages.messages[0];
        
        const requiredFields = [
            'id',
            'messageId',
            'conversationId',
            'senderId',
            'message',
            'timestamp'
        ];
        
        const missingFields = [];
        for (const field of requiredFields) {
            if (message[field] === undefined || message[field] === null) {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            throw new Error(`Campos faltando: ${missingFields.join(', ')}`);
        }
        
        log(`   ✅ Estrutura completa validada`);
        log(`   Total de campos: ${Object.keys(message).length}`);
    });
    
    // Resumo
    log('\n' + '='.repeat(60), 'blue');
    log(`\n📊 RESUMO DOS TESTES:`, 'blue');
    log(`   Total: ${testsTotal}`, 'cyan');
    log(`   ✅ Passou: ${testsPassed}`, 'green');
    log(`   ❌ Falhou: ${testsFailed}`, 'red');
    log(`   Taxa de sucesso: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`, 
        testsFailed === 0 ? 'green' : 'yellow');
    
    if (testsFailed === 0) {
        log(`\n🎉 TODOS OS TESTES PASSARAM!`, 'green');
        log(`\n✅ A persistência de chat está CORRETA e OTIMIZADA!`, 'green');
        log(`\n💰 Custo estimado: ~R$ 2-4/mês (MVP)`, 'cyan');
    } else {
        log(`\n⚠️ ALGUNS TESTES FALHARAM`, 'yellow');
        log(`   Verifique os erros acima`, 'yellow');
    }
    
    log(`\n🧹 Limpando documentos de teste...`, 'cyan');
    
    // Limpar documentos de teste
    try {
        const firestore = firebaseConfig.getFirestore();
        const messagesQuery = await firestore
            .collection('chat_messages')
            .where('conversationId', '==', testConversationId)
            .get();
        
        const batch = firestore.batch();
        messagesQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        log(`   ✅ ${messagesQuery.size} mensagens de teste removidas`, 'green');
    } catch (error) {
        log(`   ⚠️ Erro ao limpar documentos: ${error.message}`, 'yellow');
    }
    
    log(`\n✅ Testes concluídos!\n`, 'green');
    
    process.exit(testsFailed === 0 ? 0 : 1);
}

// Executar testes
runTests().catch((error) => {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});



