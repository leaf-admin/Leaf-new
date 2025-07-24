const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function checkDockerRedis() {
    try {
        console.log('🔍 Verificando estado real do Docker e Redis...\n');
        
        // 1. Verificar se o Docker está rodando
        console.log('1. Verificando Docker...');
        try {
            const { stdout: dockerVersion } = await execAsync('docker --version');
            console.log('✅ Docker instalado:', dockerVersion.trim());
        } catch (error) {
            console.log('❌ Docker não está instalado ou não está rodando');
            return;
        }
        
        // 2. Verificar containers rodando
        console.log('\n2. Verificando containers...');
        try {
            const { stdout: containers } = await execAsync('docker ps');
            console.log('📋 Containers rodando:');
            console.log(containers);
        } catch (error) {
            console.log('❌ Erro ao listar containers:', error.message);
        }
        
        // 3. Verificar todos os containers (incluindo parados)
        console.log('\n3. Verificando todos os containers...');
        try {
            const { stdout: allContainers } = await execAsync('docker ps -a');
            console.log('📋 Todos os containers:');
            console.log(allContainers);
        } catch (error) {
            console.log('❌ Erro ao listar todos os containers:', error.message);
        }
        
        // 4. Verificar se o Redis está rodando
        console.log('\n4. Verificando Redis...');
        try {
            const { stdout: redisPing } = await execAsync('docker exec redis-taxi-app redis-cli ping');
            console.log('✅ Redis respondendo:', redisPing.trim());
        } catch (error) {
            console.log('❌ Redis não está respondendo ou container não existe');
            console.log('   Erro:', error.message);
        }
        
        // 5. Verificar imagens Docker
        console.log('\n5. Verificando imagens Docker...');
        try {
            const { stdout: images } = await execAsync('docker images');
            console.log('📋 Imagens disponíveis:');
            console.log(images);
        } catch (error) {
            console.log('❌ Erro ao listar imagens:', error.message);
        }
        
        // 6. Verificar uso de recursos do Docker
        console.log('\n6. Verificando uso de recursos...');
        try {
            const { stdout: systemDf } = await execAsync('docker system df');
            console.log('📊 Uso de recursos:');
            console.log(systemDf);
        } catch (error) {
            console.log('❌ Erro ao verificar recursos:', error.message);
        }
        
        console.log('\n🎯 Verificação concluída!');
        
    } catch (error) {
        console.error('❌ Erro geral:', error.message);
    }

checkDockerRedis(); 
const { promisify } = require('util');


async function checkDockerRedis() {
    try {
        console.log('🔍 Verificando estado real do Docker e Redis...\n');
        
        // 1. Verificar se o Docker está rodando
        console.log('1. Verificando Docker...');
        try {
            const { stdout: dockerVersion } = await execAsync('docker --version');
            console.log('✅ Docker instalado:', dockerVersion.trim());
        } catch (error) {
            console.log('❌ Docker não está instalado ou não está rodando');
            return;
        }
        
        // 2. Verificar containers rodando
        console.log('\n2. Verificando containers...');
        try {
            const { stdout: containers } = await execAsync('docker ps');
            console.log('📋 Containers rodando:');
            console.log(containers);
        } catch (error) {
            console.log('❌ Erro ao listar containers:', error.message);
        }
        
        // 3. Verificar todos os containers (incluindo parados)
        console.log('\n3. Verificando todos os containers...');
        try {
            const { stdout: allContainers } = await execAsync('docker ps -a');
            console.log('📋 Todos os containers:');
            console.log(allContainers);
        } catch (error) {
            console.log('❌ Erro ao listar todos os containers:', error.message);
        }
        
        // 4. Verificar se o Redis está rodando
        console.log('\n4. Verificando Redis...');
        try {
            const { stdout: redisPing } = await execAsync('docker exec redis-taxi-app redis-cli ping');
            console.log('✅ Redis respondendo:', redisPing.trim());
        } catch (error) {
            console.log('❌ Redis não está respondendo ou container não existe');
            console.log('   Erro:', error.message);
        }
        
        // 5. Verificar imagens Docker
        console.log('\n5. Verificando imagens Docker...');
        try {
            const { stdout: images } = await execAsync('docker images');
            console.log('📋 Imagens disponíveis:');
            console.log(images);
        } catch (error) {
            console.log('❌ Erro ao listar imagens:', error.message);
        }
        
        // 6. Verificar uso de recursos do Docker
        console.log('\n6. Verificando uso de recursos...');
        try {
            const { stdout: systemDf } = await execAsync('docker system df');
            console.log('📊 Uso de recursos:');
            console.log(systemDf);
        } catch (error) {
            console.log('❌ Erro ao verificar recursos:', error.message);
        }
        
        console.log('\n🎯 Verificação concluída!');
        
    } catch (error) {
        console.error('❌ Erro geral:', error.message);
    }

checkDockerRedis(); 