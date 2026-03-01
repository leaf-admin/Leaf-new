/**
 * Carrega URL do ngrok de arquivo de configuração
 * Usado pelo servidor para obter URL do webhook automaticamente
 */

const fs = require('fs');
const path = require('path');

const NGROK_CONFIG_FILE = path.join(__dirname, '../.ngrok-url.json');

function loadNgrokUrl() {
  try {
    if (fs.existsSync(NGROK_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(NGROK_CONFIG_FILE, 'utf8'));
      if (config.webhookUrl) {
        return config.webhookUrl;
      }
    }
  } catch (error) {
    // Ignorar erros
  }
  return null;
}

function getNgrokWebhookUrl() {
  // 1. Tentar variável de ambiente primeiro (PRIORIDADE EM PRODUÇÃO)
  if (process.env.WOOVI_WEBHOOK_URL) {
    return process.env.WOOVI_WEBHOOK_URL;
  }
  
  // 2. Em produção, usar URL do servidor (sem ngrok)
  if (process.env.NODE_ENV === 'production') {
    const serverUrl = process.env.SERVER_URL || process.env.WOOVI_WEBHOOK_BASE_URL || 'http://147.93.66.253';
    return `${serverUrl}/api/woovi/webhook`;
  }
  
  // 3. Tentar carregar do arquivo (desenvolvimento local com ngrok)
  const urlFromFile = loadNgrokUrl();
  if (urlFromFile) {
    return urlFromFile;
  }
  
  // 4. Fallback para servidor local (apenas desenvolvimento)
  return 'http://192.168.0.37:3001/api/woovi/webhook';
}

module.exports = {
  loadNgrokUrl,
  getNgrokWebhookUrl
};

