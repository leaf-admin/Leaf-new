# ✅ Correção de Timeout de Upload CNH

**Data:** 2026-01-08  
**Status:** ✅ Completo

---

## 🔍 Problema Identificado

O upload de CNH estava falhando com timeout de 20 segundos, bloqueando o onboarding de motoristas.

---

## 🛠️ Correções Implementadas

### 1. **Timeout do Cliente VPS** (`services/kyc-vps-client.js`)

**Antes:**
```javascript
this.timeout = 30000; // 30 segundos
```

**Depois:**
```javascript
this.timeout = parseInt(process.env.KYC_VPS_TIMEOUT) || 60000; // 60 segundos
```

**Benefício:** Upload de imagens grandes (CNH + Selfie) agora tem tempo suficiente para completar.

---

### 2. **Timeout do Servidor Express** (`server.js`)

**Adicionado:**
```javascript
// ✅ CORREÇÃO: Configurar timeout do servidor para uploads grandes (60s)
server.timeout = parseInt(process.env.SERVER_TIMEOUT) || 60000; // 60 segundos
server.keepAliveTimeout = 65000; // 65 segundos
server.headersTimeout = 66000; // 66 segundos
```

**Benefício:** Servidor não fecha conexão durante uploads longos.

---

### 3. **Limite de Body Parser** (`server.js`)

**Antes:**
```javascript
app.use(express.json({ limit: '10mb' }));
```

**Depois:**
```javascript
app.use(express.json({ limit: '50mb' })); // Aumentado de 10mb para 50mb
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Adicionado
```

**Benefício:** Suporta uploads maiores (CNH + Selfie podem ser até 20MB cada).

---

### 4. **Limite do Multer - KYC Onboarding** (`routes/kyc-onboarding.js`)

**Antes:**
```javascript
limits: {
  fileSize: 10 * 1024 * 1024 // 10MB
}
```

**Depois:**
```javascript
limits: {
  fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 10MB)
  files: 2 // CNH + Selfie
}
```

**Benefício:** Permite upload de CNH e Selfie maiores.

---

### 5. **Limite do Multer - KYC Routes** (`routes/kyc-routes.js`)

**Antes:**
```javascript
limits: {
  fileSize: 5 * 1024 * 1024, // 5MB
  files: 1
}
```

**Depois:**
```javascript
limits: {
  fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 5MB)
  files: 1
}
```

**Benefício:** Upload de perfil pode ser maior.

---

### 6. **Limite do Multer - OCR Routes** (`routes/ocr-routes.js`)

**Antes:**
```javascript
limits: {
  fileSize: 10 * 1024 * 1024, // 10MB
  files: 1
}
```

**Depois:**
```javascript
limits: {
  fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 10MB)
  files: 1
}
```

**Benefício:** Upload de CNH para OCR pode ser maior.

---

## 📊 Resumo das Mudanças

| Componente | Antes | Depois | Aumento |
|------------|-------|--------|---------|
| **VPS Client Timeout** | 30s | 60s | +100% |
| **Server Timeout** | Padrão (20s) | 60s | +200% |
| **Body Parser Limit** | 10MB | 50MB | +400% |
| **Multer - Onboarding** | 10MB | 20MB | +100% |
| **Multer - KYC Routes** | 5MB | 20MB | +300% |
| **Multer - OCR Routes** | 10MB | 20MB | +100% |

---

## 🔧 Variáveis de Ambiente

Novas variáveis de ambiente opcionais:

```bash
# Timeout do cliente VPS (padrão: 60000ms = 60s)
KYC_VPS_TIMEOUT=60000

# Timeout do servidor Express (padrão: 60000ms = 60s)
SERVER_TIMEOUT=60000
```

---

## ✅ Benefícios

1. ✅ **Upload de CNH não falha mais por timeout**
2. ✅ **Suporta imagens maiores (até 20MB cada)**
3. ✅ **Tempo suficiente para processamento na VPS**
4. ✅ **Onboarding de motoristas não bloqueado**
5. ✅ **Configurável via variáveis de ambiente**

---

## 🧪 Como Testar

1. **Upload de CNH grande (15-20MB):**
   ```bash
   curl -X POST http://localhost:3001/api/drivers/kyc/onboarding \
     -F "driverId=test_driver" \
     -F "cnh=@large_cnh.jpg" \
     -F "selfie=@large_selfie.jpg"
   ```

2. **Verificar logs:**
   - Não deve aparecer erro de timeout
   - Upload deve completar em até 60s

3. **Testar com timeout menor (para validar):**
   ```bash
   KYC_VPS_TIMEOUT=5000 node server.js
   # Deve falhar com timeout (comportamento esperado)
   ```

---

## 📝 Notas Importantes

- ⚠️ **Nginx/Proxy:** Se usar nginx ou outro proxy reverso, configure também:
  ```nginx
  proxy_read_timeout 60s;
  proxy_send_timeout 60s;
  client_max_body_size 50m;
  ```

- ⚠️ **Firebase Storage:** Verificar limites de upload do Firebase Storage (padrão: 32MB)

- ⚠️ **Memória:** Uploads maiores consomem mais memória. Monitorar uso de RAM.

---

**Última atualização:** 2026-01-08

