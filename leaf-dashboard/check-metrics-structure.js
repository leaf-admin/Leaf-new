const fetch = require('node-fetch');

async function checkMetricsStructure() {
    try {
        console.log('🔍 Verificando estrutura exata dos dados...\n');
        
        const response = await fetch('http://localhost:3001/metrics');
        const data = await response.json();
        
        console.log('📋 Estrutura completa dos dados:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n🎯 Verificação de campos específicos:');
        console.log('- container direto:', data.container ? 'PRESENTE' : 'AUSENTE');
        console.log('- redis direto:', data.redis ? 'PRESENTE' : 'AUSENTE');
        console.log('- system direto:', data.system ? 'PRESENTE' : 'AUSENTE');
        console.log('- host direto:', data.host ? 'PRESENTE' : 'AUSENTE');
        console.log('- resources:', data.resources ? 'PRESENTE' : 'AUSENTE');
        console.log('- summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        
        if (data.resources) {
            console.log('\n📦 Dados em resources:');
            console.log('- resources.container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.system:', data.resources.system ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.host:', data.resources.host ? 'PRESENTE' : 'AUSENTE');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

checkMetricsStructure(); 

async function checkMetricsStructure() {
    try {
        console.log('🔍 Verificando estrutura exata dos dados...\n');
        
        const response = await fetch('http://localhost:3001/metrics');
        const data = await response.json();
        
        console.log('📋 Estrutura completa dos dados:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n🎯 Verificação de campos específicos:');
        console.log('- container direto:', data.container ? 'PRESENTE' : 'AUSENTE');
        console.log('- redis direto:', data.redis ? 'PRESENTE' : 'AUSENTE');
        console.log('- system direto:', data.system ? 'PRESENTE' : 'AUSENTE');
        console.log('- host direto:', data.host ? 'PRESENTE' : 'AUSENTE');
        console.log('- resources:', data.resources ? 'PRESENTE' : 'AUSENTE');
        console.log('- summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        
        if (data.resources) {
            console.log('\n📦 Dados em resources:');
            console.log('- resources.container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.system:', data.resources.system ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.host:', data.resources.host ? 'PRESENTE' : 'AUSENTE');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

checkMetricsStructure(); 

async function checkMetricsStructure() {
    try {
        console.log('🔍 Verificando estrutura exata dos dados...\n');
        
        const response = await fetch('http://localhost:3001/metrics');
        const data = await response.json();
        
        console.log('📋 Estrutura completa dos dados:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n🎯 Verificação de campos específicos:');
        console.log('- container direto:', data.container ? 'PRESENTE' : 'AUSENTE');
        console.log('- redis direto:', data.redis ? 'PRESENTE' : 'AUSENTE');
        console.log('- system direto:', data.system ? 'PRESENTE' : 'AUSENTE');
        console.log('- host direto:', data.host ? 'PRESENTE' : 'AUSENTE');
        console.log('- resources:', data.resources ? 'PRESENTE' : 'AUSENTE');
        console.log('- summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        
        if (data.resources) {
            console.log('\n📦 Dados em resources:');
            console.log('- resources.container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.system:', data.resources.system ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.host:', data.resources.host ? 'PRESENTE' : 'AUSENTE');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

checkMetricsStructure(); 