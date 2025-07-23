console.log('🔍 Debug do servidor - Testando módulos...');

// Teste 1: Módulos básicos
try {
    console.log('\n1. Testando módulos básicos...');
    const express = require('express');
    const http = require('http');
    const { Server } = require('socket.io');
    const Redis = require('ioredis');
    const cors = require('cors');
    console.log('✅ Módulos básicos OK');
} catch (error) {
    console.error('❌ Erro nos módulos básicos:', error.message);
    process.exit(1);
}

// Teste 2: Firebase config
try {
    console.log('\n2. Testando Firebase config...');
    const firebaseConfig = require('./firebase-config');
    console.log('✅ Firebase config OK');
} catch (error) {
    console.error('❌ Erro no Firebase config:', error.message);
}

// Teste 3: Latency Monitor
try {
    console.log('\n3. Testando Latency Monitor...');
    const LatencyMonitor = require('./metrics/latency-monitor');
    console.log('✅ Latency Monitor OK');
} catch (error) {
    console.error('❌ Erro no Latency Monitor:', error.message);
}

// Teste 4: Docker Monitor
try {
    console.log('\n4. Testando Docker Monitor...');
    const DockerMonitor = require('./monitoring/docker-monitor');
    console.log('✅ Docker Monitor OK');
} catch (error) {
    console.error('❌ Erro no Docker Monitor:', error.message);
}

// Teste 5: Smart Sync Alert System
try {
    console.log('\n5. Testando Smart Sync Alert System...');
    const SmartSyncAlertSystem = require('./monitoring/smart-sync-alert-system');
    console.log('✅ Smart Sync Alert System OK');
} catch (error) {
    console.error('❌ Erro no Smart Sync Alert System:', error.message);
}

// Teste 6: Configurações
try {
    console.log('\n6. Testando configurações...');
    require('dotenv').config();
    const PORT = process.env.PORT || 3001;
    const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`✅ Configurações OK - PORT: ${PORT}, REDIS: ${REDIS_URL}`);
} catch (error) {
    console.error('❌ Erro nas configurações:', error.message);
}

console.log('\n🎯 Debug concluído!');
console.log('Se todos os testes passaram, o servidor deve funcionar.'); 