#!/usr/bin/env node

/**
 * 🔔 TESTE SIMPLES DE NOTIFICAÇÃO
 * Envia notificação para todos os drivers ou customers
 */

const axios = require('axios');
const https = require('https');

// Permitir certificados auto-assinados para desenvolvimento
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const API_URL = process.env.API_URL || 'http://147.93.66.253:3001';
const NOTIFICATION_ENDPOINT = `${API_URL}/api/notifications/send`;

async function testNotification() {
    try {
        console.log('🔔 TESTE DE NOTIFICAÇÃO PUSH\n');
        console.log('📡 API:', API_URL);
        console.log('📍 Endpoint:', NOTIFICATION_ENDPOINT);
        console.log('');
        
        // Teste 1: Enviar para todos os drivers
        console.log('📤 Teste 1: Enviando para TODOS os drivers...');
        const response1 = await axios.post(NOTIFICATION_ENDPOINT, {
            userTypes: ['driver'],
            title: '🔔 Teste de Notificação',
            body: 'Esta é uma notificação de teste do sistema Leaf. Se você recebeu isso, o sistema está funcionando!',
            data: {
                type: 'test',
                timestamp: new Date().toISOString(),
                testId: 'test-' + Date.now()
            },
            priority: 'high'
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        console.log('✅ Resposta:', JSON.stringify(response1.data, null, 2));
        console.log('');
        
        // Aguardar 2 segundos
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Teste 2: Enviar para todos os customers
        console.log('📤 Teste 2: Enviando para TODOS os customers...');
        const response2 = await axios.post(NOTIFICATION_ENDPOINT, {
            userTypes: ['customer'],
            title: '🔔 Teste de Notificação',
            body: 'Esta é uma notificação de teste do sistema Leaf. Se você recebeu isso, o sistema está funcionando!',
            data: {
                type: 'test',
                timestamp: new Date().toISOString(),
                testId: 'test-' + Date.now()
            },
            priority: 'high'
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000,
            httpsAgent: API_URL.startsWith('https') ? httpsAgent : undefined
        });
        
        console.log('✅ Resposta:', JSON.stringify(response2.data, null, 2));
        console.log('');
        
        console.log('✅ TESTE CONCLUÍDO!');
        console.log('');
        console.log('📱 Verifique os dispositivos:');
        console.log('   • Drivers devem receber a notificação');
        console.log('   • Customers devem receber a notificação');
        console.log('   • Se não receber, verifique se o token FCM está registrado');
        
    } catch (error) {
        console.error('❌ Erro ao enviar notificação:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Dados:', error.response.data);
        }
        process.exit(1);
    }
}

testNotification();

