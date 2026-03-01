# 📋 KYC - Fluxo Completo e Análise de Infraestrutura

## 🎯 FLUXO ESPERADO DO KYC

### **Etapa 1: Upload da Foto da CNH**
- Motorista faz upload da foto da CNH (frente e verso)
- Sistema extrai dados via OCR (já implementado em `ocr-service.js`)
- Sistema extrai a foto do rosto da CNH
- Salva encoding facial da foto da CNH no Redis

### **Etapa 2: Verificação Facial (Câmera vs CNH)**
- Motorista tira foto com a câmera do celular
- Sistema compara foto da câmera com foto da CNH
- **Se similaridade >= 85% (threshold)**: ✅ Passa para próxima etapa
- **Se similaridade < 85%**: ❌ Bloqueia (pode ser outra pessoa)

### **Etapa 3: Verificação de Ação (Liveness Detection)**
- Sistema solicita ação: "Sorria", "Piscar os olhos", "Virar cabeça", etc.
- Motorista executa a ação na câmera
- Sistema verifica se a ação foi executada corretamente
- **Se ação correta**: ✅ Motorista fica ONLINE
- **Se ação incorreta ou não detectada**: ❌ Motorista NÃO fica online

### **Etapa 4: Status Final**
- ✅ **Aprovado**: Motorista pode ficar online e receber corridas
- ❌ **Reprovado**: Motorista bloqueado, não pode ficar online
- ⚠️ **Pendente**: Aguardando verificação manual (em caso de dúvida)

---

## 📦 DEPENDÊNCIAS PESADAS

### **1. opencv4nodejs**
- **O que é**: Binding Node.js para OpenCV (biblioteca de visão computacional)
- **Tamanho**: ~200-300 MB (com dependências nativas)
- **Uso**: Processamento de imagens, detecção de faces, pré-processamento
- **Requisitos**:
  - OpenCV instalado no sistema (C++)
  - Compiladores C++ (gcc, g++)
  - ~500MB de espaço em disco
  - **CPU**: Intensivo (processamento de imagens)
  - **RAM**: ~200-500MB por worker

### **2. face-api.js**
- **O que é**: Biblioteca JavaScript para reconhecimento facial
- **Tamanho**: ~50-100 MB (com modelos)
- **Uso**: Detecção de faces, landmarks (68 pontos), encoding facial
- **Modelos necessários**:
  - `ssd_mobilenetv1_model-weights_manifest.json` (~4MB)
  - `face_landmark_68_model-weights_manifest.json` (~1MB)
  - `face_recognition_model-weights_manifest.json` (~1MB)
- **Requisitos**:
  - **CPU**: Muito intensivo (inferência de modelos ML)
  - **RAM**: ~300-600MB por worker (modelos carregados)
  - **Tempo de processamento**: 2-5 segundos por imagem

### **3. canvas (node-canvas)**
- **O que é**: Implementação Canvas API para Node.js
- **Tamanho**: ~50-100 MB (com dependências nativas)
- **Uso**: Renderização de imagens, processamento de pixels
- **Requisitos**:
  - Cairo, Pango, librsvg (bibliotecas do sistema)
  - **CPU**: Moderado
  - **RAM**: ~50-100MB por worker

### **4. sharp** (já instalado)
- **O que é**: Processamento de imagens de alta performance
- **Tamanho**: ~20-30 MB
- **Uso**: Redimensionamento, compressão, conversão de formatos
- **Requisitos**: Leve, já está funcionando

---

## 💻 IMPACTO NA VPS

### **VPS Atual (conforme logs)**
- **vCPUs**: 4
- **RAM**: 8GB
- **Storage**: 160GB SSD
- **Sistema**: Ubuntu 22.04

### **Cenário 1: KYC com Dependências Pesadas (opencv4nodejs + face-api.js)**

#### **Memória (RAM)**
- **Servidor base**: ~500MB
- **Redis**: ~200MB
- **Cada worker KYC**: ~500-800MB
- **2 workers KYC**: ~1-1.6GB
- **Total estimado**: ~2-2.5GB (dentro dos 8GB disponíveis) ✅

#### **CPU**
- **Processamento de 1 imagem**: 2-5 segundos
- **Concorrência**: 2 workers = 2 processamentos simultâneos
- **Taxa de processamento**: ~12-30 verificações/minuto
- **Impacto**: Alto durante processamento, mas aceitável ✅

#### **Storage**
- **Dependências**: ~500MB
- **Modelos**: ~10MB
- **Total**: ~510MB (dentro dos 160GB) ✅

