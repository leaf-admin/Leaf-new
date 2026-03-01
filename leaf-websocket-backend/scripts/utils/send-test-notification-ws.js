#!/usr/bin/env node

/**
 * Script para enviar notificação de teste via WebSocket
 * Envia para todos os usuários conectados
 * Uso: node send-test-notification-ws.js
 */

const io = require('socket.io-client');

async function sendTestNotification() {
    try {
        console.log('🔔 Enviando notificação de teste via WebSocket...\n');
        
        const WEBSOCKET_URL = process.env.WEBSOCKET_URL || 'http://216.238.107.59:3001';
        
        console.log(`🔌 Conectando ao WebSocket: ${WEBSOCKET_URL}`);
        
        const socket = io(WEBSOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true
        });
        
        socket.on('connect', () => {
            console.log('✅ Conectado ao WebSocket');
            console.log('📤 Enviando notificação de teste...\n');
            
            // Enviar notificação para todos os usuários conectados
            socket.emit('sendNotificationToUserType', {
                userType: 'customer', // ou 'driver'
                notification: {
                    title: '🔔 Notificação de Teste',
                    body: 'Esta é uma notificação de teste do Leaf App!',
                    data: {
                        type: 'test',
                        timestamp: new Date().toISOString(),
                        test: true
                    }
                },
                timestamp: new Date().toISOString()
            });
            
            console.log('✅ Notificação enviada via WebSocket');
            console.log('💡 Verifique o dispositivo conectado');
            
            // Aguardar confirmação
            setTimeout(() => {
                socket.disconnect();
                process.exit(0);
            }, 2000);
        });
        
        socket.on('connect_error', (error) => {
            console.error('❌ Erro ao conectar:', error.message);
            process.exit(1);
        });
        
        socket.on('notificationSentToUserType', (data) => {
            console.log('✅ Confirmação recebida:', data);
        });
        
        // Timeout de 10 segundos
        setTimeout(() => {
            console.log('⏱️ Timeout ao aguardar conexão');
            socket.disconnect();
            process.exit(1);
        }, 10000);
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Executar
sendTestNotification();

