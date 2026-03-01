#!/usr/bin/env node

/**
 * 🔔 SCRIPT DE TESTE: Enviar Notificação Push
 * 
 * Testa o envio de notificações push via API
 * 
 * Uso:
 *   node scripts/test-notification-send.js <userId> <userType> <title> <body>
 * 
 * Exemplo:
 *   node scripts/test-notification-send.js driver_123 driver "Teste" "Esta é uma notificação de teste"
 */

const axios = require('axios');
const readline = require('readline');

const API_URL = process.env.API_URL || 'https://api.leaf.app.br';
const NOTIFICATION_ENDPOINT = `${API_URL}/api/notifications/send`;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function sendNotification(userIds, userTypes, title, body, data = {}) {
    try {
        console.log('🔔 Enviando notificação...');
        console.log('   Destinatários:', userIds || userTypes);
        console.log('   Título:', title);
        console.log('   Mensagem:', body);
        
        const response = await axios.post(NOTIFICATION_ENDPOINT, {
            userIds: userIds || undefined,
            userTypes: userTypes || undefined,
            title,
            body,
            data: {
                type: 'test',
                timestamp: new Date().toISOString(),
                ...data
            },
            priority: 'high'
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        
        if (response.data.success) {
            console.log('✅ Notificação enviada com sucesso!');
            console.log('   Resultado:', JSON.stringify(response.data.data, null, 2));
            return true;
        } else {
            console.error('❌ Erro ao enviar notificação:', response.data.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Erro ao enviar notificação:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Dados:', error.response.data);
        }
        return false;
    }
}

async function testNotification() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Modo interativo
        console.log('🔔 TESTE DE NOTIFICAÇÃO PUSH\n');
        
        rl.question('Tipo de teste:\n1. Por userId\n2. Por userType (driver/customer)\n3. Por fcmToken\nEscolha (1/2/3): ', async (choice) => {
            if (choice === '1') {
                rl.question('User ID: ', async (userId) => {
                    rl.question('Título: ', async (title) => {
                        rl.question('Mensagem: ', async (body) => {
                            await sendNotification([userId], null, title, body);
                            rl.close();
                        });
                    });
                });
            } else if (choice === '2') {
                rl.question('User Type (driver/customer): ', async (userType) => {
                    rl.question('Título: ', async (title) => {
                        rl.question('Mensagem: ', async (body) => {
                            await sendNotification(null, [userType], title, body);
                            rl.close();
                        });
                    });
                });
            } else if (choice === '3') {
                rl.question('FCM Token: ', async (fcmToken) => {
                    rl.question('Título: ', async (title) => {
                        rl.question('Mensagem: ', async (body) => {
                            try {
                                const response = await axios.post(NOTIFICATION_ENDPOINT, {
                                    fcmToken,
                                    title,
                                    body,
                                    data: {
                                        type: 'test',
                                        timestamp: new Date().toISOString()
                                    }
                                });
                                console.log('✅ Notificação enviada!', response.data);
                            } catch (error) {
                                console.error('❌ Erro:', error.message);
                            }
                            rl.close();
                        });
                    });
                });
            } else {
                console.log('Opção inválida');
                rl.close();
            }
        });
    } else {
        // Modo com argumentos
        const [userId, userType, title, body] = args;
        
        if (!userId || !userType || !title || !body) {
            console.log('Uso: node scripts/test-notification-send.js <userId> <userType> <title> <body>');
            console.log('Exemplo: node scripts/test-notification-send.js driver_123 driver "Teste" "Esta é uma notificação"');
            process.exit(1);
        }
        
        const userIds = userId !== 'all' ? [userId] : null;
        const userTypes = userType !== 'all' ? [userType] : null;
        
        await sendNotification(userIds, userTypes, title, body);
        process.exit(0);
    }
}

testNotification();

