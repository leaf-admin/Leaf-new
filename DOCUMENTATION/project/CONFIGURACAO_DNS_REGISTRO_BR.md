# 🔗 CONFIGURAÇÃO DNS NO REGISTRO.BR

**Data:** 29 de Julho de 2025  
**Status:** Configuração DNS  
**Provedor:** registro.br  
**VPS:** Vultr (216.238.107.59)  

---

## 📋 **INFORMAÇÕES NECESSÁRIAS**

### **1. 🔐 Dados de Acesso**
- [ ] Login do registro.br
- [ ] Senha do registro.br
- [ ] Domínios: www.leaf.app.br e voudeleaf.com.br

### **2. 🎯 Escolha do Domínio Principal**
Qual domínio você quer usar como principal?
- [ ] **www.leaf.app.br** (Recomendado - mais curto)
- [ ] **voudeleaf.com.br** (Alternativo)

### **3. 🏗️ Estrutura de Subdomínios**
Como quer organizar?
```bash
# Opção A: Estrutura completa
A: www.leaf.app.br -> 216.238.107.59 (Website)
A: api.leaf.app.br -> 216.238.107.59 (API)
A: socket.leaf.app.br -> 216.238.107.59 (WebSocket)

# Opção B: Estrutura simples
A: www.leaf.app.br -> 216.238.107.59 (Website)
A: api.leaf.app.br -> 216.238.107.59 (API)
```

---

## 🛠️ **PASSOS PARA CONFIGURAR**

### **Passo 1: Acessar Painel**
1. Acesse: https://www.registro.br
2. Faça login com suas credenciais
3. Vá em "Gerenciar Domínios"

### **Passo 2: Selecionar Domínio**
1. Clique no domínio que quer configurar
2. Vá em "DNS" ou "Gerenciar DNS"
3. Procure por "Registros DNS" ou "Zona DNS"

### **Passo 3: Adicionar Registros A**
```bash
# Para cada subdomínio, adicionar:
Tipo: A
Nome: www (ou api, socket)
Valor: 216.238.107.59
TTL: 300 (ou padrão)

# Exemplo:
Tipo: A
Nome: api
Valor: 216.238.107.59
TTL: 300
```

### **Passo 4: Verificar Configuração**
```bash
# Testar propagação
nslookup api.leaf.app.br
nslookup socket.leaf.app.br
nslookup www.leaf.app.br
```

---

## 🎯 **CONFIGURAÇÃO RECOMENDADA**

### **Para www.leaf.app.br:**
```bash
# Registros A necessários:
A: @ -> 216.238.107.59 (domínio raiz)
A: www -> 216.238.107.59 (website)
A: api -> 216.238.107.59 (API)
A: socket -> 216.238.107.59 (WebSocket)
```

### **Para voudeleaf.com.br (backup):**
```bash
# Registros A necessários:
A: @ -> 216.238.107.59 (domínio raiz)
A: www -> 216.238.107.59 (website)
A: api -> 216.238.107.59 (API)
A: socket -> 216.238.107.59 (WebSocket)
```

---

## ⏱️ **TEMPO DE PROPAGAÇÃO**

- **Registro.br:** 5-30 minutos
- **DNS Global:** 24-48 horas
- **Teste local:** Imediato após configuração

---

## 🧪 **TESTES APÓS CONFIGURAÇÃO**

### **1. Teste de Propagação**
```bash
# No terminal
nslookup api.leaf.app.br
nslookup socket.leaf.app.br
nslookup www.leaf.app.br
```

### **2. Teste de Conectividade**
```bash
# Testar API
curl -I https://api.leaf.app.br/health

# Testar WebSocket
curl -I https://socket.leaf.app.br
```

### **3. Teste de SSL**
```bash
# Verificar certificado
openssl s_client -connect api.leaf.app.br:443
```

---

## 🚀 **PRÓXIMOS PASSOS APÓS DNS**

### **1. Configurar SSL**
```bash
# Na Vultr
ssh vultr-leaf
sudo certbot --nginx -d api.leaf.app.br -d socket.leaf.app.br -d www.leaf.app.br
```

### **2. Atualizar Apps**
```javascript
// mobile-app/src/config/ApiConfig.js
selfHostedApi: {
  web: 'https://api.leaf.app.br',
  mobile: 'https://api.leaf.app.br'
},
selfHostedWebSocket: {
  web: 'wss://socket.leaf.app.br',
  mobile: 'wss://socket.leaf.app.br'
}
```

### **3. Testes Finais**
- [ ] Testar mobile app
- [ ] Testar web app
- [ ] Testar WebSocket
- [ ] Validar SSL

---

## ❓ **PERGUNTAS PARA VOCÊ**

1. **Qual domínio principal?** www.leaf.app.br ou voudeleaf.com.br?
2. **Quer estrutura completa?** (www, api, socket) ou simples?
3. **Tem acesso ao painel?** Precisa de ajuda para acessar?
4. **Quer que eu te ajude passo a passo?** Posso guiar durante a configuração

**🎯 Vamos configurar juntos!** 