#!/usr/bin/env node

/**
 * Script para iniciar ngrok e expor servidor local
 * 
 * Uso:
 *   node scripts/utils/start-ngrok.js
 *   node scripts/utils/start-ngrok.js --port 3001
 *   node scripts/utils/start-ngrok.js --port 3001 --region us
 */

const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PORT = process.argv.includes('--port') 
  ? parseInt(process.argv[process.argv.indexOf('--port') + 1]) || 3001
  : 3001;

const REGION = process.argv.includes('--region')
  ? process.argv[process.argv.indexOf('--region') + 1] || 'us'
  : 'us';

const NGROK_CONFIG_FILE = path.join(__dirname, '../../.ngrok-url.json');

console.log('🚀 Iniciando ngrok...');
console.log(`   Porta: ${PORT}`);
console.log(`   Região: ${REGION}`);
console.log('');

// Verificar se ngrok está instalado
const ngrokProcess = spawn('ngrok', ['version'], { stdio: 'pipe' });

ngrokProcess.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error('❌ ngrok não encontrado!');
    console.error('');
    console.error('📦 Para instalar:');
    console.error('   npm install -g ngrok');
    console.error('   OU');
    console.error('   brew install ngrok (macOS)');
    console.error('   OU');
    console.error('   snap install ngrok (Linux)');
    console.error('');
    console.error('🌐 Ou baixar de: https://ngrok.com/download');
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

function startNgrok() {
  console.log('🔧 Iniciando túnel ngrok...');
  console.log('');
  
  const ngrok = spawn('ngrok', ['http', PORT.toString(), '--region', REGION], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let ngrokOutput = '';
  let ngrokUrl = null;
  
  ngrok.stdout.on('data', (data) => {
    const output = data.toString();
    ngrokOutput += output;
    process.stdout.write(output);
    
    // Tentar extrair URL do output
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app/i);
    if (urlMatch && !ngrokUrl) {
      ngrokUrl = urlMatch[0];
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ NGROK INICIADO COM SUCESSO!');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      console.log(`🌐 URL Pública: ${ngrokUrl}`);
      console.log(`🔗 Webhook URL: ${ngrokUrl}/api/woovi/webhook`);
      console.log('');
      console.log('📋 PRÓXIMOS PASSOS:');
      console.log('');
      console.log('1. Configurar variável de ambiente:');
      console.log(`   export WOOVI_WEBHOOK_URL="${ngrokUrl}/api/woovi/webhook"`);
      console.log('');
      console.log('2. Configurar webhook na Woovi Dashboard:');
      console.log(`   ${ngrokUrl}/api/woovi/webhook`);
      console.log('');
      console.log('3. Reiniciar servidor (se necessário):');
      console.log('   pm2 restart leaf-server');
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      
      // Salvar URL em arquivo
      try {
        fs.writeFileSync(NGROK_CONFIG_FILE, JSON.stringify({
          url: ngrokUrl,
          webhookUrl: `${ngrokUrl}/api/woovi/webhook`,
          port: PORT,
          startedAt: new Date().toISOString()
        }, null, 2));
        console.log(`💾 URL salva em: ${NGROK_CONFIG_FILE}`);
        console.log('');
      } catch (error) {
        console.warn('⚠️ Não foi possível salvar URL:', error.message);
      }
      
      // Tentar obter URL via API do ngrok (mais confiável)
      setTimeout(() => {
        getNgrokUrl();
      }, 2000);
    }
  });
  
  ngrok.stderr.on('data', (data) => {
    const output = data.toString();
    process.stderr.write(output);
    
    // Verificar erros comuns
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
    // Tentar obter URL via API local do ngrok
    const response = await axios.get('http://127.0.0.1:4040/api/tunnels', {
      timeout: 5000
    });
    
    if (response.data && response.data.tunnels && response.data.tunnels.length > 0) {
      const httpsTunnel = response.data.tunnels.find(t => t.proto === 'https');
      if (httpsTunnel) {
        const url = httpsTunnel.public_url;
        console.log('✅ URL confirmada via API do ngrok:', url);
        console.log('');
        
        // Atualizar arquivo
        try {
          fs.writeFileSync(NGROK_CONFIG_FILE, JSON.stringify({
            url: url,
            webhookUrl: `${url}/api/woovi/webhook`,
            port: PORT,
            startedAt: new Date().toISOString(),
            confirmedViaApi: true
          }, null, 2));
        } catch (error) {
          // Ignorar
        }
      }
    }
  } catch (error) {
    // API do ngrok ainda não está disponível, ignorar
  }
}

