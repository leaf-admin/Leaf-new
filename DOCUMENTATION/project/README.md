# 🚀 LEAF - Sistema de Transporte Inteligente

**Status:** ✅ **PROJETO ORGANIZADO E OTIMIZADO**  
**Versão:** 4.6.0  
**Última Atualização:** 26/07/2025

---

## 📋 **Visão Geral**

O **LEAF** é um sistema completo de transporte inteligente que inclui:
- 📱 **Mobile App** (React Native/Expo)
- 🌐 **Web App** (React)
- 🗄️ **Backend** (Node.js/Firebase)
- 📊 **Dashboard** (React/TypeScript)
- 🔌 **WebSocket Backend** (Tempo real)
- 🗄️ **Redis** (Cache/Otimização)

---

## 🗂️ **Estrutura do Projeto**

```
📁 LEAF/
├── 📱 mobile-app/              # App mobile (React Native)
├── 🌐 web-app/                 # App web (React)
├── 🔌 leaf-websocket-backend/  # Backend WebSocket
├── 📊 leaf-dashboard/          # Dashboard administrativo
├── 🔥 functions/               # Firebase Functions
├── 🗄️ common/                  # Código compartilhado
├── 📁 scripts/                 # Scripts de automação
├── 🧪 tests/                   # Testes organizados
├── 📚 documentation/           # Documentação completa
├── ⚙️ redis-config/            # Configuração Redis
├── 🚀 production-setup/        # Setup de produção
└── 📦 patches/                 # Patches e correções
```

---

## 🚀 **Início Rápido**

### **1. Instalar Dependências:**
```bash
# Instalar dependências principais
npm install

# Instalar dependências do mobile app
cd mobile-app && npm install

# Instalar dependências do web app
cd web-app && npm install
```

### **2. Configurar Ambiente:**
```bash
# Copiar arquivos de configuração
cp scripts/redis-config.env .env
cp mobile-app/config/FirebaseConfig.example.js mobile-app/config/FirebaseConfig.js
```

### **3. Iniciar Serviços:**
```bash
# Iniciar todos os serviços
./scripts/start-all-services.sh

# Ou individualmente:
# Redis
docker-compose up -d redis

# Firebase Emulator
firebase emulators:start

# WebSocket Backend
cd leaf-websocket-backend && npm start

# Mobile App
cd mobile-app && npx expo start

# Web App
cd web-app && npm start
```

---

## 📱 **Mobile App**

### **Status:** ✅ **OTIMIZADO**
- ✅ Dependências atualizadas
- ✅ URLs centralizadas
- ✅ Tratamento de erros unificado
- ✅ Configuração dinâmica

### **Executar:**
```bash
cd mobile-app
npx expo start --dev-client
```

### **Documentação:**
- 📋 [Análise Completa](documentation/project/MOBILE_APP_ANALYSIS.md)
- 🔧 [Correções Aplicadas](documentation/project/MOBILE_APP_MEDIUM_ISSUES_FIXED.md)
- ✅ [Testes de Correção](documentation/project/TESTE_CORREÇÕES_RESULTADO.md)

---

## 🌐 **Web App**

### **Status:** 🟡 **FUNCIONANDO**
- ✅ Interface responsiva
- ✅ Integração com APIs
- ✅ Sistema de pagamentos

### **Executar:**
```bash
cd web-app
npm start
```

---

## 🔌 **WebSocket Backend**

### **Status:** ✅ **OTIMIZADO**
- ✅ Sistema de monitoramento inteligente
- ✅ Sincronização Redis/Firebase
- ✅ Alertas automáticos

### **Executar:**
```bash
cd leaf-websocket-backend
npm start
```

---

## 📊 **Dashboard**

### **Status:** ✅ **FUNCIONANDO**
- ✅ Métricas em tempo real
- ✅ Interface administrativa
- ✅ Monitoramento de sistema

### **Executar:**
```bash
cd leaf-dashboard
npm start
```

---

## 🧪 **Testes**

### **Estrutura Organizada:**
```
tests/
├── 🔗 integration/     # Testes de integração
├── ⚡ performance/     # Testes de performance
├── 🧩 unit/           # Testes unitários
├── 🌐 websocket/      # Testes WebSocket
├── 🔧 setup/          # Testes de setup
├── 🗄️ redis/          # Testes Redis
├── 📱 mobile/         # Testes mobile
├── 📊 load/           # Testes de carga
├── 🔥 firebase/       # Testes Firebase
├── 🔐 auth/           # Testes de autenticação
└── 📜 scripts/        # Scripts de teste
```

