const axios = require('axios');

async function testAuth() {
    try {
        console.log('🔍 Testando autenticação...');
        
        const response = await axios.post('http://localhost:3001/auth/login', {
            phone: '+5511777777777',
            password: '123456',
            userType: 'ADMIN'
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
        
        console.log('✅ Resposta:', response.data);
        return true;
    } catch (error) {
        console.log('❌ Erro:', error.message);
        if (error.response) {
            console.log('📊 Status:', error.response.status);
            console.log('📊 Headers:', error.response.headers);
            console.log('📊 Data:', error.response.data);
        }
        return false;
    }
}

testAuth();



