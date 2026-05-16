# ✅ Correção: Comparação com Foto de Perfil (Anchor Image)

**Data:** 2026-01-08  
**Status:** ✅ Corrigido

---

## 🔍 Problema Identificado

O sistema estava comparando a selfie atual com a **CNH**, quando deveria comparar com a **foto de perfil (anchor image)** salva no onboarding.

### Fluxo Anterior (Incorreto):
```
1. Selfie atual
2. Buscar CNH do Firebase
3. Comparar Selfie ↔ CNH ❌
```

### Fluxo Correto:
```
1. Selfie atual
2. Buscar foto âncora (anchor image) do Firestore
3. Comparar Selfie ↔ Foto de Perfil ✅
4. Fallback: Se não tiver foto âncora, usar CNH
```

---

## 🛠️ Correções Implementadas

### 1. **Método para Buscar Foto Âncora** (`firebase-storage-service.js`)

**Adicionado:**
```javascript
async getAnchorImage(userId) {
  // Busca foto âncora no Firestore
  // drivers/{userId}.kycAnchorImage
  // users/{userId}.kycAnchorImage (fallback)
  // Retorna: { url, embedding, verifiedAt }
}
```

**Onde está salva:**
- `drivers/{userId}.kycAnchorImage` - URL da foto
- `drivers/{userId}.kycEmbedding` - Embedding facial (512D)
- `drivers/{userId}.kycVerifiedAt` - Data de verificação

---

### 2. **Atualização do Fluxo VPS** (`IntegratedKYCService.js`)

**Antes:**
```javascript
// Buscar CNH
const cnhUrl = await this.firebaseStorage.getCNHUrl(userId);
const cnhBuffer = await this.firebaseStorage.downloadFile(cnhUrl);
// Comparar com CNH
```

**Depois:**
```javascript
// ✅ Buscar foto âncora primeiro
const anchorData = await this.firebaseStorage.getAnchorImage(userId);

if (anchorData && anchorData.url) {
  // ✅ Usar foto âncora
  referenceImageBuffer = await this.firebaseStorage.downloadFile(anchorData.url);
  usingAnchorImage = true;
} else {
  // Fallback: usar CNH
  const cnhUrl = await this.firebaseStorage.getCNHUrl(userId);
  referenceImageBuffer = await this.firebaseStorage.downloadFile(cnhUrl);
}
```

---

### 3. **Atualização do Processamento Local** (`IntegratedKYCService.js`)

**Novo método:** `verifyWithLocalProcessing()`

```javascript
async verifyWithLocalProcessing(userId, currentImageBuffer, options) {
  // 1. Buscar foto âncora
  const anchorData = await this.firebaseStorage.getAnchorImage(userId);
  
  if (anchorData && anchorData.embedding) {
    // ✅ Usar embedding diretamente (mais eficiente)
    // Gerar embedding da selfie atual
    // Comparar embeddings
  } else {
    // Fallback: usar CNH
  }
}
```

**Vantagens:**
- ✅ Usa embedding salvo (não precisa baixar imagem)
- ✅ Mais rápido (sem download)
- ✅ Menos uso de banda

---

## 📊 Fluxo Completo Atualizado

### Onboarding (Primeira Vez):
```
1. Usuário faz upload de CNH + Selfie
2. Compara CNH ↔ Selfie
3. Se aprovado:
   └─> Salva selfie como "anchor image" no Firestore
   └─> Salva embedding (512D) no Firestore
   └─> drivers/{userId}.kycAnchorImage = URL
   └─> drivers/{userId}.kycEmbedding = [512 números]
```

### Verificação (Re-verificação):
```
1. Usuário tira nova selfie
2. Backend busca foto âncora do Firestore
3. Se encontrada:
   └─> Baixa foto âncora OU usa embedding salvo
   └─> Compara Selfie Atual ↔ Foto de Perfil ✅
4. Se não encontrada:
   └─> Fallback: usa CNH (compatibilidade)
```

---

## 🎯 Benefícios

1. ✅ **Comparação Correta** - Selfie vs Foto de Perfil (não CNH)
2. ✅ **Mais Preciso** - Foto de perfil é melhor referência que CNH
3. ✅ **Mais Rápido** - Pode usar embedding salvo (sem download)
4. ✅ **Compatibilidade** - Fallback para CNH se não tiver foto âncora
5. ✅ **Logs Detalhados** - Indica se usou foto âncora ou CNH

---

## 📝 Logs Adicionados

```javascript
// Quando usa foto âncora:
logStructured('info', 'Foto âncora encontrada, usando para comparação', {
  service: 'integrated-kyc-service',
  userId
});

// Quando usa CNH (fallback):
logStructured('warn', 'Foto âncora não encontrada, usando CNH como fallback', {
  service: 'integrated-kyc-service',
  userId
});

// Resultado:
logStructured('info', 'Processamento VPS concluído', {
  usingAnchorImage: true // ✅ Indica qual foi usado
});
```

---

## 🔄 Compatibilidade

### Usuários Antigos (sem foto âncora):
- ✅ Sistema usa CNH como fallback
- ✅ Funciona normalmente
- ✅ Próxima verificação já usará foto âncora (se onboarding foi feito)

### Usuários Novos (com foto âncora):
- ✅ Sistema usa foto âncora diretamente
- ✅ Mais rápido e preciso
- ✅ Melhor experiência

---

## ✅ Checklist

- [x] Método `getAnchorImage()` criado
- [x] Fluxo VPS atualizado para usar foto âncora
- [x] Processamento local atualizado para usar foto âncora
- [x] Fallback para CNH implementado
- [x] Logs detalhados adicionados
- [x] Compatibilidade com usuários antigos mantida

---

## 🧪 Como Testar

### 1. Testar com Foto Âncora:
```javascript
// Usuário que fez onboarding
const result = await kycService.verifyDriver(userId, selfieBuffer);
// Deve usar foto âncora
// Log: "Foto âncora encontrada, usando para comparação"
```

### 2. Testar Fallback (CNH):
```javascript
// Usuário antigo (sem foto âncora)
const result = await kycService.verifyDriver(userId, selfieBuffer);
// Deve usar CNH
// Log: "Foto âncora não encontrada, usando CNH como fallback"
```

---

**Última atualização:** 2026-01-08

