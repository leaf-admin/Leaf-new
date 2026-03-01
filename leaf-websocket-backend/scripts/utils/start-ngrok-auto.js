#!/usr/bin/env node

/**
 * Script para iniciar ngrok e configurar automaticamente
 * - Inicia ngrok
 * - Obtém URL pública
 * - Configura variável de ambiente
 * - Atualiza webhook na Woovi via API (se necessário)
 * 
 * Uso:
 *   node scripts/utils/start-ngrok-auto.js
 */

const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const NGROK_CONFIG_FILE = path.join(__dirname, '../../.ngrok-url.json');
const WOOVI_CONFIG = {
  apiToken: process.env.WOOVI_API_TOKEN || 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X01ENWpTTW1DMExBYWx2WHhiY0tTSnlrVmYyM0g1Z0FxS0pZaE5zT0tUK1E9',
  baseUrl: process.env.WOOVI_BASE_URL || 'https://api.woovi-sandbox.com/api/v1'
};

console.log('🚀 Iniciando ngrok com configuração automática...');
console.log(`   Porta: ${PORT}`);
console.log('');

// Verificar se ngrok está instalado
const ngrokProcess = spawn('ngrok', ['version'], { stdio: 'pipe' });

ngrokProcess.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error('❌ ngrok não encontrado!');
    console.error('');
    console.error('📦 Para instalar:');
    console.error('   npm install -g ngrok');
    console.error('');
    process.exit(1);
  } else {
    console.error('❌ Erro ao verificar ngrok:', error.message);
    process.exit(1);
  }
});

ngrokProcess.on('close', (code) => {
  if (code !== 0) {
    console.error('❌ ngrok não está instalado ou não está no PATH');
    process.exit(1);
  }
  
  // Iniciar ngrok
  startNgrok();
});

