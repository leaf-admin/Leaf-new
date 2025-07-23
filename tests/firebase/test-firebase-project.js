const admin = require('firebase-admin');
const path = require('path');

async function testFirebaseProject() {
    console.log('🔍 Testando configuração do projeto Firebase...');
    console.log('=' .repeat(60));

    try {
        // 1. Carregar credenciais
        console.log('1️⃣ Carregando credenciais...');
        const serviceAccountPath = path.join(__dirname, '..', 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
        console.log('📁 Caminho das credenciais:', serviceAccountPath);
        
        const serviceAccount = require(serviceAccountPath);
        console.log('📊 Projeto ID:', serviceAccount.project_id);
        console.log('📧 Client Email:', serviceAccount.client_email);

        // 2. Inicializar Firebase
        console.log('\n2️⃣ Inicializando Firebase...');
        const app = admin.initializeApp({
            credential: admin.credential.cert(serviceAccountPath),
            projectId: serviceAccount.project_id
        });

        console.log('✅ Firebase inicializado');
        console.log('🔗 Projeto:', app.options.projectId);

        // 3. Testar Firestore
        console.log('\n3️⃣ Testando Firestore...');
        const db = admin.firestore();
        
        // Tentar criar uma coleção de teste
        console.log('📝 Criando documento de teste...');
        const testDoc = db.collection('test').doc('connection-test');
        
        await testDoc.set({
            test: true,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            message: 'Teste de conexão Firestore'
        });
        
        console.log('✅ Documento criado com sucesso!');

        // 4. Ler o documento
        console.log('\n4️⃣ Lendo documento...');
        const doc = await testDoc.get();
        if (doc.exists) {
            console.log('✅ Documento lido:', doc.data());
        } else {
            console.log('❌ Documento não encontrado');
        }

        // 5. Limpar teste
        console.log('\n5️⃣ Limpando teste...');
        await testDoc.delete();
        console.log('✅ Teste limpo');

        console.log('\n🎉 Projeto Firebase configurado corretamente!');

    } catch (error) {
        console.error('❌ Erro no teste:', error.message);
        
        if (error.code === 5) {
            console.error('🔍 Erro 5 (NOT_FOUND) - Possíveis causas:');
            console.error('   • Firestore não foi criado no projeto');
            console.error('   • Projeto ID incorreto');
            console.error('   • Credenciais não têm permissão');
            console.error('   • Regras de segurança bloqueando');
        }
        
        console.error('📋 Stack trace:', error.stack);
    }
}

// Executar teste
testFirebaseProject().then(() => {
    console.log('\n🏁 Teste finalizado');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
}); 