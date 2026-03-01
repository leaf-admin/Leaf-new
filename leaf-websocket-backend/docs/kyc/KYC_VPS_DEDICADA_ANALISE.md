# 🖥️ Análise: VPS Dedicada para KYC (Hostinger)

## 📊 Especificações da VPS Dedicada

- **vCPUs**: 2 núcleos
- **RAM**: 8GB
- **Storage**: 100GB NVMe SSD
- **Bandwidth**: 8TB/mês
- **Custo**: A verificar (Hostinger)

---

## ✅ ANÁLISE DE ADEQUAÇÃO

### **1. Memória (RAM) - 8GB**

#### **Uso Esperado:**
- **Node.js base**: ~200-300MB
- **Redis**: ~200MB
- **Cada worker KYC**: ~500-800MB (com dependências pesadas)
- **2 workers simultâneos**: ~1-1.6GB
- **Sistema operacional**: ~500MB
- **Buffer/overhead**: ~1GB

#### **Total Estimado**: ~2.5-3.5GB

**Veredito**: ✅ **SUFICIENTE** - Sobra ~4.5-5.5GB de margem

### **2. CPU - 2 vCPUs**

#### **Processamento KYC:**
- **1 verificação**: 2-5 segundos
- **2 workers simultâneos**: 2 verificações ao mesmo tempo
- **Taxa de processamento**: ~12-30 verificações/minuto
- **Capacidade diária**: ~17.000-43.000 verificações/dia (teórico)
- **Capacidade realista**: ~500-1.000 verificações/dia (com margem de segurança)

**Veredito**: ✅ **SUFICIENTE** para até 1.000 verificações/dia

### **3. Storage - 100GB NVMe**

#### **Uso Esperado:**
- **Sistema operacional**: ~10GB
- **Node.js + dependências**: ~2GB
- **Dependências KYC pesadas**: ~500MB
- **Modelos ML**: ~10MB
- **Redis (dados temporários)**: ~1-5GB
- **Logs**: ~1-2GB
- **Buffer**: ~10GB

#### **Total Estimado**: ~15-20GB

**Veredito**: ✅ **MUITO SUFICIENTE** - Sobra ~80GB

### **4. Bandwidth - 8TB/mês**

#### **Uso Esperado:**
- **Upload de imagem CNH**: ~500KB-2MB por verificação
- **Upload foto câmera**: ~500KB-2MB por verificação
- **Respostas JSON**: ~10-50KB por requisição
- **Total por verificação**: ~1-4MB

#### **Capacidade:**
- **8TB = 8.000GB = 8.000.000MB**
- **Capacidade**: ~2.000.000-8.000.000 verificações/mês
- **Capacidade diária**: ~66.000-266.000 verificações/dia

**Veredito**: ✅ **MUITO SUFICIENTE** - Não será limitante

---

## 🎯 CAPACIDADE ESTIMADA

### **Cenário Conservador (com margem de segurança)**
- **Verificações simultâneas**: 2
- **Verificações/minuto**: 12-20
- **Verificações/hora**: 720-1.200
- **Verificações/dia**: ~500-1.000 (com picos)
- **Verificações/mês**: ~15.000-30.000

### **Cenário Otimizado (máximo uso)**
- **Verificações simultâneas**: 2-3
- **Verificações/minuto**: 20-30
- **Verificações/hora**: 1.200-1.800
- **Verificações/dia**: ~1.000-2.000
- **Verificações/mês**: ~30.000-60.000

---

## 💰 ANÁLISE DE CUSTO-BENEFÍCIO

### **Comparação de Opções:**

| Opção | Custo Mensal | Capacidade | Performance | Isolamento |
|-------|-------------|------------|-------------|------------|
| **VPS Dedicada KYC** | ~$20-40 | 500-1.000/dia | Boa (2-5s) | ✅ Total |
| **Upgrade VPS Atual** | +$20-40 | 500-1.000/dia | Boa (2-5s) | ❌ Compartilhado |
| **API Externa** | $0.50-2/verif | Ilimitada | Excelente | ✅ Total |
| **Simulação (atual)** | $0 | Ilimitada | Instantânea | ❌ Compartilhado |

### **Cálculo de Custo por Verificação:**

**VPS Dedicada:**
- Custo: $30/mês (estimativa)
- Capacidade: 15.000 verificações/mês
- **Custo por verificação**: ~$0.002 (0.2 centavos)

