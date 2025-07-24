# 🍃 LEAF - React Native Ride-Sharing App

Uma aplicação completa de ride-sharing desenvolvida em React Native com integração Redis para performance otimizada.

## 🚀 **Funcionalidades Principais**

- **📱 App Mobile** - React Native com Expo
- **🌐 Web App** - Interface administrativa
- **🔴 Redis Integration** - Cache e tracking em tempo real
- **🔥 Firebase Backend** - Autenticação e banco de dados
- **💳 Payment Integration** - Múltiplos provedores de pagamento
- **📍 Real-time Location** - Tracking de motoristas e passageiros
- **📊 Analytics** - Estatísticas e relatórios

## 🏗️ **Arquitetura**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mobile App    │    │   Web App       │    │   Firebase      │
│   (React Native)│    │   (React)       │    │   Functions     │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────┴─────────────┐
                    │                           │
                    │        Redis API          │
                    │    (Performance Layer)    │
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    │         Redis             │
                    │    (Cache & Tracking)     │
                    │                           │
                    └───────────────────────────┘
```

## 📁 **Estrutura do Projeto**

```
Sourcecode/
├── mobile-app/                 # App React Native
│   ├── src/
│   │   ├── services/
│   │   │   └── RedisApiService.js  # Serviço de API Redis
│   │   ├── screens/            # Telas do app
│   │   └── components/         # Componentes reutilizáveis
│   └── metro.config.js         # Configuração Metro
├── web-app/                    # Interface web administrativa
├── functions/                  # Firebase Functions
│   └── redis-api.js           # Endpoints Redis API
├── common/                     # Código compartilhado
│   ├── src/
│   │   ├── services/          # Serviços Redis
│   │   ├── actions/           # Actions Redux
│   │   └── config/            # Configurações
└── leaf-websocket-backend/     # Backend WebSocket
```

## 🔴 **Redis Integration**

### **Nova Arquitetura Redis API**

O projeto agora usa uma arquitetura híbrida onde o mobile app consome Redis através de webhooks/API, evitando problemas de compatibilidade com módulos Node.js.

#### **Endpoints Disponíveis:**

**📍 Localização:**
- `POST /update_user_location` - Atualizar localização do usuário
- `POST /get_nearby_drivers` - Buscar motoristas próximos
- `GET /get_user_location/{userId}` - Obter localização do usuário

**🚗 Tracking:**
- `POST /start_trip_tracking` - Iniciar tracking de viagem
- `POST /update_trip_location` - Atualizar localização da viagem
- `POST /end_trip_tracking` - Finalizar tracking
- `GET /get_trip_data/{tripId}` - Obter dados da viagem
- `POST /cancel_trip_tracking` - Cancelar tracking
- `GET /get_trip_history/{tripId}` - Histórico de tracking
- `GET /get_active_trips/{userId}` - Viagens ativas
- `POST /unsubscribe_tracking` - Desinscrever de tracking

**📊 Estatísticas:**
- `GET /get_redis_stats` - Estatísticas do Redis
- `GET /health` - Health check

#### **Documentação Completa:**
- [📖 REDIS_API_ENDPOINTS.md](./REDIS_API_ENDPOINTS.md) - Documentação detalhada dos endpoints

## 🛠️ **Tecnologias**

### **Frontend**
- **React Native** - App mobile
- **React** - Web app
- **Expo** - Framework de desenvolvimento
- **Redux** - Gerenciamento de estado
- **React Navigation** - Navegação

### **Backend**
- **Firebase** - Autenticação e banco de dados
- **Firebase Functions** - Serverless functions
- **Redis** - Cache e tracking em tempo real
- **WebSocket** - Comunicação em tempo real

### **Pagamentos**
- **Stripe** - Processamento de pagamentos
- **PayPal** - Pagamentos online
- **Braintree** - Gateway de pagamento
- **MercadoPago** - Pagamentos latino-americanos
- **E mais 15+ provedores**

## 🚀 **Instalação e Configuração**

### **Pré-requisitos**
- Node.js 18+
- npm ou yarn
- Expo CLI
- Firebase CLI
- Redis Server

### **1. Clone o repositório**
```bash
git clone https://github.com/leaf-admin/LEAF-ReactNative.git
cd LEAF-ReactNative
```

### **2. Instalar dependências**
```bash
npm install
cd mobile-app && npm install
cd ../web-app && npm install
cd ../functions && npm install
```

### **3. Configurar Firebase**
```bash
firebase login
firebase init
```

### **4. Configurar Redis**
```bash
# Windows
redis-server

# Linux/Mac
sudo service redis-server start
```

### **5. Configurar variáveis de ambiente**
```bash
# Copiar arquivo de exemplo
cp redis-config.env.example redis-config.env

# Editar com suas configurações
nano redis-config.env
```

### **6. Deploy das Functions**
```bash
cd functions
npm run deploy
```

## 📱 **Executando o Projeto**

### **Mobile App**
```bash
cd mobile-app
npx expo start
```

### **Web App**
```bash
cd web-app
npm start
```

### **Redis Backend**
```bash
cd leaf-websocket-backend
npm start
```

## 🔧 **Configurações Importantes**

### **Metro Config**
O `metro.config.js` foi atualizado para a versão mais estável, removendo dependências problemáticas do Redis.

### **Redis API Service**
O `RedisApiService.js` fornece uma interface limpa para consumir os endpoints Redis sem dependências diretas.

### **Fallback Automático**
Todos os endpoints têm fallback automático para Firebase quando Redis não está disponível.

## 📊 **Monitoramento e Testes**

### **Testes Redis**
```bash
# Teste básico
npm run test:redis

# Teste completo
npm run test:redis:complete

# Teste de carga
npm run test:redis:load
```

### **Scripts de Diagnóstico**
- `diagnose-redis.bat` - Diagnóstico do Redis
- `test-redis-quick.bat` - Teste rápido
- `run-all-redis-tests.bat` - Todos os testes

## 📚 **Documentação Adicional**

- [🔴 Redis API Documentation](./REDIS_API_DOCUMENTATION.md)
- [📊 Redis Testing Guide](./REDIS_TESTING_GUIDE.md)
- [🚀 Redis Migration Guide](./REDIS-MIGRATION-README.md)
- [📱 Mobile Testing Guide](./MOBILE_TESTING_GUIDE.md)
- [🔧 Redis Troubleshooting](./REDIS_TROUBLESHOOTING.md)
- [🌐 WebSocket Setup](./WEBSOCKET_SETUP.md)

## 🤝 **Contribuição**

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 **Licença**

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 📞 **Suporte**

Para suporte e dúvidas:
- 📧 Email: support@leaf-app.com
- 💬 Discord: [Leaf Community](https://discord.gg/leaf-app)
- 📖 Wiki: [Documentação Completa](https://github.com/leaf-admin/LEAF-ReactNative/wiki)

## 🎯 **Roadmap**

- [ ] Implementação de IA para otimização de rotas
- [ ] Integração com mais provedores de pagamento
- [ ] Sistema de gamificação para motoristas
- [ ] Analytics avançados
- [ ] Suporte a múltiplos idiomas
- [ ] Modo offline aprimorado

---

**🍃 LEAF** - O novo jeito de ir e vir! 🚗💨 