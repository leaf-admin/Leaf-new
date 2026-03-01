const jwt = require('jsonwebtoken');

// Configurações JWT
const JWT_SECRET = 'leaf-secret-key-2024-production';
const JWT_EXPIRES_IN = '24h';

// Função para gerar token JWT
function generateJWT(payload) {
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'leaf-backend',
        audience: 'leaf-mobile-app'
    });
}

// Função para verificar token JWT
function verifyJWT(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new Error(`Token inválido: ${error.message}`);
    }
}

// Exemplos de uso
console.log('🔑 GERADOR DE JWT VÁLIDO PARA O PROJETO LEAF');
console.log('=' .repeat(50));

// Token para passageiro
const passengerToken = generateJWT({
    uid: 'passenger_123',
    userType: 'passenger',
    email: 'passenger@leaf.com',
    name: 'João Silva',
    phone: '+5511999999999',
    iat: Math.floor(Date.now() / 1000)
});

console.log('👤 TOKEN PARA PASSAGEIRO:');
console.log(passengerToken);
console.log('');

// Token para motorista
const driverToken = generateJWT({
    uid: 'driver_456',
    userType: 'driver',
    email: 'driver@leaf.com',
    name: 'Maria Santos',
    phone: '+5511888888888',
    license: '123456789',
    vehicle: {
        plate: 'ABC-1234',
        model: 'Honda Civic',
        year: 2020
    },
    iat: Math.floor(Date.now() / 1000)
});

console.log('🚗 TOKEN PARA MOTORISTA:');
console.log(driverToken);
console.log('');

// Token para admin
const adminToken = generateJWT({
    uid: 'admin_789',
    userType: 'admin',
    email: 'admin@leaf.com',
    name: 'Admin Leaf',
    permissions: ['read', 'write', 'delete'],
    iat: Math.floor(Date.now() / 1000)
});

console.log('👨‍💼 TOKEN PARA ADMIN:');
console.log(adminToken);
console.log('');

// Verificar tokens
console.log('🔍 VERIFICANDO TOKENS:');
try {
    const decodedPassenger = verifyJWT(passengerToken);
    console.log('✅ Token passageiro válido:', decodedPassenger);
} catch (error) {
    console.log('❌ Token passageiro inválido:', error.message);
}

try {
    const decodedDriver = verifyJWT(driverToken);
    console.log('✅ Token motorista válido:', decodedDriver);
} catch (error) {
    console.log('❌ Token motorista inválido:', error.message);
}

try {
    const decodedAdmin = verifyJWT(adminToken);
    console.log('✅ Token admin válido:', decodedAdmin);
} catch (error) {
    console.log('❌ Token admin inválido:', error.message);
}

console.log('');
console.log('📝 COMO USAR NO PROJETO:');
console.log('1. Use estes tokens para testar autenticação');
console.log('2. No app mobile, gere tokens similares com os dados do usuário');
console.log('3. Sempre valide tokens no backend antes de processar requisições');
console.log('4. Tokens expiram em 24 horas por segurança');