async function startNgrok() {
  console.log('🔧 Iniciando túnel ngrok...');
  console.log('');
  
  const ngrok = spawn('ngrok', ['http', PORT.toString(), '--log=stdout'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let ngrokUrl = null;
  let webhookUrl = null;
  
  // Aguardar ngrok iniciar e obter URL
  setTimeout(async () => {
    try {
      const response = await axios.get('http://127.0.0.1:4040/api/tunnels', {
        timeout: 5000
      });
      
      if (response.data && response.data.tunnels && response.data.tunnels.length > 0) {
        const httpsTunnel = response.data.tunnels.find(t => t.proto === 'https');
        if (httpsTunnel) {
          ngrokUrl = httpsTunnel.public_url;
          webhookUrl = `${ngrokUrl}/api/woovi/webhook`;
          
          console.log('');
          console.log('═══════════════════════════════════════════════════════════');
          console.log('✅ NGROK INICIADO COM SUCESSO!');
          console.log('═══════════════════════════════════════════════════════════');
          console.log('');
          console.log(`🌐 URL Pública: ${ngrokUrl}`);
          console.log(`🔗 Webhook URL: ${webhookUrl}`);
          console.log('');
          
          // Salvar em arquivo
          const config = {
            url: ngrokUrl,
            webhookUrl: webhookUrl,
            port: PORT,
            startedAt: new Date().toISOString()
          };
          
          fs.writeFileSync(NGROK_CONFIG_FILE, JSON.stringify(config, null, 2));
          console.log(`💾 Configuração salva em: ${NGROK_CONFIG_FILE}`);
          console.log('');
          
          // Configurar variável de ambiente no processo atual
          process.env.WOOVI_WEBHOOK_URL = webhookUrl;
          
          // Tentar atualizar webhook na Woovi via API
          await updateWooviWebhook(webhookUrl);
          
          console.log('');
          console.log('📋 CONFIGURAÇÃO AUTOMÁTICA:');
          console.log('');
          console.log('✅ Variável de ambiente configurada: WOOVI_WEBHOOK_URL');
          console.log('✅ Webhook URL salva em arquivo');
          console.log('✅ Sistema pronto para receber webhooks!');
          console.log('');
          console.log('⚠️ IMPORTANTE:');
          console.log('   - Mantenha este terminal aberto enquanto testar');
          console.log('   - A URL mudará se reiniciar o ngrok');
          console.log('   - Reinicie o servidor para aplicar a nova URL');
          console.log('');
          console.log('═══════════════════════════════════════════════════════════');
          console.log('');
        }
      }
    } catch (error) {
      console.warn('⚠️ Não foi possível obter URL via API do ngrok ainda, tentando novamente...');
      // Tentar novamente após mais tempo
      setTimeout(async () => {
        await getNgrokUrl();
      }, 3000);
    }
  }, 3000);
  
  ngrok.stdout.on('data', (data) => {
    const output = data.toString();
    // Não mostrar output do ngrok (muito verboso)
    // process.stdout.write(output);
  });
  
  ngrok.stderr.on('data', (data) => {
    const output = data.toString();
    if (output.includes('authtoken')) {
      console.error('');
      console.error('❌ ERRO: ngrok precisa de autenticação!');
      console.error('');
      console.error('📝 Para configurar:');
      console.error('   1. Criar conta em: https://dashboard.ngrok.com/signup');
      console.error('   2. Copiar authtoken do dashboard');
      console.error('   3. Executar: ngrok config add-authtoken SEU_TOKEN');
      console.error('');
    }
  });
  
  ngrok.on('close', (code) => {
    console.log('');
    console.log(`⚠️ ngrok encerrado (código: ${code})`);
    
    // Limpar arquivo de URL
    try {
      if (fs.existsSync(NGROK_CONFIG_FILE)) {
        fs.unlinkSync(NGROK_CONFIG_FILE);
      }
    } catch (error) {
      // Ignorar erros ao limpar
    }
  });
  
  // Capturar Ctrl+C
  process.on('SIGINT', () => {
    console.log('');
    console.log('🛑 Encerrando ngrok...');
    ngrok.kill();
    process.exit(0);
  });
}

async function getNgrokUrl() {
  try {
    const response = await axios.get('http://127.0.0.1:4040/api/tunnels', {
      timeout: 5000
    });
    
    if (response.data && response.data.tunnels && response.data.tunnels.length > 0) {
      const httpsTunnel = response.data.tunnels.find(t => t.proto === 'https');
      if (httpsTunnel) {
        const ngrokUrl = httpsTunnel.public_url;
        const webhookUrl = `${ngrokUrl}/api/woovi/webhook`;
        
        console.log('✅ URL obtida via API do ngrok:', webhookUrl);
        
        // Salvar em arquivo
        const config = {
          url: ngrokUrl,
          webhookUrl: webhookUrl,
          port: PORT,
          startedAt: new Date().toISOString(),
          confirmedViaApi: true
        };
        
        fs.writeFileSync(NGROK_CONFIG_FILE, JSON.stringify(config, null, 2));
        
        // Configurar variável de ambiente
        process.env.WOOVI_WEBHOOK_URL = webhookUrl;
        
        // Tentar atualizar webhook na Woovi
        await updateWooviWebhook(webhookUrl);
        
        return { url: ngrokUrl, webhookUrl: webhookUrl };
      }
    }
  } catch (error) {
    console.warn('⚠️ Erro ao obter URL do ngrok:', error.message);
  }
  return null;
}

async function updateWooviWebhook(webhookUrl) {
  try {
    console.log('🔄 Tentando atualizar webhook na Woovi via API...');
    
    const api = axios.create({
      baseURL: WOOVI_CONFIG.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': WOOVI_CONFIG.apiToken
      },
      timeout: 10000
    });
    
    // Listar webhooks existentes
    const listResponse = await api.get('/webhook');
    
    if (listResponse.data && listResponse.data.webhooks) {
      const webhooks = listResponse.data.webhooks;
      
      // Procurar webhook existente
      const existingWebhook = webhooks.find(w => 
        w.url && w.url.includes('ngrok') || 
        w.url && w.url.includes('localhost') ||
        w.url && w.url.includes('192.168')
      );
      
      if (existingWebhook) {
        // Atualizar webhook existente
        console.log(`   📝 Atualizando webhook existente: ${existingWebhook.id}`);
        const updateResponse = await api.put(`/webhook/${existingWebhook.id}`, {
          url: webhookUrl,
          isActive: true
        });
        
        if (updateResponse.data) {
          console.log('   ✅ Webhook atualizado na Woovi!');
          return true;
        }
      } else {
        // Criar novo webhook
        console.log('   📝 Criando novo webhook na Woovi...');
        const createResponse = await api.post('/webhook', {
          name: 'Leaf Local Webhook',
          url: webhookUrl,
          isActive: true,
          event: 'OPENPIX:CHARGE_COMPLETED'
        });
        
        if (createResponse.data) {
          console.log('   ✅ Webhook criado na Woovi!');
          return true;
        }
      }
    }
  } catch (error) {
    console.warn('   ⚠️ Não foi possível atualizar webhook na Woovi via API:');
    console.warn(`      ${error.response?.data?.message || error.message}`);
    console.warn('   💡 Você pode configurar manualmente na Woovi Dashboard se necessário');
    return false;
  }
}

