# 🔐 Arquitetura KYC Correta

## ⚠️ REGRA DE OURO

> **Backend NÃO faz detecção contínua nem liveness.**
> 
> **Backend SÓ compara duas imagens (embeddings).**

---

## 📱 MOBILE (React Native)

### ✅ Roda no dispositivo:
- **Câmera** (`react-native-vision-camera`)
- **Face detection** (`@tensorflow/tfjs-react-native` + `@tensorflow-models/face-landmarks-detection`)
- **Landmarks** (MediaPipe FaceMesh lite)
- **Liveness** (piscar, sorrir, virar cabeça)
- **Captura de 1 frame** (após liveness validado)

### ❌ NÃO roda no dispositivo:
- Embedding
- Reconhecimento
- Comparação

---

## 🖥️ BACKEND (Node.js)

### ✅ Roda APENAS:
- **Resize** (`sharp` - 224x224)
- **Embedding** (`insightface-node` - apenas embedding, sem detecção)
- **Cosine similarity** (`ml-matrix`)

### ❌ NÃO roda no backend:
- Face detection
- Landmarks
- Liveness
- Processamento de vídeo
- Streams

---

## 🧱 STACK CORRETA

### ❌ NÃO USAR:
```txt
face-api.js (no backend)
tensorflow full no backend
deepface
dlib
video stream
detectAllFaces
withFaceLandmarks
withFaceDescriptors
```

### ✅ USAR:

**Mobile:**
```txt
react-native-vision-camera
@tensorflow/tfjs-react-native
@tensorflow-models/face-landmarks-detection (MediaPipe lite)
```

**Backend:**
```txt
sharp (resize)
insightface-node (embedding-only)
ml-matrix (cosine similarity)
```

---

## 📐 PIPELINE CORRETO

### Mobile:
```
1. Abrir câmera
2. Detectar face (TensorFlow.js)
3. Validar liveness (piscar/sorrir)
4. Capturar 1 frame (já com face detectada e alinhada)
5. Enviar imagem para backend
```

### Backend:
```
1. Receber imagem (já com face detectada)
2. Resize para 224x224 (sharp)
3. Gerar embedding (insightface-node)
4. Comparar com embedding armazenado (cosine similarity)
5. Retornar score
```

---

## 🛑 CÓDIGO BACKEND CORRETO

### ✅ CORRETO:
```javascript
// Backend APENAS gera embedding
async generateFaceEmbedding(imageBuffer) {
  // Resize
  const normalized = await sharp(imageBuffer)
    .resize(224, 224)
    .toBuffer();
  
  // Embedding (sem detecção!)
  const embedding = await insightface.getEmbedding(normalized);
  return embedding;
}

// Comparação
calculateCosineSimilarity(embedding1, embedding2) {
  // ... cosine similarity
}
```

### ❌ ERRADO:
```javascript
// ❌ NÃO fazer isso no backend!
const detection = await faceapi
  .detectAllFaces(imageBuffer)  // ❌ Detecção no backend
  .withFaceLandmarks()           // ❌ Landmarks no backend
  .withFaceDescriptors();        // ❌ Descriptors no backend
```

---

## ⚡ Por que essa arquitetura?

### Problemas de fazer detecção no backend:
- ❌ Face-API em Node usa TensorFlow pesado
- ❌ Consumo de RAM explode
- ❌ Cada request vira inferência completa
- ❌ VPS morre com poucos usuários
- ❌ Latência alta

### Vantagens de embedding-only no backend:
- ✅ Leve (apenas embedding, sem detecção)
- ✅ Rápido (~50-100ms)
- ✅ Escalável (muitos usuários simultâneos)
- ✅ Baixo consumo de RAM
- ✅ Mobile faz o trabalho pesado (detecção)

---

## 📊 Peso Comparativo

| Abordagem | VPS | Mobile |
|-----------|-----|--------|
| face-api backend | 🟥 Morre | ✅ Leve |
| deepface backend | 🟥 Morre | ✅ Leve |
| **embedding-only** | 🟩 Tranquilo | ✅ Leve |

---

## 🧠 RESUMO DIRETO

> **Você não quer "reconhecimento facial no backend".**
> 
> **Você quer "comparação de embeddings".**

Isso é o que faz ser **leve**.

---

## 🔧 Implementação

### Mobile:
- Já implementado: `KYCDocumentStep.js` captura imagens
- **Próximo passo**: Adicionar detecção facial com TensorFlow.js antes de enviar

### Backend:
- ✅ Já corrigido: `kyc-service.js` apenas embedding
- ✅ Usa `insightface-node` (leve)
- ✅ Não faz detecção

---

## 📝 Checklist

- [x] Remover detecção facial do backend
- [x] Usar `insightface-node` apenas para embedding
- [x] Mobile faz detecção e liveness
- [ ] Adicionar detecção facial no mobile (TensorFlow.js)
- [ ] Testar pipeline completo

