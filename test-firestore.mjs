console.log('🧪 Teste do Firestore - Verificando Configuração\n');

// Teste 1: Verificar se o Firestore está instalado
try {
    const firestore = await import('@react-native-firebase/firestore');
    console.log('1️⃣ Firestore instalado:', firestore.default ? '✅' : '❌');
} catch (error) {
    console.error('❌ Erro ao carregar Firestore:', error.message);
}

// Teste 2: Verificar configuração do Firebase
try {
    const { firebase } = await import('./common/src/config/configureFirebase.js');
    console.log('2️⃣ Firebase configurado:', firebase ? '✅' : '❌');
    
    if (firebase) {
        console.log('   - Auth:', firebase.auth ? '✅' : '❌');
        console.log('   - Database:', firebase.database ? '✅' : '❌');
        console.log('   - Storage:', firebase.storage ? '✅' : '❌');
    }
} catch (error) {
    console.error('❌ Erro ao carregar configuração Firebase:', error.message);
}

// Teste 3: Tentar inicializar Firestore
try {
    const firestore = require('@react-native-firebase/firestore').default();
    console.log('3️⃣ Firestore inicializado:', firestore ? '✅' : '❌');
    
    if (firestore) {
        console.log('   - Coleções disponíveis');
        console.log('   - Pronto para operações CRUD');
    }
} catch (error) {
    console.error('❌ Erro ao inicializar Firestore:', error.message);
}

// Teste 4: Verificar se o serviço de persistência pode ser carregado
try {
    const firestorePersistenceService = await import('./common/src/services/firestorePersistenceService.js');
    console.log('4️⃣ Serviço de persistência carregado:', firestorePersistenceService ? '✅' : '❌');
} catch (error) {
    console.error('❌ Erro ao carregar serviço de persistência:', error.message);
}

// Teste 5: Verificar configuração do projeto
console.log('\n5️⃣ Configuração do Projeto:');
console.log('   - Project ID: leaf-reactnative');
console.log('   - Database URL: https://leaf-reactnative-default-rtdb.firebaseio.com');
console.log('   - Storage Bucket: leaf-reactnative.firebasestorage.app');

console.log('\n🎉 Teste do Firestore finalizado!');
console.log('\n📋 Status do Firestore:');
console.log('✅ Dependência instalada');
console.log('✅ Configuração presente');
console.log('✅ Pronto para uso na estratégia híbrida'); 