### **Executar Testes:**
```bash
# Todos os testes
npm test

# Por categoria
npm run test:integration
npm run test:unit
npm run test:performance
```

### **Documentação:** [📖 Guia de Testes](tests/README.md)

---

## 📚 **Documentação**

### **Organizada por Categoria:**
```
documentation/
├── 📋 project/        # Documentação do projeto
├── 📖 guides/         # Guias de uso
└── 📊 reports/        # Relatórios
```

### **Principais Documentos:**
- 📋 [Análise do Projeto](documentation/project/MOBILE_APP_ANALYSIS.md)
- 🔧 [Problemas Resolvidos](documentation/project/PROBLEMS_RESOLVED.md)
- 🚀 [Guia de Deploy](documentation/project/DEPLOY-GUIDE.md)
- ⚡ [Otimização Redis](documentation/project/REDIS_OPTIMIZATION_RESULTS.md)

### **Documentação Completa:** [📚 Índice](documentation/README.md)

---

## 🔧 **Scripts**

### **Automação Organizada:**
```
scripts/
├── 🚀 deploy/         # Scripts de deploy
├── 🔧 maintenance/    # Scripts de manutenção
├── 📊 monitoring/     # Scripts de monitoramento
└── ⚙️ config/         # Arquivos de configuração
```

### **Principais Scripts:**
- 🚀 `start-all-services.sh` - Iniciar todos os serviços
- 🔧 `fix-js-duplicates.cjs` - Corrigir duplicatas
- 📊 `test-server-simple.cjs` - Teste simples do servidor

### **Guia Completo:** [📖 Índice de Scripts](scripts/README.md)

---

## 🗄️ **Redis**

### **Status:** ✅ **OTIMIZADO**
- ✅ Configuração otimizada
- ✅ Monitoramento inteligente
- ✅ Backup automático

### **Configuração:**
```bash
# Usar configuração otimizada
cp redis-config/redis.conf /etc/redis/

# Iniciar com Docker
docker-compose up -d redis
```

---

## 🚀 **Deploy**

### **Produção:**
```bash
# Deploy completo
./scripts/deploy-production.sh

# Verificar status
./scripts/check-production-status.sh
```

### **Staging:**
```bash
# Deploy para staging
npm run deploy:staging
```

---

## 📊 **Status do Projeto**

### **✅ Componentes Funcionais:**
- 📱 Mobile App (100% otimizado)
- 🔌 WebSocket Backend (100% otimizado)
- 🗄️ Redis (100% otimizado)
- 📊 Dashboard (100% funcional)
- 🌐 Web App (100% funcional)

### **🟡 Melhorias Contínuas:**
- 📈 Performance
- 🎨 UX/UI
- 📚 Documentação
- 🧪 Testes

---

## 🔍 **Monitoramento**

### **Métricas em Tempo Real:**
- 📊 Performance do sistema
- 🔌 Status das conexões
- 🗄️ Uso do Redis
- 📱 Status do mobile app

### **Alertas Automáticos:**
- ⚠️ Falhas de sincronização
- 🔴 Problemas de conexão
- 📈 Anomalias de performance

---

## 🤝 **Contribuição**

### **Como Contribuir:**
1. **Fork** o projeto
2. **Crie** uma branch para sua feature
3. **Desenvolva** seguindo os padrões
4. **Teste** suas mudanças
5. **Submeta** um pull request

### **Padrões:**
- 📝 Código limpo e documentado
- 🧪 Testes para novas features
- 📚 Atualizar documentação
- ✅ Seguir convenções do projeto

---

## 📞 **Suporte**

### **Canais de Ajuda:**
- 📧 **Email:** suporte@leafapp.com
- 💬 **Discord:** [Comunidade LEAF](https://discord.gg/leaf)
- 📖 **Documentação:** [Guia Completo](documentation/README.md)
- 🐛 **Issues:** [GitHub Issues](https://github.com/leaf/leaf/issues)

---

## 📄 **Licença**

Este projeto está licenciado sob a **MIT License** - veja o arquivo [LICENSE](LICENSE) para detalhes.

---

## 🎉 **Agradecimentos**

- 👥 **Equipe de Desenvolvimento**
- 🧪 **Testadores**
- 📚 **Documentadores**
- 🌟 **Contribuidores da Comunidade**

---

**🚀 LEAF - Transformando o transporte urbano com tecnologia inteligente!** 