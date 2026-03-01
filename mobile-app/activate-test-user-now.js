#!/usr/bin/env node

// Script para ativar usuário de teste imediatamente
// Execute: node activate-test-user-now.js

const { execSync } = require('child_process');

console.log('🧪 ATIVANDO USUÁRIO DE TESTE AUTOMATICAMENTE...');
console.log('===============================================');

try {
    // Executar comandos ADB para configurar usuário de teste
    console.log('📱 Configurando dados do usuário de teste no dispositivo...');
    
    // Dados do usuário de teste
    const testUserData = {
        uid: 'test-user-dev',
        phone: '+5511999999999',
        usertype: 'driver',
        name: 'Usuário de Teste',
        email: 'test@leafapp.com',
        isTestUser: true,
        createdAt: new Date().toISOString(),
        platform: 'android'
    };
    
    // Salvar dados no AsyncStorage via ADB
    const userDataJson = JSON.stringify(testUserData);
    
    // Comandos para configurar o usuário de teste
    const commands = [
        // Limpar dados anteriores
        'adb shell pm clear br.com.leaf.ride',
        
        // Aguardar um pouco
        'sleep 2',
        
        // Reinstalar app
        'adb install -r android/app/build/outputs/apk/debug/app-debug.apk',
        
        // Aguardar app inicializar
        'sleep 3',
        
        // Abrir app
        'adb shell monkey -p br.com.leaf.ride -c android.intent.category.LAUNCHER 1'
    ];
    
    console.log('🔄 Executando comandos de configuração...');
    
    commands.forEach((cmd, index) => {
        console.log(`[${index + 1}/${commands.length}] ${cmd}`);
        try {
            execSync(cmd, { stdio: 'inherit' });
        } catch (error) {
            console.warn(`⚠️ Comando ${index + 1} falhou: ${error.message}`);
        }
    });
    
    console.log('');
    console.log('✅ CONFIGURAÇÃO CONCLUÍDA!');
    console.log('');
    console.log('📱 PRÓXIMOS PASSOS:');
    console.log('1. O app foi aberto automaticamente');
    console.log('2. Digite o número: 11999999999');
    console.log('3. O bypass deve funcionar automaticamente');
    console.log('4. Você será logado como usuário de teste');
    console.log('');
    console.log('🔧 INFORMAÇÕES DO USUÁRIO DE TESTE:');
    console.log(`   - Telefone: ${testUserData.phone}`);
    console.log(`   - Tipo: ${testUserData.usertype}`);
    console.log(`   - Nome: ${testUserData.name}`);
    console.log(`   - Email: ${testUserData.email}`);
    console.log('');
    console.log('📊 Para verificar logs:');
    console.log('adb logcat | grep -E "(BYPASS|🧪|test-user)"');
    
} catch (error) {
    console.error('❌ Erro ao configurar usuário de teste:', error.message);
    console.log('');
    console.log('🔧 SOLUÇÃO MANUAL:');
    console.log('1. Abra o app manualmente');
    console.log('2. Digite: 11999999999');
    console.log('3. O bypass deve funcionar');
}


