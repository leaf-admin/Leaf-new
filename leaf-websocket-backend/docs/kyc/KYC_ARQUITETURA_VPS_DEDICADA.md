# 🏗️ ARQUITETURA KYC - VPS DEDICADA

## 📋 VISÃO GERAL

Este documento descreve a arquitetura completa para processar KYC em uma VPS dedicada, mantendo as fotos da CNH no Firebase Storage.

---

## 🎯 FLUXO COMPLETO

### **1. ARMAZENAMENTO (Firebase Storage)**
```
Mobile App → Upload CNH → Firebase Storage
Path: documents/{userId}/cnh/{fileName}.jpg
URL salva em: users/{userId}/documents/cnh/fileUrl
```

### **2. PROCESSAMENTO (VPS Dedicada KYC)**
```
Servidor Principal → Busca URL no Firestore → Baixa do Firebase Storage → Envia para VPS KYC → Processa → Retorna resultado
```

---

## 🏛️ ARQUITETURA DETALHADA

### **COMPONENTES:**

#### **1. Servidor Principal (VPS Atual)**
- **Responsabilidade**: Orquestração, comunicação com Firebase
- **Localização**: `216.238.107.59:3001`
- **Funções**:
  - Recebe requisição do mobile app
  - Busca URL da CNH no Firestore
  - Baixa imagem do Firebase Storage
  - Envia buffer da imagem para VPS KYC
  - Retorna resultado para mobile app

#### **2. VPS Dedicada KYC**
- **Responsabilidade**: Processamento facial (CPU/RAM intensivo)
- **Especificações**: 2 vCPU, 8GB RAM, 100GB NVMe
- **Funções**:
  - Recebe buffer da imagem da CNH
  - Extrai face da CNH (OCR + detecção facial)
  - Processa encoding facial
  - Compara com foto da câmera (verificação)
  - Retorna resultado (similarity, confidence)

#### **3. Firebase Storage**
- **Responsabilidade**: Armazenamento de fotos
- **Estrutura**:
  ```
  documents/
    {userId}/
      cnh/
        cnh_1234567890.jpg
      crlv/
        crlv_1234567890.jpg
  ```

#### **4. Firestore/Realtime Database**
- **Responsabilidade**: Metadados e URLs
- **Estrutura**:
  ```json
  users/{userId}/documents/cnh: {
    "type": "cnh",
    "fileUrl": "https://storage.googleapis.com/...",
    "status": "approved",
    "uploadedAt": "2024-01-01T00:00:00Z"
  }
  ```

---

## 🔄 FLUXO DE PROCESSAMENTO

### **PASSO 1: Upload da CNH (Mobile App)**
```javascript
// Mobile App já faz isso:
const storageRef = storage().ref(`documents/${uid}/cnh/${fileName}`);
await storageRef.putFile(fileUri);
const downloadURL = await storageRef.getDownloadURL();

// Salva no Firestore:
await db.ref(`users/${uid}/documents/cnh`).set({
  type: 'cnh',
  fileUrl: downloadURL,
  status: 'analyzing',
  uploadedAt: new Date().toISOString()
});
```

### **PASSO 2: Processamento Inicial (Servidor Principal)**
```javascript
// Servidor Principal recebe requisição:
POST /api/kyc/upload-profile
Body: { userId, imageBuffer (foto da câmera) }

// 1. Busca URL da CNH no Firestore
const cnhDoc = await firestore.collection('users').doc(userId)
  .collection('documents').doc('cnh').get();
const cnhUrl = cnhDoc.data().fileUrl;

// 2. Baixa CNH do Firebase Storage
const cnhBuffer = await downloadFromFirebaseStorage(cnhUrl);

// 3. Envia para VPS KYC
const result = await fetch('http://VPS_KYC_IP:3002/api/kyc/process', {
  method: 'POST',
  body: JSON.stringify({
    userId,
    cnhImage: cnhBuffer.toString('base64'),
    currentImage: imageBuffer.toString('base64')
  })
});
```

### **PASSO 3: Processamento na VPS KYC**
```javascript
// VPS KYC recebe:
POST /api/kyc/process
Body: {
  userId: "uuid",
  cnhImage: "base64...",
  currentImage: "base64..."
}

// 1. Extrai face da CNH
const cnhFace = await extractFaceFromCNH(cnhImage);

// 2. Processa encoding da CNH
const cnhEncoding = await preprocessProfileImage(userId, cnhFace);

// 3. Compara com foto atual
const verification = await verifyDriver(userId, currentImage, cnhEncoding);

// 4. Retorna resultado
return {
  success: true,
  isMatch: true,
  similarityScore: 0.92,
  confidence: "Alta"
};
```

### **PASSO 4: Resposta ao Mobile App**
```javascript
// Servidor Principal retorna:
{
  success: true,
  isMatch: true,
  similarityScore: 0.92,
  confidence: "Alta",
  processingTime: 2500
}
```

---

## 🔧 IMPLEMENTAÇÃO TÉCNICA

### **1. Serviço de Download do Firebase Storage**

**Arquivo**: `leaf-websocket-backend/services/firebase-storage-service.js`

