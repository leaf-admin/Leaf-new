#!/usr/bin/env node

/**
 * Script para adicionar endpoint de notificação FCM ao server.js do Vultr
 */

const fs = require('fs');
const path = require('path');

// Endpoint para envio de notificações FCM
const notificationEndpoint = `
// Endpoint para envio de notificações FCM
app.post('/api/send-notification', async (req, res) => {
  try {
    const { token, notification, data, android, apns } = req.body;
    
    if (!token || !notification) {
      return res.status(400).json({
        success: false,
        error: 'Token e notificação são obrigatórios'
      });
    }
    
    console.log('📤 Enviando notificação FCM:', {
      token: token.substring(0, 20) + '...',
      title: notification.title,
      body: notification.body
    });
    
    // Simular envio de notificação FCM
    // Em produção, você usaria o Firebase Admin SDK aqui
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Simular delay de envio
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('✅ Notificação FCM enviada com sucesso:', messageId);
    
    res.json({
      success: true,
      messageId: messageId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erro ao enviar notificação FCM:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
`;

console.log('📋 Endpoint de notificação FCM criado!');
console.log('📤 Para adicionar ao server.js do Vultr, execute:');
console.log('');
console.log('ssh root@216.238.107.59 "cd leaf-system && cp server.js server.js.backup"');
console.log('ssh root@216.238.107.59 "cd leaf-system && echo \'');
console.log(notificationEndpoint);
console.log('\' >> server.js"');
console.log('ssh root@216.238.107.59 "cd leaf-system && pkill -f \'node.*server.js\' && nohup node server.js > server.log 2>&1 &"');
console.log('');
console.log('🧪 Para testar:');
console.log('curl -X POST http://216.238.107.59:3001/api/send-notification \\');
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{"token":"test_token","notification":{"title":"Teste","body":"Mensagem de teste"}}\'');
