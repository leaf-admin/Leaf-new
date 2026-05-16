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
├── services/                         # Scripts legados de operacao
├── deployment/                       # Scripts legados de deploy
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

1. Consolidar scripts de deploy em torno de `leaf-websocket-backend/scripts/deploy-hostinger-docker.sh`.
2. Arquivar ou remover scripts antigos que ainda mencionem stacks removidas.
3. Migrar qualquer automacao util para scripts raiz ou workspaces ativos.

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
