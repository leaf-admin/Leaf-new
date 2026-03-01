/**
 * Script de teste para webhook do Slack
 * 
 * Uso:
 *   WEBHOOK_URL=https://hooks.slack.com/services/... node scripts/utils/test-slack-webhook.js
 */

const axios = require('axios');

const webhookUrl = process.env.WEBHOOK_URL;

if (!webhookUrl) {
    console.error('❌ WEBHOOK_URL não configurado!');
    console.log('\nUso:');
    console.log('  WEBHOOK_URL=https://hooks.slack.com/services/... node scripts/utils/test-slack-webhook.js');
    process.exit(1);
}

const testAlert = {
    text: `🚨 *Teste de Alerta - LEAF Server*`,
    attachments: [{
        color: 'warning',
        title: '🟡 TESTE: Sistema de Alertas',
        fields: [
            { title: 'Métrica', value: 'CPU', short: true },
            { title: 'Valor Atual', value: '72%', short: true },
            { title: 'Limite', value: '70%', short: true },
            { title: 'Severidade', value: 'WARNING', short: true },
            { title: 'Servidor', value: process.env.SERVER_NAME || 'LEAF-Test', short: true },
            { title: 'Timestamp', value: new Date().toLocaleString('pt-BR'), short: true }
        ],
        text: 'Este é um teste de configuração do sistema de alertas do LEAF. Se você está vendo esta mensagem, a integração com Slack está funcionando corretamente! ✅',
        footer: 'LEAF Server Monitor',
        ts: Math.floor(Date.now() / 1000)
    }]
};

console.log('📤 Enviando teste de alerta para Slack...');
console.log(`   URL: ${webhookUrl.substring(0, 50)}...`);

axios.post(webhookUrl, testAlert, {
    headers: {
        'Content-Type': 'application/json'
    },
    timeout: 10000
})
    .then(response => {
        if (response.status === 200) {
            console.log('✅ Teste enviado com sucesso!');
            console.log('   Verifique o canal do Slack para confirmar.');
        } else {
            console.log(`⚠️  Resposta inesperada: ${response.status}`);
        }
    })
    .catch(error => {
        console.error('❌ Erro ao enviar teste:');
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, error.response.data);
        } else if (error.request) {
            console.error('   Não foi possível conectar ao Slack');
            console.error('   Verifique a URL do webhook');
        } else {
            console.error(`   ${error.message}`);
        }
        process.exit(1);
    });
