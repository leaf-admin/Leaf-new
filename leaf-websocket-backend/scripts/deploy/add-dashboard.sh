#!/bin/bash

# Script para adicionar funcionalidades do dashboard ao server.js existente

echo "📊 Adicionando funcionalidades do dashboard..."

# 1. Adicionar import das rotas após as outras rotas
cat > /tmp/dashboard-import.txt << 'EOF'

// Dashboard routes
const dashboardRoutes = require('./routes/dashboard');
app.use('/', dashboardRoutes);
EOF

# 2. Adicionar inicialização do WebSocket do dashboard
cat > /tmp/dashboard-websocket.txt << 'EOF'

// Dashboard WebSocket Service
const DashboardWebSocketService = require('./services/dashboard-websocket');
const dashboardWS = new DashboardWebSocketService(io);
console.log('🎯 Dashboard WebSocket Service inicializado');
EOF

echo "✅ Arquivos temporários criados"
echo "📝 Use estes snippets para adicionar ao server.js manualmente"
