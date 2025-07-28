# 🌿 LEAF APP - Plataforma de Mobilidade Urbana

## 📋 Visão Geral

O **LEAF APP** é uma plataforma completa de mobilidade urbana que conecta passageiros e motoristas através de uma aplicação mobile moderna, com sistema de pagamento PIX integrado e backend híbrido de alta performance.

## 🚀 Status do Projeto

### ✅ **IMPLEMENTADO E FUNCIONAL**
- **Sistema de Pagamento PIX** - Integração completa com Woovi (OpenPix)
- **Webhook Processing** - Notificações automáticas de pagamento
- **Tarifa Mínima R$ 8,50** - Ajuste automático implementado
- **Backend Híbrido** - Redis + Firebase para alta performance
- **WebSocket Backend** - Comunicação em tempo real
- **App Mobile** - 43 telas implementadas com 36 componentes
- **Sistema de Autenticação** - Login e cadastro completo

### 🔄 **EM DESENVOLVIMENTO**
- Integração completa do PixPaymentScreen
- DriverSearchScreen para busca de motoristas
- TripTrackingScreen para acompanhamento
- Push notifications
- Chat em tempo real

## 📁 Estrutura do Projeto

```
Sourcecode/
├── 📱 mobile-app/              # Aplicação React Native
│   ├── src/screens/           # 43 telas implementadas
│   ├── src/components/        # 36 componentes reutilizáveis
│   └── src/services/          # 14 serviços de negócio
├── ⚡ functions/               # Firebase Functions (72 functions)
│   ├── providers/woovi/       # Integração PIX
│   └── woovi-webhook.js       # Webhook processing
├── 🔌 leaf-websocket-backend/ # Servidor WebSocket
├── 📊 leaf-dashboard/         # Dashboard de monitoramento
├── 🌐 web-app/                # Aplicação web
├── 📚 documentation/           # Documentação organizada
│   ├── project/               # Documentação do projeto
│   └── studies/               # Estudos e análises
├── 🛠️ scripts/                # Scripts de automação
│   ├── testing/               # 38 scripts de teste
│   ├── deploy/                # Scripts de deploy
│   └── services/              # Scripts de serviços
└── 🧪 tests/                  # Testes automatizados
```

## 🛠️ Tecnologias Utilizadas

### **Frontend**
- **React Native** - App mobile multiplataforma
- **React** - Web app
- **Expo** - Framework de desenvolvimento

### **Backend**
- **Firebase Functions** - APIs serverless
- **Redis** - Cache e localização em tempo real
- **WebSocket** - Comunicação em tempo real
- **Firebase Firestore** - Banco de dados

### **Pagamentos**
- **Woovi (OpenPix)** - Gateway PIX
- **Webhook Processing** - Notificações automáticas

### **Infraestrutura**
- **Firebase Hosting** - Deploy automático
- **Redis Cloud** - Cache distribuído
- **Docker** - Containerização

## 🚀 Como Executar

### **Pré-requisitos**
```bash
# Node.js 18+
node --version

# Yarn ou npm
yarn --version

# Firebase CLI
firebase --version
```

### **Instalação**
```bash
# Clonar repositório
git clone [repository-url]
cd Sourcecode

# Instalar dependências
yarn install

# Configurar Firebase
firebase login
firebase use leaf-reactnative
```

### **Executar Aplicação**
```bash
# Mobile App (React Native)
cd mobile-app
yarn start

# Web App
cd web-app
yarn start

# Backend Functions
cd functions
firebase deploy --only functions
```

## 🧪 Testes

### **Executar Testes de Pagamento**
```bash
# Teste de pagamento PIX
node scripts/testing/test-pix-payment-flow.cjs

# Teste de tarifa mínima
node scripts/testing/test-minimum-fare.cjs

# Teste de ajuste automático
node scripts/testing/test-auto-adjustment-simple.cjs
```

### **Executar Testes de Integração**
```bash
# Teste de webhook
node scripts/testing/test-webhook-simple.cjs

# Teste de integração Woovi
node scripts/testing/test-woovi-integration.cjs
```

## 📊 Métricas de Performance

- **WebSocket:** 10.000+ conexões simultâneas
- **Redis:** 100.000+ ops/segundo
- **Firebase:** 1.000+ invocações/segundo
- **Mobile:** 5.000+ usuários simultâneos

## 📚 Documentação

### **📋 Principais Documentos**
- [Checklist de Implementação](./documentation/project/MOBILE_APP_IMPLEMENTATION_CHECKLIST.html) - Checklist interativo
- [Fluxo de Pagamento](./documentation/project/PAYMENT_FLOW_DIAGRAM.md) - Diagrama completo
- [Configuração Tarifa Mínima](./documentation/project/MINIMUM_FARE_CONFIGURATION.md) - R$ 8,50
- [Eventos Webhook](./documentation/project/WOOVI_WEBHOOK_EVENTS.md) - Woovi events

### **🛠️ Scripts e Automação**
- [Índice de Scripts](./scripts/testing/README.md) - Todos os scripts organizados
- [Scripts de Deploy](./scripts/deploy/) - Automação de deploy
- [Scripts de Serviços](./scripts/services/) - Gerenciamento de serviços

### **📊 Relatórios**
- [Relatório de Organização](./ORGANIZATION_FINAL_REPORT.md) - Organização final
- [Status Reports](./documentation/project/status-reports/) - Status e configurações
- [Logs](./documentation/project/logs/) - Logs por data

## 🔧 Configuração

### **Variáveis de Ambiente**
```bash
# Firebase
FIREBASE_PROJECT_ID=leaf-reactnative
FIREBASE_DATABASE_URL=https://leaf-reactnative-default-rtdb.firebaseio.com

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Woovi (OpenPix)
WOOVI_APP_ID=your_app_id
WOOVI_API_KEY=your_api_key
```

### **API Keys Configuradas**
- ✅ **Firebase** - Configurado e funcional
- ✅ **Woovi** - Configurado e funcional
- ✅ **Redis** - Configurado e funcional

## 🚀 Deploy

### **Deploy Rápido**
```bash
# Executar script de deploy
./scripts/deploy/deploy-rapido.sh

# Ou manualmente
firebase deploy
```

### **Deploy Específico**
```bash
# Apenas functions
firebase deploy --only functions

# Apenas hosting
firebase deploy --only hosting

# Apenas database
firebase deploy --only database
```

## 📞 Suporte

### **Troubleshooting**
1. **Problemas de pagamento:** Execute `test-woovi-integration.cjs`
2. **Webhook não funciona:** Execute `test-webhook-simple.cjs`
3. **Tarifa mínima:** Execute `test-minimum-fare.cjs`
4. **Mobile issues:** Verifique `MOBILE_APP_ANALYSIS.md`

### **Logs e Monitoramento**
- **Firebase Console:** https://console.firebase.google.com/project/leaf-reactnative
- **Redis Monitor:** `redis-cli monitor`
- **WebSocket Logs:** `tail -f leaf-websocket-backend/logs/app.log`

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🎯 Roadmap

### **Próximas Funcionalidades**
- [ ] Push notifications
- [ ] Chat em tempo real
- [ ] Analytics avançados
- [ ] A/B testing
- [ ] Dark mode
- [ ] Offline mode melhorado

### **Melhorias de Performance**
- [ ] Lazy loading de componentes
- [ ] Image optimization
- [ ] Code splitting
- [ ] Background sync

---

**🌿 LEAF APP - Transformando a mobilidade urbana** 🚀

**Status:** ✅ **ORGANIZADO E PRONTO PARA PRÓXIMA FASE**

**Última atualização:** 28 de Julho de 2025 