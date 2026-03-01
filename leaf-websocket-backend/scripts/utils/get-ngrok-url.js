#!/usr/bin/env node

/**
 * Script para obter URL do ngrok em execução
 * 
 * Uso:
 *   node scripts/utils/get-ngrok-url.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NGROK_CONFIG_FILE = path.join(__dirname, '../../.ngrok-url.json');

async function getNgrokUrl() {
  try {
    // Tentar obter via API do ngrok
    const response = await axios.get('http://127.0.0.1:4040/api/tunnels', {
      timeout: 3000
    });
    
    if (response.data && response.data.tunnels && response.data.tunnels.length > 0) {
      const httpsTunnel = response.data.tunnels.find(t => t.proto === 'https');
      if (httpsTunnel) {
        const url = httpsTunnel.public_url;
        const webhookUrl = `${url}/api/woovi/webhook`;
        
        console.log('✅ ngrok está rodando!');
        console.log('');
        console.log(`🌐 URL Pública: ${url}`);
        console.log(`🔗 Webhook URL: ${webhookUrl}`);
        console.log('');
        console.log('📋 Para usar:');
        console.log(`   export WOOVI_WEBHOOK_URL="${webhookUrl}"`);
        console.log('');
        
        // Salvar em arquivo
        try {
          fs.writeFileSync(NGROK_CONFIG_FILE, JSON.stringify({
            url: url,
            webhookUrl: webhookUrl,
            port: httpsTunnel.config.addr.split(':')[1],
            retrievedAt: new Date().toISOString()
          }, null, 2));
        } catch (error) {
          // Ignorar
        }
        
        return { url, webhookUrl };
      }
    }
    
    console.log('⚠️ Nenhum túnel HTTPS encontrado');
    return null;
  } catch (error) {
    // Tentar ler do arquivo
    if (fs.existsSync(NGROK_CONFIG_FILE)) {
      try {
        const config = JSON.parse(fs.readFileSync(NGROK_CONFIG_FILE, 'utf8'));
        console.log('📄 URL encontrada no arquivo:');
        console.log('');
        console.log(`🌐 URL Pública: ${config.url}`);
        console.log(`🔗 Webhook URL: ${config.webhookUrl}`);
        console.log('');
        console.log('⚠️ Verifique se o ngrok ainda está rodando!');
        console.log('');
        return { url: config.url, webhookUrl: config.webhookUrl };
      } catch (error) {
        // Ignorar
      }
    }
    
    console.error('❌ ngrok não está rodando ou não está acessível');
    console.error('');
    console.error('💡 Para iniciar ngrok:');
    console.error('   node scripts/utils/start-ngrok.js');
    console.error('');
    return null;
  }
}

getNgrokUrl().then(result => {
  if (result) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}).catch(error => {
  console.error('❌ Erro:', error.message);
  process.exit(1);
});

