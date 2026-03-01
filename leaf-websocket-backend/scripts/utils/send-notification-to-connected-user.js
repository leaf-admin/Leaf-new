#!/usr/bin/env node

/**
 * Script para enviar notificação para usuário conectado via WebSocket
 * Envia evento que o app processa e mostra como notificação local
 * Uso: node send-notification-to-connected-user.js [userId] [userType]
 */

const io = require('socket.io-client');

async function sendNotificationToConnectedUser() {
    try {
        const userId = process.argv[2] || 'test-user-dev';
        const userType = process.argv[3] || 'customer';
        
        console.log(`🔔 Enviando notificação para usuário conectado: ${userId} (${userType})\n`);
        
        const WEBSOCKET_URL = process.env.WEBSOCKET_URL || 'http://216.238.107.59:3001';
        
        console.log(`🔌 Conectando ao WebSocket: ${WEBSOCKET_URL}`);
        
        const socket = io(WEBSOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });
        
        socket.on('connect', () => {
            console.log('✅ Conectado ao WebSocket');
            console.log('📤 Enviando notificação...\n');
            
            // Enviar notificação diretamente para o usuário via WebSocket
            // O app deve estar escutando este evento e mostrar como notificação local
            socket.emit('sendNotificationToUser', {
                userId: userId,
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
            console.log('💡 O app deve receber e mostrar a notificação');
            
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
        
        socket.on('notificationSent', (data) => {
            console.log('✅ Confirmação recebida:', data);
        });
        
        socket.on('notificationError', (data) => {
            console.log('❌ Erro:', data);
        });
        
        // Timeout de 10 segundos
        setTimeout(() => {
            console.log('⏱️ Timeout ao aguardar conexão');
            socket.disconnect();
            process.exit(1);
        }, 10000);
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        process.exit(1);
    }
}

// Executar
sendNotificationToConnectedUser();

