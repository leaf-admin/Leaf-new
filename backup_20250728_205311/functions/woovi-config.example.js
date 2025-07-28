// ===== WOOVI PIX CONFIGURATION EXAMPLE =====
// Copie este arquivo para woovi-config.js e preencha com suas credenciais

module.exports = {
    // OpenPix/Woovi API Configuration
    WOOVI_BASE_URL: 'https://api.openpix.com.br',
    WOOVI_APP_ID: 'your_app_id_here',
    WOOVI_WEBHOOK_URL: 'https://leaf-reactnative.web.app/woovi-webhook',

    // Firebase Configuration
    FIREBASE_PROJECT_ID: 'leaf-reactnative',
    FIREBASE_DATABASE_URL: 'https://leaf-reactnative-default-rtdb.firebaseio.com',

    // Redis Configuration
    REDIS_URL: 'redis://localhost:6379',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',

    // Other Configurations
    NODE_ENV: 'production'
};

// ===== INSTRUÇÕES DE CONFIGURAÇÃO =====
/*
1. Crie uma conta na Woovi: https://woovi.com
2. Acesse o painel de desenvolvedores
3. Crie uma nova aplicação
4. Copie o App ID e Secret Key
5. Configure o webhook URL
6. Teste a integração

Para usar em produção:
1. Configure as variáveis de ambiente no Firebase Functions
2. Ou use o arquivo .env (não commitar no git)
3. Teste com valores pequenos primeiro
4. Monitore os logs de transação
*/ 