const fs = require('fs');
const path = require('path');

class SSLConfig {
  constructor() {
    this.sslEnabled = process.env.SSL_ENABLED === 'true';
    this.sslConfig = null;
    
    if (this.sslEnabled) {
      this.initializeSSL();
    }
  }

  initializeSSL() {
    try {
      const certPath = process.env.SSL_CERT_PATH || '/etc/ssl/certs/leaf.crt';
      const keyPath = process.env.SSL_KEY_PATH || '/etc/ssl/private/leaf.key';
      
      // Verificar se os certificados existem
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        this.sslConfig = {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath)
        };
        
        console.log('🔒 SSL habilitado com certificados customizados');
      } else {
        console.log('⚠️ Certificados SSL não encontrados, SSL desabilitado');
        this.sslEnabled = false;
      }
    } catch (error) {
      console.error('❌ Erro ao configurar SSL:', error.message);
      this.sslEnabled = false;
    }
  }

  getSSLConfig() {
    return this.sslConfig;
  }

  isEnabled() {
    return this.sslEnabled;
  }

  // Gerar certificado auto-assinado para desenvolvimento
  generateSelfSignedCert() {
    const selfSigned = require('selfsigned');
    
    const attrs = [
      { name: 'commonName', value: process.env.DOMAIN || 'localhost' },
      { name: 'countryName', value: 'BR' },
      { name: 'stateOrProvinceName', value: 'SP' },
      { name: 'localityName', value: 'São Paulo' },
      { name: 'organizationName', value: 'Leaf App' }
    ];

    const opts = {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: '216.238.107.59' },
            { type: 2, value: 'leaf.app.br' }
          ]
        }
      ]
    };

    const pems = selfSigned.generate(attrs, opts);
    
    return {
      key: pems.private,
      cert: pems.cert
    };
  }

  // Configuração para desenvolvimento
  getDevSSLConfig() {
    if (!this.sslConfig) {
      console.log('🔒 Gerando certificado auto-assinado para desenvolvimento...');
      this.sslConfig = this.generateSelfSignedCert();
    }
    return this.sslConfig;
  }
}

module.exports = SSLConfig;







