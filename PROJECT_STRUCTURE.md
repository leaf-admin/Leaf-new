# 🗂️ ESTRUTURA DO PROJETO LEAF

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: ✅ **ORGANIZADO**

---

## 📁 **ESTRUTURA PRINCIPAL**

```
Sourcecode/
├── 📱 mobile-app/                    # Aplicativo mobile React Native
├── 🌐 web-app/                       # Aplicativo web React
├── 🔧 functions/                     # Firebase Cloud Functions
├── 🗄️ common/                       # Código compartilhado
├── 📊 leaf-dashboard/                # Dashboard administrativo
├── 🔌 leaf-websocket-backend/        # Backend WebSocket
├── 📚 docs/                          # Documentação organizada
├── 🛠️ scripts/                      # Scripts e utilitários
├── 🧪 tests/                         # Testes automatizados
├── 📋 documentation/                  # Documentação original
├── 📋 DOCUMENTATION/                 # Documentação adicional
├── 🔐 redis-config/                  # Configurações Redis
├── 🚀 production-setup/              # Configurações de produção
├── 📦 patches/                       # Patches e correções
├── 📄 json/                          # Arquivos JSON
├── 📱 android/                       # Configurações Android
├── 📊 logs/                          # Logs do sistema
└── 🔧 Configurações do projeto
```

---

## 📚 **DOCUMENTAÇÃO ORGANIZADA**

### **📁 docs/**
```
docs/
├── 📋 toggle-beta/                   # Documentação do toggle beta
│   ├── implementacao-toggle-beta.md
│   ├── implementacao-ui-toggle.md
│   ├── isolamento-dados-toggle-dual-role.md
│   ├── proximos-passos-toggle-beta.md
│   ├── status-toggle-beta.md
│   ├── estudo-toggle-dual-role.md
│   ├── proposta-toggle-dual-role.md
│   └── correcao-app-unico.md
├── 💰 costs/                         # Análise de custos
│   ├── custo-completo-por-corrida.md
│   ├── google-maps-requests-analysis.md
│   ├── google-maps-requests-analysis-corrected.md
│   ├── competitor-analysis.md
│   └── fallback-strategy.md
├── 🔐 security/                      # Segurança
│   ├── security-plan.md
│   └── correcao-ssl-completa.md
├── 📊 cache/                         # Cache e performance
│   ├── implementacao-cache-local.md
│   ├── implementacao-completa-cache.md
│   └── route-cache-implementation-summary.md
├── 🧪 tests/                         # Resultados de testes
│   └── test-results-summary.md
├── 📱 mobile/                        # Mobile e integração
│   ├── integracao-mobile-backend-completa.md
│   └── panorama-geral-leaf.md
└── 📋 README.md                      # Documentação principal
```

---

## 🛠️ **SCRIPTS ORGANIZADOS**

### **📁 scripts/**
```
scripts/
├── 🔄 toggle/                        # Scripts do toggle beta
│   ├── test-toggle-beta.cjs
│   └── test-toggle-local.cjs
├── 📊 cache/                         # Scripts de cache
│   └── test-cache-local.cjs
├── 🔐 security/                      # Scripts de segurança
│   └── check-dns.sh
├── 🧪 tests/                         # Scripts de teste
│   ├── test-load-new-structure.cjs
│   ├── test-ride-end-to-end.cjs
│   ├── test-ride-end-to-end-correct.cjs
│   ├── test-integracao-mobile-backend.cjs
│   └── test-vps-differences.cjs
├── 📊 route-cache/                   # Scripts de cache de rotas
│   └── test-route-cache.cjs
├── 🔧 server/                        # Scripts de servidor
│   ├── dashboard-server.js
│   ├── test-server.js
│   ├── test-dashboard-fix.cjs
│   ├── leaf-dashboard.service
│   ├── dashboard-nginx.conf
│   └── dashboard-nginx-temp.conf
└── 📋 README.md                      # Documentação dos scripts
```

---

## 🧪 **TESTES ORGANIZADOS**

### **📁 tests/**
```
tests/
├── 🔐 auth/                          # Testes de autenticação
├── 🔥 firebase/                      # Testes do Firebase
├── 🔗 integration/                   # Testes de integração
├── 📱 mobile/                        # Testes mobile
├── 📊 performance/                   # Testes de performance
├── 🔴 redis/                         # Testes do Redis
├── 🔌 websocket/                     # Testes WebSocket
├── 📋 setup/                         # Configuração de testes
└── 📋 scripts/                       # Scripts de teste
```

---

## 📱 **APLICATIVOS PRINCIPAIS**

