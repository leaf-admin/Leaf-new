# 🛠️ SCRIPTS LEAF APP

## 📅 Atualizado: 16 de maio de 2026
## 🎯 Status: workspaces ativos documentados

---

## 📁 **ESTRUTURA DOS SCRIPTS**

```
scripts/
├── start-all-services.sh             # Sobe backend, dashboard novo e mobile
├── start-all-services.bat            # Variante Windows dos workspaces ativos
├── stop-all-services.sh              # Para processos locais comuns
├── security/                         # Guardrails e scanner de secrets
├── cache/                            # Smokes locais de cache
├── toggle/                           # Smokes locais de flags/toggles
└── README.md                         # Este arquivo
```

## Workspaces ativos

- `leaf-websocket-backend`
- `leaf-dashboard-js`
- `mobile-app`

Use os scripts do `package.json` raiz sempre que possivel:

```bash
npm run dev:backend
npm run dev:dashboard
npm run dev:mobile
npm run test:all
```

---

## 🎯 **EXECUÇÃO RÁPIDA**

### **🧪 Todos os Testes**
```bash
npm run test:all
```

### **🔧 Desenvolvimento local**
```bash
./scripts/maintenance/start-all-services.sh
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

1. Manter deploy/ops em `leaf-websocket-backend/scripts/`.
2. Manter automacoes de produto dentro dos workspaces ativos.
3. Remover novos scripts temporarios assim que virarem obsoletos ou forem substituidos por package scripts.

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
