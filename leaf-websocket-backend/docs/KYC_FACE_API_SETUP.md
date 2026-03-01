# 🔐 Configuração Face-API para KYC

## 📋 Arquitetura

### ❌ **NÃO roda no dispositivo (mobile)**
- Processamento pesado (embedding)
- Face-API completa
- Comparação de imagens
- Modelos ML (~50MB)

### ✅ **Roda no Backend (VPS)**
- `@vladmandic/face-api` - Biblioteca Node.js
- Geração de embeddings (512D)
- Detecção facial
- Comparação CNH ↔ Selfie
- Cosine similarity

### 📱 **Mobile apenas:**
- Captura de CNH (câmera/galeria)
- Captura de Selfie (câmera frontal)
- Liveness básico (ação visual)
- Upload para backend

### 🖥️ **Backend faz tudo:**
- OCR da CNH (Tesseract)
- Detecção facial (Face-API)
- Normalização (sharp)
- Embedding (Face-API)
- Comparação (cosine similarity)
- Decisão (thresholds)

---

## 🚀 Instalação

### 1. Instalar dependências

```bash
cd leaf-websocket-backend
npm install @vladmandic/face-api canvas --legacy-peer-deps
```

### 2. Baixar modelos Face-API

Os modelos precisam ser baixados e colocados em `leaf-websocket-backend/models/face-api/`:

```bash
mkdir -p models/face-api
cd models/face-api

# Baixar modelos SSD MobileNet V1 (leve e rápido)
# Você pode usar o script abaixo ou baixar manualmente
```

**Modelos necessários:**
- `ssd_mobilenetv1_model-weights_manifest.json`
- `ssd_mobilenetv1_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`
- `face_recognition_model-weights_manifest.json`
- `face_recognition_model-shard1`

**Script para baixar modelos:**

```bash
# Criar script de download
cat > download-models.sh << 'EOF'
#!/bin/bash
BASE_URL="https://raw.githubusercontent.com/vladmandic/face-api/main/model"

# SSD MobileNet V1
curl -o ssd_mobilenetv1_model-weights_manifest.json "$BASE_URL/ssd_mobilenetv1_model-weights_manifest.json"
curl -o ssd_mobilenetv1_model-shard1 "$BASE_URL/ssd_mobilenetv1_model-shard1"

# Face Landmark 68
curl -o face_landmark_68_model-weights_manifest.json "$BASE_URL/face_landmark_68_model-weights_manifest.json"
curl -o face_landmark_68_model-shard1 "$BASE_URL/face_landmark_68_model-shard1"

# Face Recognition
curl -o face_recognition_model-weights_manifest.json "$BASE_URL/face_recognition_model-weights_manifest.json"
curl -o face_recognition_model-shard1 "$BASE_URL/face_recognition_model-shard1"

echo "✅ Modelos baixados com sucesso!"
EOF

chmod +x download-models.sh
./download-models.sh
```

### 3. Atualizar `kyc-service.js`

O código já está preparado para usar Face-API. Quando os modelos estiverem disponíveis, ele automaticamente usará Face-API em vez do embedding dummy.

---

## 📊 Comparação: Dummy vs Face-API Real

### Embedding Dummy (atual)
- ✅ Funciona imediatamente
- ✅ Sem dependências pesadas
- ❌ Não detecta faces reais
- ❌ Similaridade não é precisa
- ⚠️ Apenas para testes

### Face-API Real (recomendado)
- ✅ Detecta faces reais
- ✅ Embeddings precisos (128D ou 512D)
- ✅ Similaridade confiável
- ✅ Thresholds calibrados
- ⚠️ Requer modelos (~50MB)
- ⚠️ Mais lento (~200-300ms por imagem)

---

## 🎯 Quando usar cada um

### **Dummy (agora):**
- Desenvolvimento
- Testes de fluxo
- Validação de arquitetura

### **Face-API Real (produção):**
- Ambiente de produção
- Validação real de identidade
- Precisão importante

---

## 📝 Próximos Passos

1. ✅ Arquitetura definida (backend processa tudo)
2. ⏳ Instalar `@vladmandic/face-api` e `canvas`
3. ⏳ Baixar modelos Face-API
4. ⏳ Atualizar `generateFaceEmbedding()` para usar Face-API real
5. ⏳ Testar e calibrar thresholds com dados reais

---

## 🔗 Referências

- [@vladmandic/face-api](https://github.com/vladmandic/face-api)
- [Face-API.js Models](https://github.com/justadudewhohacks/face-api.js-models)
- [Canvas para Node.js](https://github.com/Automattic/node-canvas)

