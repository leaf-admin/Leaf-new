# 📁 SCRIPTS - Índice de Arquivos

**Pasta:** `/scripts`  
**Descrição:** Scripts de automação, configuração e utilitários do projeto

---

## 🚀 **Scripts de Deploy e Produção**

### **Deploy**
- `deploy-production.bat` - Script de deploy para produção (Windows)
- `deploy-production.ps1` - Script de deploy para produção (PowerShell)
- `check-production-status.bat` - Verificar status da produção

### **Serviços**
- `start-all-services.sh` - Iniciar todos os serviços do projeto
- `start-all-services.bat` - Iniciar todos os serviços (Windows)
- `stop-all-services.sh` - Parar todos os serviços

---

## 🔧 **Scripts de Correção e Manutenção**

### **Correção de Duplicatas**
- `fix-js-duplicates.cjs` - Corrigir arquivos JavaScript duplicados
- `fix-duplicates.ps1` - Corrigir duplicatas (PowerShell)
- `fix-all-duplicates.ps1` - Corrigir todas as duplicatas

---

## 📊 **Scripts de Teste e Monitoramento**

### **Testes Simples**
- `test-server-simple.cjs` - Teste simples do servidor
- `test-metrics-simple.cjs` - Teste simples de métricas

---

## ⚙️ **Arquivos de Configuração**

### **Docker**
- `docker-compose.yml` - Configuração do Docker Compose

### **Redis**
- `redis-config.env` - Variáveis de ambiente do Redis
- `redis-checkpoint-before-optimization.json` - Checkpoint do Redis antes da otimização

---

## 📋 **Como Usar**

### **Executar Scripts:**
```bash
# Linux/Mac
./scripts/start-all-services.sh

# Windows
scripts\start-all-services.bat

# PowerShell
.\scripts\deploy-production.ps1
```

### **Corrigir Duplicatas:**
```bash
# Node.js
node scripts/fix-js-duplicates.cjs

# PowerShell
.\scripts\fix-all-duplicates.ps1
```

### **Testes:**
```bash
# Teste simples
node scripts/test-server-simple.cjs
node scripts/test-metrics-simple.cjs
```

---

## 🔍 **Estrutura da Pasta**

```
scripts/
├── README.md                           # Este arquivo
├── deploy-production.bat               # Deploy produção (Windows)
├── deploy-production.ps1               # Deploy produção (PowerShell)
├── check-production-status.bat         # Status produção
├── start-all-services.sh               # Iniciar serviços
├── start-all-services.bat              # Iniciar serviços (Windows)
├── stop-all-services.sh                # Parar serviços
├── fix-js-duplicates.cjs               # Corrigir duplicatas JS
├── fix-duplicates.ps1                  # Corrigir duplicatas
├── fix-all-duplicates.ps1              # Corrigir todas duplicatas
├── test-server-simple.cjs              # Teste servidor
├── test-metrics-simple.cjs             # Teste métricas
├── docker-compose.yml                  # Config Docker
├── redis-config.env                    # Config Redis
└── redis-checkpoint-before-optimization.json # Checkpoint Redis
```

---

## ⚠️ **Observações**

- **Scripts .bat:** Para Windows
- **Scripts .sh:** Para Linux/Mac
- **Scripts .ps1:** Para PowerShell
- **Scripts .cjs:** Para Node.js

### **Permissões (Linux/Mac):**
```bash
chmod +x scripts/*.sh
```

### **Dependências:**
- Node.js para scripts .cjs
- PowerShell para scripts .ps1
- Docker para docker-compose.yml 