```javascript
const admin = require('firebase-admin');
const https = require('https');
const http = require('http');

class FirebaseStorageService {
  constructor() {
    this.storage = admin.storage();
  }

  /**
   * Baixa arquivo do Firebase Storage por URL
   * @param {string} fileUrl - URL completa do arquivo
   * @returns {Promise<Buffer>} Buffer do arquivo
   */
  async downloadFile(fileUrl) {
    try {
      // Se URL é do Firebase Storage, usar Admin SDK
      if (fileUrl.includes('firebase.googleapis.com') || fileUrl.includes('storage.googleapis.com')) {
        // Extrair path do bucket
        const urlObj = new URL(fileUrl);
        const pathParts = urlObj.pathname.split('/');
        const bucketName = pathParts[1];
        const filePath = pathParts.slice(2).join('/');
        
        const bucket = this.storage.bucket(bucketName);
        const file = bucket.file(filePath);
        
        const [buffer] = await file.download();
        return buffer;
      }
      
      // Fallback: download HTTP direto
      return await this.downloadFromUrl(fileUrl);
      
    } catch (error) {
      console.error('❌ Erro ao baixar arquivo:', error);
      throw error;
    }
  }

  /**
   * Download HTTP direto (fallback)
   */
  async downloadFromUrl(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Busca URL da CNH no Firestore
   * @param {string} userId - ID do usuário
   * @returns {Promise<string|null>} URL da CNH ou null
   */
  async getCNHUrl(userId) {
    try {
      const firestore = admin.firestore();
      const docRef = firestore.collection('users').doc(userId)
        .collection('documents').doc('cnh');
      
      const doc = await docRef.get();
      
      if (doc.exists) {
        const data = doc.data();
        return data.fileUrl || null;
      }
      
      // Fallback: Realtime Database
      const db = admin.database();
      const snapshot = await db.ref(`users/${userId}/documents/cnh`).once('value');
      const cnhData = snapshot.val();
      
      return cnhData?.fileUrl || null;
      
    } catch (error) {
      console.error('❌ Erro ao buscar URL da CNH:', error);
      return null;
    }
  }
}

module.exports = FirebaseStorageService;
```

### **2. Cliente HTTP para VPS KYC**

**Arquivo**: `leaf-websocket-backend/services/kyc-vps-client.js`

```javascript
const axios = require('axios');

class KYCVPSClient {
  constructor() {
    this.vpsUrl = process.env.KYC_VPS_URL || 'http://KYCVPS_IP:3002';
    this.timeout = 30000; // 30s
  }

  /**
   * Processa KYC na VPS dedicada
   * @param {string} userId - ID do usuário
   * @param {Buffer} cnhBuffer - Buffer da CNH
   * @param {Buffer} currentImageBuffer - Buffer da foto atual
   * @returns {Promise<Object>} Resultado da verificação
   */
  async processKYC(userId, cnhBuffer, currentImageBuffer) {
    try {
      const response = await axios.post(
        `${this.vpsUrl}/api/kyc/process`,
        {
          userId,
          cnhImage: cnhBuffer.toString('base64'),
          currentImage: currentImageBuffer.toString('base64')
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
      
    } catch (error) {
      console.error('❌ Erro ao processar KYC na VPS:', error);
      throw error;
    }
  }

  /**
   * Health check da VPS KYC
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.vpsUrl}/api/kyc/health`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }
}

module.exports = KYCVPSClient;
```

### **3. Integração no Servidor Principal**

**Arquivo**: `leaf-websocket-backend/routes/kyc-routes.js` (modificação)

```javascript
const FirebaseStorageService = require('../services/firebase-storage-service');
const KYCVPSClient = require('../services/kyc-vps-client');

// ...