### **📁 mobile-app/**
```
mobile-app/
├── 📱 src/
│   ├── 🎨 components/                # Componentes React Native
│   ├── 📱 screens/                   # Telas do aplicativo
│   ├── 🛠️ services/                 # Serviços (API, cache, etc.)
│   ├── 🧭 navigation/                # Navegação
│   ├── 🎨 common/                    # Utilitários compartilhados
│   ├── 🌐 i18n/                      # Internacionalização
│   ├── 🎨 config/                    # Configurações
│   └── 🧪 tests/                     # Testes mobile
├── 📦 assets/                        # Recursos (imagens, fontes)
├── 📋 documentation/                  # Documentação mobile
└── 📋 scripts/                       # Scripts mobile
```

### **📁 web-app/**
```
web-app/
├── 📱 src/                           # Código fonte React
├── 🌐 public/                        # Arquivos públicos
└── 📋 config/                        # Configurações web
```

### **📁 leaf-dashboard/**
```
leaf-dashboard/
├── 📱 src/                           # Código fonte React/TypeScript
├── 🌐 public/                        # Arquivos públicos
└── 📋 scripts/                       # Scripts do dashboard
```

---

## 🔧 **BACKEND E SERVIÇOS**

### **📁 functions/**
```
functions/
├── 🔄 providers/                     # Provedores de pagamento
├── 🛠️ common/                       # Utilitários compartilhados
├── 📊 route-cache-service.js         # Cache de rotas
├── 💰 price-route-cache.js           # Cache de preços
└── 📋 index.js                       # Ponto de entrada
```

### **📁 leaf-websocket-backend/**
```
leaf-websocket-backend/
├── 🛣️ routes/                        # Rotas da API
├── 🛠️ utils/                        # Utilitários
├── 📊 monitoring/                    # Monitoramento
└── 📋 server.js                      # Servidor principal
```

---

## 📊 **CONFIGURAÇÕES E DEPLOY**

### **📁 production-setup/**
```
production-setup/
└── load-balancer-config.js           # Configuração de load balancer
```

### **📁 redis-config/**
```
redis-config/
├── redis.conf                        # Configuração Redis
└── redis-optimized.conf              # Configuração otimizada
```

### **📁 logs/**
```
logs/
└── firebase-debug.log                # Logs do Firebase
```

---

## 🔧 **ARQUIVOS DE CONFIGURAÇÃO**

### **📄 Configurações Principais**
```
├── 📋 package.json                   # Dependências do projeto
├── 📋 app.json                       # Configuração Expo
├── 🔥 firebase.json                  # Configuração Firebase
├── 🔐 firestore.rules                # Regras Firestore
├── 🔐 .firebaserc                    # Configuração Firebase
├── 📋 .gitignore                     # Arquivos ignorados
└── 📋 README.md                      # Documentação principal
```

---

## 📋 **DOCUMENTAÇÃO ORIGINAL**

### **📁 documentation/**
```
documentation/
├── 📋 guides/                        # Guias de uso
├── 📋 project/                       # Documentação do projeto
├── 📋 reports/                       # Relatórios
└── 📋 README.md                      # Documentação
```

### **📁 DOCUMENTATION/**
```
DOCUMENTATION/
├── 📋 APP_OVERVIEW_AND_ACTION_PLAN.md
├── 📋 DEEP_DIVE_ANALYSIS.md
└── 📋 [outros arquivos de documentação]
```

---

## 🎯 **BENEFÍCIOS DA ORGANIZAÇÃO**

### **✅ Estrutura Clara**
- Separação lógica por funcionalidade
- Fácil localização de arquivos
- Documentação organizada por categoria

### **✅ Manutenibilidade**
- Scripts agrupados por propósito
- Documentação categorizada
- Configurações centralizadas

### **✅ Escalabilidade**
- Estrutura preparada para crescimento
- Fácil adição de novos módulos
- Documentação estruturada

### **✅ Colaboração**
- Estrutura intuitiva para novos desenvolvedores
- Documentação acessível
- Scripts bem organizados

---

## 📞 **COMANDOS ÚTEIS**

```bash
# Navegar para documentação
cd docs/toggle-beta/          # Documentação do toggle
cd docs/costs/               # Análise de custos
cd docs/security/            # Segurança

# Executar scripts
cd scripts/toggle/           # Scripts do toggle
cd scripts/tests/            # Scripts de teste
cd scripts/cache/            # Scripts de cache

# Acessar aplicativos
cd mobile-app/               # App mobile
cd web-app/                  # App web
cd leaf-dashboard/           # Dashboard

# Configurações
cd redis-config/             # Config Redis
cd production-setup/         # Config produção
```

---

## 🎉 **CONCLUSÃO**

O projeto agora está **100% organizado** com:

- ✅ **Documentação categorizada** por funcionalidade
- ✅ **Scripts organizados** por propósito
- ✅ **Estrutura clara** e intuitiva
- ✅ **Fácil manutenção** e escalabilidade
- ✅ **Colaboração otimizada** para equipe

**Próximo passo**: Continuar desenvolvimento com estrutura organizada! 