### **Cenário 2: KYC Simplificado (sem dependências pesadas)**

#### **Memória (RAM)**
- **Servidor base**: ~500MB
- **Redis**: ~200MB
- **Workers simulados**: ~50MB cada
- **Total**: ~800MB ✅

#### **CPU**
- **Processamento**: Instantâneo (simulação)
- **Impacto**: Mínimo ✅

---

## 🚀 RECOMENDAÇÕES DE INFRAESTRUTURA

### **Opção 1: Manter VPS Atual (8GB RAM, 4 vCPUs)**
✅ **Vantagens:**
- Custo menor
- Suficiente para até 50-100 verificações/dia
- Workers podem processar em fila

⚠️ **Limitações:**
- Processamento mais lento (2-5s por verificação)
- Limite de concorrência (2 workers simultâneos)
- Pode travar se muitos motoristas verificarem ao mesmo tempo

**Recomendação**: ✅ **Adequado para MVP e fase inicial**

### **Opção 2: Upgrade Moderado (16GB RAM, 8 vCPUs)**
✅ **Vantagens:**
- Pode rodar 4-6 workers simultâneos
- Processa ~50-100 verificações/minuto
- Melhor experiência do usuário

💰 **Custo**: ~2x o atual

**Recomendação**: ⚠️ **Considerar quando tiver >100 motoristas ativos**

### **Opção 3: Microserviço Dedicado**
✅ **Vantagens:**
- Isolamento (não afeta servidor principal)
- Escalável independentemente
- Pode usar GPU (muito mais rápido)

💰 **Custo**: VPS adicional (~$20-40/mês)

**Recomendação**: ✅ **Ideal para produção com muitos motoristas**

---

## 🔧 IMPLEMENTAÇÃO ATUAL

### **O que está implementado:**
1. ✅ Rotas de API (`/api/kyc/upload-profile`, `/api/kyc/verify-driver`)
2. ✅ Serviço integrado (`IntegratedKYCService`)
3. ✅ Workers para processamento paralelo
4. ✅ Retry automático
5. ✅ Analytics e métricas
6. ✅ Notificações

### **O que está faltando:**
1. ❌ **Liveness Detection** (verificação de ação - sorriso, etc.)
2. ❌ **Integração com status do motorista** (bloquear/liberar online)
3. ❌ **Fluxo completo no app mobile**
4. ❌ **Dependências pesadas instaladas** (opcional, pode usar simulação)

---

## 💡 RECOMENDAÇÃO FINAL

### **Para MVP/Fase Inicial:**
1. ✅ **Manter VPS atual** (8GB RAM é suficiente)
2. ✅ **Usar simulação** (sem dependências pesadas)
3. ✅ **Implementar liveness detection simples** (verificar ação na câmera)
4. ✅ **Integrar com status do motorista** (bloquear se KYC falhar)

### **Para Produção (quando escalar):**
1. ⚠️ **Considerar upgrade** para 16GB RAM se >100 motoristas
2. ⚠️ **Instalar dependências pesadas** apenas se precisar de precisão real
3. ✅ **Microserviço dedicado** se >500 motoristas ativos

### **Alternativa Leve (Recomendada):**
- Usar API externa de KYC (Sumsub, Veriff, etc.)
- Custo: ~$0.50-2.00 por verificação
- Vantagem: Sem impacto na VPS, mais preciso
- Desvantagem: Custo por verificação

---

## 📊 COMPARAÇÃO DE CUSTOS

| Opção | Custo Mensal | Performance | Escalabilidade |
|-------|-------------|-------------|----------------|
| VPS Atual (simulação) | $0 (já pago) | Rápida (simulação) | Limitada |
| VPS Atual (com dependências) | $0 (já pago) | Média (2-5s) | 2 workers |
| Upgrade VPS (16GB) | +$20-40 | Boa (2-5s) | 4-6 workers |
| Microserviço dedicado | +$20-40 | Boa (2-5s) | Escalável |
| API Externa (Sumsub) | $0.50-2/verificação | Excelente | Ilimitada |

---

## 🎯 PRÓXIMOS PASSOS SUGERIDOS

1. **Implementar Liveness Detection** (verificação de ação)
2. **Integrar com status do motorista** (bloquear/liberar online)
3. **Testar fluxo completo** no app mobile
4. **Decidir**: Simulação ou dependências pesadas?
5. **Monitorar performance** e escalar conforme necessário




