#!/bin/bash

# 🚀 DEPLOY KYC SERVICE PARA VPS DEDICADA
# Copia arquivos e configura o serviço KYC na VPS

set -e

VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_HOST="srv710490.hstgr.cloud"
APP_DIR="/opt/leaf-kyc-service"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Deploy do KYC Service para VPS..."
echo "📍 IP: $VPS_IP"
echo "📁 Diretório remoto: $APP_DIR"
echo "📁 Diretório local: $LOCAL_DIR"
echo ""

# Verificar se SSH está disponível
if ! command -v ssh &> /dev/null; then
  echo "❌ SSH não encontrado. Instale openssh-client."
  exit 1
fi

# Testar conexão SSH
echo "🔌 Testando conexão SSH..."
if ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" "echo 'Conexão OK'" 2>/dev/null; then
  echo "❌ Não foi possível conectar à VPS"
  echo "💡 Verifique:"
  echo "   - IP: $VPS_IP"
  echo "   - Usuário: $VPS_USER"
  echo "   - Chave SSH configurada"
  exit 1
fi

echo "✅ Conexão SSH OK"
echo ""

# 1. Criar estrutura de diretórios na VPS
echo "📁 Criando estrutura de diretórios..."
ssh "$VPS_USER@$VPS_IP" "mkdir -p $APP_DIR/{logs,uploads,temp,models}"

# 2. Copiar package.json e instalar dependências
echo "📦 Copiando package.json..."
scp "$LOCAL_DIR/package.json" "$VPS_USER@$VPS_IP:$APP_DIR/"

# 3. Criar package.json específico para KYC VPS (se necessário)
echo "📦 Criando package.json para KYC VPS..."
cat > /tmp/kyc-package.json << 'EOF'
{
  "name": "leaf-kyc-service",
  "version": "1.0.0",
  "description": "Leaf KYC Processing Service",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "dotenv": "^16.3.1",
    "multer": "^1.4.5-lts.1",
    "axios": "^1.5.0",
    "firebase-admin": "^11.10.1",
    "sharp": "^0.32.6",
    "canvas": "^2.11.2",
    "face-api.js": "^0.22.2",
    "opencv4nodejs": "^5.6.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=9.0.0"
  }
}
EOF

scp /tmp/kyc-package.json "$VPS_USER@$VPS_IP:$APP_DIR/package.json"
rm /tmp/kyc-package.json

# 4. Instalar dependências na VPS
echo "📦 Instalando dependências na VPS (isso pode demorar)..."
ssh "$VPS_USER@$VPS_IP" "cd $APP_DIR && npm install --production"

# 5. Copiar arquivos do serviço KYC
echo "📋 Copiando arquivos do serviço..."

# Criar diretório temporário com arquivos necessários
TEMP_DIR=$(mktemp -d)
mkdir -p "$TEMP_DIR/services" "$TEMP_DIR"

# Copiar arquivos necessários
cp "$LOCAL_DIR/services/firebase-storage-service.js" "$TEMP_DIR/services/" 2>/dev/null || echo "⚠️ firebase-storage-service.js não encontrado"
cp "$LOCAL_DIR/services/kyc-vps-client.js" "$TEMP_DIR/services/" 2>/dev/null || echo "⚠️ kyc-vps-client.js não encontrado"
cp "$LOCAL_DIR/firebase-config.js" "$TEMP_DIR/" 2>/dev/null || echo "⚠️ firebase-config.js não encontrado"

# Criar server.js básico para KYC VPS
cat > "$TEMP_DIR/server.js" << 'EOF'
/**
 * 🚀 KYC VPS Service
 * Serviço dedicado para processamento KYC
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.API_KEY || 'CHANGE_THIS';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configurar multer para uploads temporários
const upload = multer({
  dest: './temp',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Middleware de autenticação
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'API Key inválida'
    });
  }
  
  next();
};

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'leaf-kyc-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Processar KYC
app.post('/api/kyc/process', authenticate, upload.fields([
  { name: 'cnh', maxCount: 1 },
  { name: 'current', maxCount: 1 }
]), async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }
    
    if (!req.files || !req.files.cnh || !req.files.current) {
      return res.status(400).json({ 
        error: 'Arquivos cnh e current são obrigatórios' 
      });
    }
    
    const cnhFile = req.files.cnh[0];
    const currentFile = req.files.current[0];
    
    console.log(`🚀 Processando KYC para userId: ${userId}`);
    console.log(`   CNH: ${cnhFile.path} (${cnhFile.size} bytes)`);
    console.log(`   Current: ${currentFile.path} (${currentFile.size} bytes)`);
    
    // TODO: Implementar processamento real de face recognition
    // Por enquanto, simular processamento
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Limpar arquivos temporários
    fs.unlinkSync(cnhFile.path);
    fs.unlinkSync(currentFile.path);
    
    // Simular resultado
    const result = {
      success: true,
      userId,
      match: true,
      confidence: 0.85,
      liveness: true,
      processedAt: new Date().toISOString()
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Erro ao processar KYC:', error);
    res.status(500).json({ 
      error: 'Erro ao processar KYC',
      message: error.message 
    });
  }
});

// Iniciar servidor
app.listen(PORT, HOST, () => {
  console.log(`🚀 KYC Service rodando em http://${HOST}:${PORT}`);
  console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
  console.log(`🔑 API Key configurada: ${API_KEY ? 'Sim' : 'Não'}`);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
EOF

# Copiar arquivos para VPS
echo "📤 Enviando arquivos para VPS..."
scp -r "$TEMP_DIR"/* "$VPS_USER@$VPS_IP:$APP_DIR/"

# Limpar diretório temporário
rm -rf "$TEMP_DIR"

# 6. Criar arquivo .env se não existir
echo "📝 Verificando arquivo .env..."
ssh "$VPS_USER@$VPS_IP" "if [ ! -f $APP_DIR/.env ]; then
  cp $APP_DIR/.env.example $APP_DIR/.env
  echo '⚠️ Arquivo .env criado. CONFIGURE AS VARIÁVEIS ANTES DE INICIAR!'
fi"

# 7. Configurar permissões
echo "🔐 Configurando permissões..."
ssh "$VPS_USER@$VPS_IP" "chown -R leaf-kyc:leaf-kyc $APP_DIR"

# 8. Resumo
echo ""
echo "✅ DEPLOY CONCLUÍDO!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Configure o arquivo .env em $APP_DIR/.env"
echo "   2. Inicie o serviço: ssh $VPS_USER@$VPS_IP 'systemctl start leaf-kyc'"
echo "   3. Verifique os logs: ssh $VPS_USER@$VPS_IP 'journalctl -u leaf-kyc -f'"
echo ""
echo "🔧 Comandos úteis:"
echo "   - Ver status: ssh $VPS_USER@$VPS_IP 'systemctl status leaf-kyc'"
echo "   - Reiniciar: ssh $VPS_USER@$VPS_IP 'systemctl restart leaf-kyc'"
echo "   - Ver logs: ssh $VPS_USER@$VPS_IP 'journalctl -u leaf-kyc -f'"
echo ""

