const crypto = require('crypto');

// Gerar JWT Secret forte (256-bit)
function generateJWTSecret() {
    return crypto.randomBytes(64).toString('hex');
}

// Gerar chave de criptografia (AES-256)
function generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
}

// Gerar API Key interna
function generateInternalAPIKey() {
    return 'leaf_internal_' + crypto.randomBytes(32).toString('hex');
}

// Gerar todas as chaves
console.log('🔐 CHAVES DE SEGURANÇA GERADAS:');
console.log('');
console.log('# Adicionar ao .env:');
console.log(`JWT_SECRET=${generateJWTSecret()}`);
console.log(`ENCRYPTION_KEY=${generateEncryptionKey()}`);
console.log(`INTERNAL_API_KEY=${generateInternalAPIKey()}`);
console.log('');
console.log('⚠️  IMPORTANTE: Salve essas chaves em local seguro!');
console.log('⚠️  NUNCA commite essas chaves no Git!');
console.log('⚠️  Use diferentes chaves para dev/staging/production!');







