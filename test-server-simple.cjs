console.log('🔍 Testando carregamento de módulos...');

try {
    console.log('1. Testando require do express...');
    const express = require('express');
    console.log('✅ Express carregado');
    
    console.log('2. Testando require do docker-monitor...');
    const DockerMonitor = require('./leaf-websocket-backend/monitoring/docker-monitor');
    console.log('✅ DockerMonitor carregado');
    
    console.log('3. Testando require do latency-monitor...');
    const LatencyMonitor = require('./leaf-websocket-backend/metrics/latency-monitor');
    console.log('✅ LatencyMonitor carregado');
    
    console.log('4. Testando require do smart-sync-alert-system...');
    const SmartSyncAlertSystem = require('./leaf-websocket-backend/monitoring/smart-sync-alert-system');
    console.log('✅ SmartSyncAlertSystem carregado');
    
    console.log('5. Testando require do firebase-config...');
    const firebaseConfig = require('./leaf-websocket-backend/firebase-config');
    console.log('✅ Firebase config carregado');
    
    console.log('\n🎉 Todos os módulos carregados com sucesso!');
    console.log('O problema pode estar em outro lugar...');
    
} catch (error) {
    console.error('❌ Erro ao carregar módulo:', error.message);
    console.error('Stack:', error.stack);
} 