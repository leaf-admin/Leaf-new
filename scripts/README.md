# 🛠️ SCRIPTS LEAF APP

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: ✅ **ORGANIZADO**

---

## 📁 **ESTRUTURA DOS SCRIPTS**

```
scripts/
├── 🔄 toggle/                        # Scripts do toggle beta
├── 📊 cache/                         # Scripts de cache
├── 🔐 security/                      # Scripts de segurança
├── 🧪 tests/                         # Scripts de teste
├── 📊 route-cache/                   # Scripts de cache de rotas
├── 🔧 server/                        # Scripts de servidor
└── 📋 README.md                      # Este arquivo
```

---

## 🔄 **TOGGLE BETA**

### **Scripts Disponíveis**
- `test-toggle-beta.cjs` - Teste automatizado do toggle
- `test-toggle-local.cjs` - Teste local do toggle

### **Uso**
```bash
cd scripts/toggle/
node test-toggle-beta.cjs
node test-toggle-local.cjs
```

---

## 📊 **CACHE**

### **Scripts Disponíveis**
- `test-cache-local.cjs` - Teste do cache local

### **Uso**
```bash
cd scripts/cache/
node test-cache-local.cjs
```

---

## 🔐 **SEGURANÇA**

### **Scripts Disponíveis**
- `check-dns.sh` - Verificação de DNS

### **Uso**
```bash
cd scripts/security/
chmod +x check-dns.sh
./check-dns.sh
```

---

## 🧪 **TESTES**

### **Scripts Disponíveis**
- `test-load-new-structure.cjs` - Teste de carga
- `test-ride-end-to-end.cjs` - Teste de corrida
- `test-ride-end-to-end-correct.cjs` - Teste corrigido
- `test-integracao-mobile-backend.cjs` - Teste de integração
- `test-vps-differences.cjs` - Teste de diferenças VPS

### **Uso**
```bash
cd scripts/tests/
node test-load-new-structure.cjs
node test-ride-end-to-end-correct.cjs
node test-integracao-mobile-backend.cjs
```

---

## 📊 **ROUTE CACHE**

### **Scripts Disponíveis**
- `test-route-cache.cjs` - Teste do cache de rotas

### **Uso**
```bash
cd scripts/route-cache/
node test-route-cache.cjs
```

---

## 🔧 **SERVIDOR**

### **Scripts Disponíveis**
- `dashboard-server.js` - Servidor do dashboard
- `test-server.js` - Servidor de teste
- `test-dashboard-fix.cjs` - Correção do dashboard
- `leaf-dashboard.service` - Serviço systemd
- `dashboard-nginx.conf` - Configuração Nginx
- `dashboard-nginx-temp.conf` - Configuração temporária

### **Uso**
```bash
cd scripts/server/
node dashboard-server.js
node test-server.js
```

---

## 🎯 **EXECUÇÃO RÁPIDA**

### **🧪 Todos os Testes**
```bash
# Teste do toggle
cd scripts/toggle/ && node test-toggle-local.cjs

# Teste de cache
cd scripts/cache/ && node test-cache-local.cjs

# Teste de integração
cd scripts/tests/ && node test-integracao-mobile-backend.cjs

# Teste de carga
cd scripts/tests/ && node test-load-new-structure.cjs
```

### **🔧 Servidor**
```bash
# Iniciar servidor
cd scripts/server/ && node dashboard-server.js

# Verificar configuração
cd scripts/server/ && nginx -t
```

### **🔐 Segurança**
```bash
# Verificar DNS
cd scripts/security/ && ./check-dns.sh
```

---

## 📋 **CONVENÇÕES**

### **📝 Nomenclatura**
- Scripts em JavaScript: `.cjs` ou `.js`
- Scripts em Shell: `.sh`
- Nomes descritivos
- Prefixo `test-` para testes

### **🎯 Organização**
- Agrupamento por funcionalidade
- Dependências documentadas
- Instruções de uso claras

### **🔧 Execução**
- Verificar dependências antes de executar
- Usar Node.js para scripts `.cjs`
- Usar bash para scripts `.sh`

---

## 🚀 **PRÓXIMOS PASSOS**

1. **🧪 Executar testes** por categoria
2. **📊 Analisar resultados** dos testes
3. **🔧 Corrigir problemas** encontrados
4. **📈 Otimizar performance** dos scripts

---

## 📞 **TROUBLESHOOTING**

### **❌ Erro de Dependência**
```bash
npm install
# ou
yarn install
```

### **❌ Erro de Permissão**
```bash
chmod +x script.sh
```

### **❌ Erro de Node.js**
```bash
node --version
# Verificar versão do Node.js
```

---

## 📊 **MÉTRICAS**

### **⏱️ Performance**
- Tempo de execução dos testes
- Uso de memória
- Taxa de sucesso

### **📈 Qualidade**
- Cobertura de testes
- Detecção de bugs
- Validação de funcionalidades 