// Upload de imagem de perfil (agora busca CNH do Firebase)
this.router.post('/upload-profile', this.upload.single('image'), async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId é obrigatório'
      });
    }

    // 1. Buscar URL da CNH no Firestore
    const storageService = new FirebaseStorageService();
    const cnhUrl = await storageService.getCNHUrl(userId);
    
    if (!cnhUrl) {
      return res.status(404).json({
        success: false,
        error: 'CNH não encontrada. Faça upload da CNH primeiro.'
      });
    }

    // 2. Baixar CNH do Firebase Storage
    const cnhBuffer = await storageService.downloadFile(cnhUrl);
    
    // 3. Enviar para VPS KYC para processar
    const vpsClient = new KYCVPSClient();
    const result = await vpsClient.processKYC(
      userId,
      cnhBuffer,
      req.file.buffer
    );

    // 4. Retornar resultado
    res.json(result);

  } catch (error) {
    console.error('Erro no upload de perfil:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});
```

---

## 🔐 SEGURANÇA E COMUNICAÇÃO

### **1. Comunicação entre Servidores**

#### **Opção A: HTTP/HTTPS (Recomendado para MVP)**
- **Protocolo**: HTTP (interno) ou HTTPS (produção)
- **Autenticação**: API Key ou JWT
- **Vantagens**: Simples, fácil de debugar
- **Desvantagens**: Menos seguro que VPN

#### **Opção B: VPN (Recomendado para Produção)**
- **Protocolo**: HTTP sobre VPN privada
- **Autenticação**: Certificados VPN
- **Vantagens**: Mais seguro, isolado
- **Desvantagens**: Configuração mais complexa

### **2. Autenticação entre Servidores**

```javascript
// Adicionar header de autenticação
const response = await axios.post(
  `${this.vpsUrl}/api/kyc/process`,
  data,
  {
    headers: {
      'Authorization': `Bearer ${process.env.KYC_VPS_API_KEY}`,
      'X-Server-ID': 'main-server'
    }
  }
);
```

### **3. Validação na VPS KYC**

```javascript
// Middleware de autenticação na VPS KYC
const authenticateVPSRequest = (req, res, next) => {
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  const serverId = req.headers['x-server-id'];
  
  if (apiKey !== process.env.API_KEY || serverId !== 'main-server') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};
```

---

## 📊 FLUXO DE DADOS

```
┌─────────────┐
│ Mobile App  │
└──────┬──────┘
       │ 1. POST /api/kyc/upload-profile
       │    { userId, currentImage }
       ▼
┌─────────────────────┐
│ Servidor Principal  │
│ (216.238.107.59)    │
└──────┬──────────────┘
       │ 2. Busca URL CNH no Firestore
       │ 3. Baixa CNH do Firebase Storage
       │ 4. POST http://VPS_KYC:3002/api/kyc/process
       │    { userId, cnhImage (base64), currentImage (base64) }
       ▼
┌─────────────────────┐
│   VPS KYC Dedicada  │
│  (KYCVPS_IP:3002)   │
└──────┬──────────────┘
       │ 5. Extrai face da CNH
       │ 6. Processa encoding
       │ 7. Compara com foto atual
       │ 8. Retorna resultado
       ▼
┌─────────────────────┐
│ Servidor Principal  │
└──────┬──────────────┘
       │ 9. Retorna resultado
       ▼
┌─────────────┐
│ Mobile App  │
└─────────────┘
```

---

## 💾 ARMAZENAMENTO DE DADOS

### **O que fica no Firebase Storage:**
- ✅ Foto original da CNH (permanente)
- ✅ Outros documentos (CRLV, etc.)

### **O que fica na VPS KYC:**
- ✅ Encoding facial (temporário, 24h)
- ✅ Cache de verificações (temporário, 24h)
- ✅ Analytics e métricas (temporário)

### **O que fica no Redis (Servidor Principal):**
- ✅ Cache de verificações (24h)
- ✅ Status de verificação
- ✅ FCM tokens

### **O que fica no Firestore:**
- ✅ Metadados dos documentos
- ✅ URLs dos arquivos
- ✅ Status de aprovação

---

## 🚀 VANTAGENS DESTA ARQUITETURA

### **✅ Separação de Responsabilidades**
- Servidor Principal: Orquestração e comunicação
- VPS KYC: Processamento pesado isolado

### **✅ Escalabilidade**
- VPS KYC pode escalar independentemente
- Não impacta performance do servidor principal

### **✅ Segurança**
- Fotos permanecem no Firebase (backup automático)
- Processamento isolado em VPS dedicada

### **✅ Manutenibilidade**
- Código KYC isolado
- Fácil atualizar/upgrade sem afetar servidor principal

### **✅ Custo**
- VPS dedicada menor (2 vCPU) é suficiente
- Servidor principal não precisa de mais recursos

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

### **Servidor Principal:**
- [ ] Criar `FirebaseStorageService`
- [ ] Criar `KYCVPSClient`
- [ ] Modificar `kyc-routes.js` para usar VPS
- [ ] Adicionar variável de ambiente `KYC_VPS_URL`
- [ ] Testar download do Firebase Storage
- [ ] Testar comunicação com VPS KYC

### **VPS KYC Dedicada:**
- [ ] Setup Node.js, Redis, dependências
- [ ] Configurar autenticação (API Key)
- [ ] Implementar endpoint `/api/kyc/process`
- [ ] Implementar health check
- [ ] Configurar workers (2 workers)
- [ ] Testar processamento completo

### **Segurança:**
- [ ] Configurar API Key para comunicação
- [ ] Configurar firewall (apenas servidor principal)
- [ ] Considerar VPN para produção

### **Monitoramento:**
- [ ] Logs estruturados
- [ ] Métricas de performance
- [ ] Alertas de falha

---

## 🔧 VARIÁVEIS DE AMBIENTE

### **Servidor Principal:**
```env
KYC_VPS_URL=http://KYCVPS_IP:3002
KYC_VPS_API_KEY=seu-api-key-secreto
```

### **VPS KYC:**
```env
API_KEY=seu-api-key-secreto
REDIS_URL=redis://localhost:6379
WORKER_COUNT=2
```

---

## 📝 PRÓXIMOS PASSOS

1. ✅ Criar `FirebaseStorageService`
2. ✅ Criar `KYCVPSClient`
3. ✅ Modificar rotas KYC
4. ✅ Setup VPS dedicada
5. ✅ Testar fluxo completo
6. ✅ Deploy em produção




