# 🏗️ ARQUITETURA DE PROCESSAMENTO KYC

## 📍 O QUE É "PROCESSAMENTO LOCAL"?

**"Processamento Local"** = Processamento no **servidor principal** (backend), NÃO no app mobile.

### 🎯 Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────┐
│                    APP MOBILE (Cliente)                     │
│  - Faz upload da CNH → Firebase Storage                     │
│  - Tira foto atual → Envia para servidor                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ HTTP/WebSocket
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              SERVIDOR PRINCIPAL (Backend)                   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │     IntegratedKYCService                             │  │
│  │                                                       │  │
│  │  1. Verifica cache (Redis)                           │  │
│  │  2. Decide: VPS ou Local?                           │  │
│  └───────────────┬─────────────────────────────────────┘  │
│                  │                                         │
│      ┌───────────┴───────────┐                            │
│      │                       │                            │
│      ▼                       ▼                            │
│  ┌──────────┐        ┌──────────────┐                    │
│  │   VPS    │        │   LOCAL      │                    │
│  │ Dedicada │        │ (Servidor)   │                    │
│  │          │        │              │                    │
│  │ 147.93.  │        │ KYCFaceWorker│                    │
│  │ 66.253   │        │ (workers)   │                    │
│  └──────────┘        └──────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 FLUXOS DE PROCESSAMENTO

### **Fluxo 1: VPS Dedicada (Preferencial)**

```
1. App envia foto atual → Servidor Principal
2. Servidor busca CNH do Firebase Storage
3. Servidor envia CNH + foto atual → VPS (147.93.66.253:3002)
4. VPS processa face recognition
5. VPS retorna resultado → Servidor Principal
6. Servidor salva no cache (Redis)
7. Servidor retorna resultado → App
```

**Vantagens:**
- ✅ Processamento isolado (não sobrecarrega servidor principal)
- ✅ Escalável (pode ter múltiplas VPS)
- ✅ Recursos dedicados (CPU/RAM para processamento pesado)

### **Fluxo 2: Processamento Local (Fallback)**

```
1. App envia foto atual → Servidor Principal
2. Servidor busca encoding da CNH no Redis (já processado antes)
3. Servidor processa comparação LOCALMENTE usando KYCFaceWorker
4. Servidor salva resultado no cache (Redis)
5. Servidor retorna resultado → App
```

**Quando é usado:**
- ⚠️ VPS indisponível (offline, erro de conexão)
- ⚠️ CNH não encontrada no Firebase Storage
- ⚠️ VPS retornou erro
- ⚠️ `KYC_USE_VPS=false` (configuração manual)

**Onde acontece:**
- **Servidor Principal** (mesmo servidor que roda `server.js`)
- Usa `KYCFaceWorker` (workers com `worker_threads`)
- Processa no servidor, NÃO no app mobile

## 📦 COMPONENTES

### **1. VPS Dedicada (147.93.66.253:3002)**
- **Localização:** Servidor separado (VPS dedicada)
- **Função:** Processar face recognition pesado
- **Recursos:** 2 vCPU, 8GB RAM (dedicados)
- **Status:** ✅ Configurada e rodando

### **2. Processamento Local (Servidor Principal)**
- **Localização:** Mesmo servidor que roda o backend (`server.js`)
- **Função:** Fallback quando VPS não disponível
- **Componente:** `KYCFaceWorker` (usa `worker_threads`)
- **Recursos:** Compartilhados com o servidor principal

### **3. App Mobile**
- **Localização:** Dispositivo do usuário
- **Função:** 
  - Upload de CNH → Firebase Storage
  - Tirar foto atual → Enviar para servidor
  - Receber resultado
- **NÃO processa face recognition** (apenas envia/recebe dados)

## 🔍 DETALHES TÉCNICOS

### **Processamento Local (KYCFaceWorker)**

```javascript
// leaf-websocket-backend/services/KYCFaceWorker.js
class KYCFaceWorker {
  // Usa worker_threads do Node.js
  // Processa no servidor principal
  // Simula face recognition (ou usa opencv4nodejs se instalado)
}
```

**Onde roda:**
- Mesmo processo do `server.js`
- Workers separados (threads) para não bloquear servidor
- Usa CPU/RAM do servidor principal

**Limitações:**
- Compartilha recursos com servidor principal
- Pode impactar performance do servidor
- Não é ideal para processamento pesado

### **VPS Dedicada**

```javascript
// leaf-websocket-backend/services/kyc-vps-client.js
class KYCVPSClient {
  // Envia requisição HTTP para VPS
  // VPS processa isoladamente
  // Retorna resultado
}
```

**Onde roda:**
- Servidor separado (147.93.66.253)
- Recursos dedicados
- Não impacta servidor principal

## 🎯 RESUMO

| Aspecto | VPS Dedicada | Processamento Local |
|---------|--------------|---------------------|
| **Localização** | Servidor separado | Servidor principal |
| **Recursos** | Dedicados | Compartilhados |
| **Performance** | Melhor | Limitada |
| **Escalabilidade** | Alta | Baixa |
| **Quando usar** | Sempre que possível | Fallback apenas |
| **Impacto no servidor** | Nenhum | Pode impactar |

## ❓ PERGUNTAS FREQUENTES

### **O app mobile processa face recognition?**
❌ **NÃO**. O app apenas:
- Faz upload de imagens
- Envia/recebe dados
- Não processa face recognition

### **Onde acontece o processamento?**
✅ **No servidor** (VPS ou servidor principal), nunca no app.

### **Por que "local"?**
Porque acontece "localmente" no servidor principal (não em servidor dedicado).

### **Qual é melhor?**
✅ **VPS Dedicada** - Sempre preferível quando disponível.

### **Quando usar processamento local?**
Apenas como **fallback** quando VPS não está disponível.

## 🔧 CONFIGURAÇÃO

```env
# Usar VPS (recomendado)
KYC_USE_VPS=true
KYC_VPS_URL=http://147.93.66.253:3002
KYC_VPS_API_KEY=sua-chave

# Se VPS não disponível, usa processamento local automaticamente
```

## 📊 FLUXO DECISÓRIO

```
App envia foto
    ↓
Servidor recebe
    ↓
Verifica cache? → Sim → Retorna cache
    ↓ Não
VPS disponível? → Sim → Processa na VPS
    ↓ Não
Processa localmente (fallback)
    ↓
Salva no cache
    ↓
Retorna resultado
```

---

**Conclusão:** "Processamento local" = processamento no servidor principal (backend), não no app mobile. É usado apenas como fallback quando a VPS não está disponível.



