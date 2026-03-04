const firebaseConfig = require('../firebase-config');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente
dotenv.config();

// Configurações
const JWT_SECRET = process.env.JWT_SECRET || 'leaf-secret-key-local-test';
const API_URL = 'http://localhost:3001/api';
const TEST_DRIVER_ID = 'test_driver_' + Date.now();
// Usando um ID de admin real encontrado no Firestore para passar na verificação do middleware
const VALID_ADMIN_ID = 'qWnIEWDuMEEyFPhVI3IE';
const VALID_ADMIN_EMAIL = 'izaak.dias@hotmail.com';

async function runTest() {
    console.log('🚀 Iniciando teste de aprovação de motorista (com Admin Real)...');

    try {
        // 1. Inicializar Firebase usando a config do projeto
        console.log('🔥 Inicializando Firebase...');
        const db = firebaseConfig.getRealtimeDB();
        if (!db) {
            throw new Error('Falha ao obter Realtime Database');
        }

        // 2. Criar motorista de teste pendente
        console.log(`📝 Criando motorista de teste: ${TEST_DRIVER_ID}`);
        await db.ref(`users/${TEST_DRIVER_ID}`).set({
            firstName: 'Test',
            lastName: 'Driver Real',
            email: `test_driver_${Date.now()}@example.com`,
            mobile: '+5511999999999',
            usertype: 'driver',
            approved: false,
            createdAt: new Date().toISOString()
        });

        // Criar documentos para o motorista
        await db.ref(`users/${TEST_DRIVER_ID}/documents/cnh`).set({
            fileUrl: 'https://example.com/cnh.jpg',
            status: 'pending',
            uploadedAt: new Date().toISOString()
        });

        // 3. Gerar JWT de admin para o teste
        console.log(`🔑 Gerando token para o admin: ${VALID_ADMIN_EMAIL}...`);
        const token = jwt.sign(
            {
                id: VALID_ADMIN_ID,
                userId: VALID_ADMIN_ID,
                email: VALID_ADMIN_EMAIL,
                role: 'admin',
                permissions: ['all']
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        // 4. Chamar API de aprovação
        console.log(`📡 Chamando API de aprovação para motorista ${TEST_DRIVER_ID}...`);
        try {
            const response = await axios.post(
                `${API_URL}/drivers/applications/${TEST_DRIVER_ID}/approve`,
                { notes: 'Teste automático de aprovação real' },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );
            console.log('✅ Resposta da API:', response.data);
        } catch (apiError) {
            console.error('❌ Erro na chamada da API:', apiError.response?.data || apiError.message);
            throw apiError;
        }

        // 5. Verificar resultado no Firebase
        console.log('🔍 Verificando status no Firebase...');
        const snapshot = await db.ref(`users/${TEST_DRIVER_ID}`).once('value');
        const userData = snapshot.val();

        if (userData.approved === true && userData.status === 'approved') {
            console.log('🎉 SUCESSO! O motorista foi aprovado corretamente no banco de dados.');
        } else {
            console.error('❌ FALHA! O motorista não foi aprovado como esperado.', userData);
        }

        // Verificar documentos
        const docsSnapshot = await db.ref(`users/${TEST_DRIVER_ID}/documents/cnh`).once('value');
        const cnhStatus = docsSnapshot.val()?.status;
        if (cnhStatus === 'approved') {
            console.log('✅ Documento CNH também foi aprovado automaticamente.');
        } else {
            console.error('❌ Documento CNH NÃO foi aprovado.', cnhStatus);
        }

        // Limpeza opcional
        console.log('🧹 Limpando dados de teste...');
        await db.ref(`users/${TEST_DRIVER_ID}`).remove();

    } catch (error) {
        console.error('❌ Erro fatal durante o teste:', error.message);
    } finally {
        process.exit();
    }
}

runTest();