**API Externa (Sumsub/Veriff):**
- Custo: $0.50-2.00 por verificação
- **Custo por verificação**: $0.50-2.00

**Conclusão**: VPS dedicada é **MUITO mais barata** se tiver volume (>15 verificações/mês)

---

## ✅ VANTAGENS DA VPS DEDICADA

1. **Isolamento Total** ✅
   - Não afeta servidor principal
   - Pode travar sem impactar outros serviços
   - Reiniciar sem afetar WebSocket

2. **Performance Dedicada** ✅
   - CPU e RAM 100% para KYC
   - Sem competição com outros serviços
   - Processamento mais rápido

3. **Escalabilidade** ✅
   - Pode aumentar workers conforme necessário
   - Fácil de monitorar e otimizar
   - Pode adicionar mais recursos depois

4. **Segurança** ✅
   - Isolamento de dados sensíveis (fotos, encodings)
   - Pode ter firewall específico
   - Backups independentes

5. **Custo-Benefício** ✅
   - Muito mais barato que API externa
   - Custo fixo (não varia com volume)
   - ROI positivo com >15 verificações/mês

---

## ⚠️ DESVANTAGENS

1. **Manutenção** ⚠️
   - Precisa gerenciar servidor adicional
   - Atualizações de segurança
   - Monitoramento separado

2. **Dependências Pesadas** ⚠️
   - Precisa instalar opencv4nodejs, face-api.js, canvas
   - Compilação pode demorar
   - Pode ter problemas de compatibilidade

3. **Escalabilidade Limitada** ⚠️
   - 2 vCPUs = máximo 2-3 workers simultâneos
   - Para >1.000 verificações/dia, pode precisar upgrade

---

## 🎯 RECOMENDAÇÃO

### **✅ RECOMENDO FORTEMENTE VPS DEDICADA SE:**

1. ✅ **Volume esperado**: >50 verificações/mês
2. ✅ **Precisão real necessária**: Não pode usar simulação
3. ✅ **Isolamento importante**: Não quer afetar servidor principal
4. ✅ **Custo-benefício**: Quer economizar vs API externa

### **⚠️ NÃO RECOMENDO SE:**

1. ❌ **Volume muito baixo**: <50 verificações/mês (API externa mais barata)
2. ❌ **Orçamento limitado**: Não pode pagar VPS adicional
3. ❌ **Simulação suficiente**: Para MVP/testes

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

Se decidir usar VPS dedicada:

- [ ] **Setup Inicial**
  - [ ] Instalar Node.js 22
  - [ ] Instalar Redis
  - [ ] Instalar dependências do sistema (OpenCV, Cairo, etc.)
  - [ ] Clonar código do KYC

- [ ] **Dependências Pesadas**
  - [ ] Instalar `opencv4nodejs` (pode demorar 10-30min)
  - [ ] Instalar `face-api.js`
  - [ ] Instalar `canvas`
  - [ ] Baixar modelos ML do face-api.js

- [ ] **Configuração**
  - [ ] Configurar variáveis de ambiente
  - [ ] Configurar Redis
  - [ ] Configurar workers (2 workers)
  - [ ] Configurar firewall

- [ ] **Integração**
  - [ ] Configurar comunicação com servidor principal
  - [ ] API endpoint para chamadas do servidor principal
  - [ ] Webhook/notificações

- [ ] **Monitoramento**
  - [ ] Logs estruturados
  - [ ] Métricas de performance
  - [ ] Alertas de erro

---

## 🚀 PRÓXIMOS PASSOS

1. **Decidir**: VPS dedicada ou continuar com simulação?
2. **Se VPS dedicada**: Criar script de setup automatizado
3. **Implementar**: Liveness detection e integração com status
4. **Testar**: Fluxo completo antes de produção

---

## 💡 CONCLUSÃO

**VPS Dedicada (2 vCPU, 8GB RAM) é PERFEITA para KYC!**

✅ **Adequada para:**
- Até 1.000 verificações/dia
- Processamento real (não simulação)
- Isolamento total
- Custo-benefício excelente

✅ **Recomendação**: **SIM, use VPS dedicada!**

**Próximo passo**: Quer que eu crie um script de setup automatizado para a VPS dedicada?




