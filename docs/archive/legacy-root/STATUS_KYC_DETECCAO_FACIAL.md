# 📊 Status da Detecção Facial no KYC

**Data:** 2026-01-08  
**Status:** ⚠️ Arquitetura Planejada, Implementação Parcial

---

## 🎯 Arquitetura Planejada (Correta)

### ✅ **MOBILE (Dispositivo do Usuário) - Parte Pesada**

**O que DEVE rodar no mobile:**
- ✅ **Câmera** (`react-native-vision-camera`)
- ⚠️ **Face Detection** (`@tensorflow/tfjs-react-native` + `@tensorflow-models/face-landmarks-detection`)
- ⚠️ **Landmarks** (MediaPipe FaceMesh lite)
- ⚠️ **Liveness Detection** (piscar, sorrir, virar cabeça)
- ✅ **Captura de 1 frame** (após liveness validado)

**Status:** ⚠️ **NÃO IMPLEMENTADO NO MOBILE AINDA**

---

### ✅ **BACKEND (Servidor) - Parte Leve**

**O que RODA no backend:**
- ✅ **Resize** (`sharp` - 224x224) - **IMPLEMENTADO**
- ✅ **Embedding** (`insightface-node` - apenas embedding, sem detecção) - **IMPLEMENTADO**
- ✅ **Cosine Similarity** (`ml-matrix`) - **IMPLEMENTADO**

**O que NÃO RODA no backend:**
- ❌ Face Detection - **CORRETO** (não faz)
- ❌ Landmarks - **CORRETO** (não faz)
- ❌ Liveness - **CORRETO** (não faz)

**Status:** ✅ **IMPLEMENTADO CORRETAMENTE**

---

## 📋 Estado Atual da Implementação

### Backend (`services/kyc-service.js`)

✅ **CORRETO:**
```javascript
// ⚠️ ARQUITETURA CORRETA:
// - Mobile: Face detection, landmarks, liveness (TUDO no device)
// - Backend: APENAS embedding + comparação (NÃO faz detecção!)

async generateFaceEmbedding(imageBuffer) {
  // InsightFace gera embedding APENAS (sem detecção)
  // Mobile já fez a detecção e alinhamento
  const embedding = await insightface.getEmbedding(imageBuffer);
  return embedding; // 512D
}
```

**Comentários no código:**
- ✅ "Mobile já detectou e alinhou a face antes de enviar"
- ✅ "Backend apenas gera embedding da imagem já processada"
- ✅ "NÃO inicializar detecção facial aqui!"

---

### Mobile App

⚠️ **STATUS: NÃO ENCONTRADO**

**O que falta:**
- ❌ Detecção facial antes de enviar imagem
- ❌ Validação de liveness
- ❌ Alinhamento de face
- ❌ Validação de qualidade da imagem

**O que provavelmente está fazendo:**
- ✅ Captura imagem da câmera
- ❌ Envia imagem RAW para backend (sem processamento)

---

## 🔍 Código Backend Atual

### ✅ `services/kyc-service.js` - CORRETO

```javascript
// REGRA DE OURO:
// "Backend NÃO faz detecção contínua nem liveness.
//  Backend SÓ compara duas imagens (embeddings)."

async generateFaceEmbedding(imageBuffer) {
  // ⚠️ Mobile já detectou e alinhou a face antes de enviar
  // Backend apenas gera embedding da imagem já processada
  const embedding = await insightface.getEmbedding(imageBuffer);
  return embedding;
}
```

**✅ Backend está correto!** Não faz detecção, apenas embedding.

---

### ⚠️ `services/KYCFaceProcessor.js` - DEPRECADO

```javascript
// ❌ CÓDIGO ANTIGO (não deveria estar sendo usado)
const detections = await faceapi.detectAllFaces(image)
  .withFaceLandmarks()
  .withFaceDescriptors();
```

**Status:** ⚠️ Código antigo ainda existe, mas não é usado no fluxo principal.

---

## 📊 Resumo

| Componente | Status | Onde Roda |
|------------|--------|-----------|
| **Face Detection** | ⚠️ Planejado | Mobile (não implementado) |
| **Landmarks** | ⚠️ Planejado | Mobile (não implementado) |
| **Liveness** | ⚠️ Planejado | Mobile (não implementado) |
| **Embedding** | ✅ Implementado | Backend (correto) |
| **Comparação** | ✅ Implementado | Backend (correto) |

---

## 🎯 O Que Está Funcionando Agora

### Fluxo Atual (Temporário):

```
1. Mobile captura imagem RAW
2. Mobile envia imagem para backend
3. Backend assume que imagem tem face (não valida)
4. Backend gera embedding
5. Backend compara embeddings
```

**Problemas:**
- ⚠️ Backend não valida se há face na imagem
- ⚠️ Backend não valida qualidade da imagem
- ⚠️ Backend não valida liveness
- ⚠️ Pode processar imagens sem face

---

## 🚀 O Que Precisa Ser Feito

### Mobile App (React Native)

**Implementar:**
1. ✅ Instalar dependências:
   ```bash
   npm install @tensorflow/tfjs-react-native
   npm install @tensorflow-models/face-landmarks-detection
   npm install react-native-vision-camera
   ```

2. ✅ Adicionar detecção facial antes de enviar:
   ```javascript
   // Antes de enviar para backend
   const faceDetected = await detectFace(image);
   if (!faceDetected) {
     throw new Error('Nenhuma face detectada');
   }
   ```

3. ✅ Adicionar validação de liveness:
   ```javascript
   // Validar ações do usuário
   const livenessValid = await validateLiveness();
   if (!livenessValid) {
     throw new Error('Liveness não validado');
   }
   ```

4. ✅ Alinhar face antes de enviar:
   ```javascript
   // Alinhar face para melhor embedding
   const alignedFace = await alignFace(image, landmarks);
   ```

---

## 📝 Conclusão

### ✅ Backend está CORRETO
- Não faz detecção (correto)
- Apenas embedding (correto)
- Leve e escalável (correto)

### ⚠️ Mobile precisa implementar
- Detecção facial antes de enviar
- Validação de liveness
- Alinhamento de face

### 🎯 Arquitetura Final (Quando Mobile Estiver Pronto)

```
MOBILE:
1. Abrir câmera
2. Detectar face (TensorFlow.js)
3. Validar liveness (piscar/sorrir)
4. Alinhar face
5. Capturar frame processado
6. Enviar para backend

BACKEND:
1. Receber imagem (já com face detectada)
2. Resize 224x224
3. Gerar embedding
4. Comparar embeddings
5. Retornar score
```

---

## 🔧 Próximos Passos

1. ⏳ Implementar detecção facial no mobile
2. ⏳ Implementar liveness detection no mobile
3. ⏳ Validar qualidade da imagem no mobile
4. ⏳ Testar fluxo completo

---

**Última atualização:** 2026-01-08

