# 🚗 Leaf Dashboard

Dashboard de monitoramento em tempo real para o sistema Leaf de ride-sharing.

## ✨ Características

- **🎨 Design Moderno**: Interface limpa e responsiva com Tailwind CSS
- **🌙 Tema Escuro/Claro**: Alternância automática com preferência salva
- **🔔 Sistema de Notificações**: Sino com contador de alertas em tempo real
- **📊 Métricas em Tempo Real**: Latência, recursos do sistema e sincronização
- **🔐 Autenticação**: Sistema de login com diferentes níveis de acesso
- **📱 Responsivo**: Funciona perfeitamente em desktop, tablet e mobile

## 🚀 Início Rápido

### Windows (Prompt de Comando) - RECOMENDADO
```batch
start-dashboard.bat
```

### Windows (PowerShell)
```powershell
.\start-dashboard.ps1
```

### Instalação Manual

#### Pré-requisitos

- Node.js 16+ 
- npm ou yarn
- Backend Leaf rodando na porta 3001

#### Passos

1. **Instalar dependências:**
```bash
npm install
```

2. **Iniciar o servidor de desenvolvimento:**
```bash
npm start
```

3. **Acessar o dashboard:**
```
http://localhost:3000
```

## 🔑 Credenciais de Acesso

### Usuários de Demonstração

| Usuário | Senha | Nível |
|---------|-------|-------|
| `admin` | `admin123` | Administrador |
| `operator` | `op123` | Operador |
| `viewer` | `view123` | Visualizador |

## 📊 Métricas Monitoradas

### 🎯 Performance
- **Latência média/máxima/mínima** por operação
- **Taxa de sucesso/erro** em tempo real
- **Throughput** (operações por minuto)
- **Histórico de performance** (últimas 24h)

### 🖥️ Recursos do Sistema
- **Uso de CPU** do servidor
- **Uso de memória** (RAM)
- **Uptime** do sistema
- **Conexões ativas** WebSocket
- **Load average** do servidor

### 🗄️ Bancos de Dados
- **Status do Redis** (conectado/desconectado)
- **Memória usada** pelo Redis
- **Operações/segundo** no Redis
- **Status do Firebase** (conectado/desconectado)
- **Latência** de operações Firebase

### 🔔 Sistema de Alertas
- **Alertas ativos** (críticos, erros, warnings)
- **Falhas de sincronização** Redis ↔ Firebase
- **Histórico de alertas** (últimas 24h)
- **Taxa de recuperação** automática

## 🎨 Interface

### Header
- **Logo e título** do sistema
- **Status geral** em tempo real
- **Sino de notificações** com contador
- **Toggle de tema** (escuro/claro)
- **Configurações** e logout

### Cards Principais
- **Status Geral**: Saúde do sistema
- **Alertas Ativos**: Contagem de notificações
- **Uptime**: Tempo de funcionamento
- **Operações**: Total de operações processadas

### Métricas Detalhadas
- **Performance de Latência**: Estatísticas detalhadas
- **Recursos do Sistema**: CPU, memória e status dos bancos
- **Gráficos**: Visualizações interativas (em desenvolvimento)

## 🔧 Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_REFRESH_INTERVAL=5000
```

### Personalização

- **Cores**: Edite `tailwind.config.js` para personalizar o tema
- **Intervalo de atualização**: Configure em `src/components/Dashboard.tsx`
- **APIs**: Modifique `src/services/metricsApi.ts` para diferentes endpoints

## 📱 Responsividade

O dashboard é totalmente responsivo e se adapta a:

- **Desktop**: Layout completo com todas as funcionalidades
- **Tablet**: Layout otimizado para telas médias
- **Mobile**: Interface simplificada para telas pequenas

## 🔔 Notificações

### Tipos de Alerta

- **🔴 Crítico**: Problemas graves que requerem atenção imediata
- **🟠 Erro**: Falhas que afetam o funcionamento
- **🟡 Warning**: Avisos sobre possíveis problemas
- **🟢 Info**: Informações gerais do sistema

### Ações

- **Visualizar**: Clique no sino para ver todas as notificações
- **Reconhecer**: Clique no X para marcar como lida
- **Configurar**: Ajuste preferências nas configurações

## 🛠️ Desenvolvimento

### Estrutura do Projeto

```
src/
├── components/          # Componentes React
│   ├── Dashboard.tsx    # Dashboard principal
│   ├── LoginPage.tsx    # Página de login
│   └── NotificationBell.tsx # Sino de notificações
├── contexts/            # Contextos React
│   └── AuthContext.tsx  # Autenticação
├── services/            # Serviços de API
│   └── metricsApi.ts    # API de métricas
├── types/               # Tipos TypeScript
│   └── metrics.ts       # Interfaces de métricas
├── App.tsx              # Componente principal
├── index.tsx            # Ponto de entrada
└── index.css            # Estilos globais
```

### Scripts Disponíveis

```bash
npm start          # Iniciar servidor de desenvolvimento
npm run build      # Build para produção
npm test           # Executar testes
npm run eject      # Ejetar configurações (irreversível)
```

### Scripts de Troubleshooting

```batch
start-dashboard.bat    # Iniciar dashboard (verificação automática)
check-status.bat       # Verificar status do sistema
fix-dashboard.bat      # Corrigir problemas automaticamente
diagnose-dashboard.bat # Diagnóstico completo
```

## 🔗 Integração com Backend

O dashboard se conecta ao backend Leaf através das seguintes APIs:

- `GET /metrics` - Métricas completas do sistema
- `GET /metrics/realtime` - Métricas em tempo real
- `GET /health` - Status de saúde do backend

### Endpoints Esperados

```json
{
  "timestamp": "2025-07-19T00:00:00.000Z",
  "latency": {
    "performance": {
      "avgLatency": 159.64,
      "maxLatency": 963,
      "minLatency": 45,
      "totalOperations": 14,
      "errorRate": 0.00
    }
  },
  "resources": {
    "system": {
      "cpu": 0.15,
      "memory": {
        "usagePercent": 85.5
      },
      "uptime": 86400
    },
    "redis": {
      "lastCheck": 1752883883483
    }
  },
  "summary": {
    "status": "healthy",
    "alerts": 0,
    "uptime": 86400
  }
}
```

## 🚀 Deploy

### Build para Produção

```bash
npm run build
```

### Servir Build

```bash
npx serve -s build -l 3000
```

### Docker (Opcional)

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npx", "serve", "-s", "build", "-l", "3000"]
```

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 🆘 Suporte

Para suporte e dúvidas:

- **Issues**: Abra uma issue no GitHub
- **Documentação**: Consulte este README
- **Backend**: Verifique se o servidor Leaf está rodando na porta 3001

---

**Desenvolvido com ❤️ para o sistema Leaf** 

Dashboard de monitoramento em tempo real para o sistema Leaf de ride-sharing.

## ✨ Características

- **🎨 Design Moderno**: Interface limpa e responsiva com Tailwind CSS
- **🌙 Tema Escuro/Claro**: Alternância automática com preferência salva
- **🔔 Sistema de Notificações**: Sino com contador de alertas em tempo real
- **📊 Métricas em Tempo Real**: Latência, recursos do sistema e sincronização
- **🔐 Autenticação**: Sistema de login com diferentes níveis de acesso
- **📱 Responsivo**: Funciona perfeitamente em desktop, tablet e mobile

## 🚀 Início Rápido

### Windows (Prompt de Comando) - RECOMENDADO
```batch
start-dashboard.bat
```

### Windows (PowerShell)
```powershell
.\start-dashboard.ps1
```

### Instalação Manual

#### Pré-requisitos

- Node.js 16+ 
- npm ou yarn
- Backend Leaf rodando na porta 3001

#### Passos

1. **Instalar dependências:**
```bash
npm install
```

2. **Iniciar o servidor de desenvolvimento:**
```bash
npm start
```

3. **Acessar o dashboard:**
```
http://localhost:3000
```

## 🔑 Credenciais de Acesso

### Usuários de Demonstração

| Usuário | Senha | Nível |
|---------|-------|-------|
| `admin` | `admin123` | Administrador |
| `operator` | `op123` | Operador |
| `viewer` | `view123` | Visualizador |

## 📊 Métricas Monitoradas

### 🎯 Performance
- **Latência média/máxima/mínima** por operação
- **Taxa de sucesso/erro** em tempo real
- **Throughput** (operações por minuto)
- **Histórico de performance** (últimas 24h)

### 🖥️ Recursos do Sistema
- **Uso de CPU** do servidor
- **Uso de memória** (RAM)
- **Uptime** do sistema
- **Conexões ativas** WebSocket
- **Load average** do servidor

### 🗄️ Bancos de Dados
- **Status do Redis** (conectado/desconectado)
- **Memória usada** pelo Redis
- **Operações/segundo** no Redis
- **Status do Firebase** (conectado/desconectado)
- **Latência** de operações Firebase

### 🔔 Sistema de Alertas
- **Alertas ativos** (críticos, erros, warnings)
- **Falhas de sincronização** Redis ↔ Firebase
- **Histórico de alertas** (últimas 24h)
- **Taxa de recuperação** automática

## 🎨 Interface

### Header
- **Logo e título** do sistema
- **Status geral** em tempo real
- **Sino de notificações** com contador
- **Toggle de tema** (escuro/claro)
- **Configurações** e logout

### Cards Principais
- **Status Geral**: Saúde do sistema
- **Alertas Ativos**: Contagem de notificações
- **Uptime**: Tempo de funcionamento
- **Operações**: Total de operações processadas

### Métricas Detalhadas
- **Performance de Latência**: Estatísticas detalhadas
- **Recursos do Sistema**: CPU, memória e status dos bancos
- **Gráficos**: Visualizações interativas (em desenvolvimento)

## 🔧 Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_REFRESH_INTERVAL=5000
```

### Personalização

- **Cores**: Edite `tailwind.config.js` para personalizar o tema
- **Intervalo de atualização**: Configure em `src/components/Dashboard.tsx`
- **APIs**: Modifique `src/services/metricsApi.ts` para diferentes endpoints

## 📱 Responsividade

O dashboard é totalmente responsivo e se adapta a:

- **Desktop**: Layout completo com todas as funcionalidades
- **Tablet**: Layout otimizado para telas médias
- **Mobile**: Interface simplificada para telas pequenas

## 🔔 Notificações

### Tipos de Alerta

- **🔴 Crítico**: Problemas graves que requerem atenção imediata
- **🟠 Erro**: Falhas que afetam o funcionamento
- **🟡 Warning**: Avisos sobre possíveis problemas
- **🟢 Info**: Informações gerais do sistema

### Ações

- **Visualizar**: Clique no sino para ver todas as notificações
- **Reconhecer**: Clique no X para marcar como lida
- **Configurar**: Ajuste preferências nas configurações

## 🛠️ Desenvolvimento

### Estrutura do Projeto

```
src/
├── components/          # Componentes React
│   ├── Dashboard.tsx    # Dashboard principal
│   ├── LoginPage.tsx    # Página de login
│   └── NotificationBell.tsx # Sino de notificações
├── contexts/            # Contextos React
│   └── AuthContext.tsx  # Autenticação
├── services/            # Serviços de API
│   └── metricsApi.ts    # API de métricas
├── types/               # Tipos TypeScript
│   └── metrics.ts       # Interfaces de métricas
├── App.tsx              # Componente principal
├── index.tsx            # Ponto de entrada
└── index.css            # Estilos globais
```

### Scripts Disponíveis

```bash
npm start          # Iniciar servidor de desenvolvimento
npm run build      # Build para produção
npm test           # Executar testes
npm run eject      # Ejetar configurações (irreversível)
```

### Scripts de Troubleshooting

```batch
start-dashboard.bat    # Iniciar dashboard (verificação automática)
check-status.bat       # Verificar status do sistema
fix-dashboard.bat      # Corrigir problemas automaticamente
diagnose-dashboard.bat # Diagnóstico completo
```

## 🔗 Integração com Backend

O dashboard se conecta ao backend Leaf através das seguintes APIs:

- `GET /metrics` - Métricas completas do sistema
- `GET /metrics/realtime` - Métricas em tempo real
- `GET /health` - Status de saúde do backend

### Endpoints Esperados

```json
{
  "timestamp": "2025-07-19T00:00:00.000Z",
  "latency": {
    "performance": {
      "avgLatency": 159.64,
      "maxLatency": 963,
      "minLatency": 45,
      "totalOperations": 14,
      "errorRate": 0.00
    }
  },
  "resources": {
    "system": {
      "cpu": 0.15,
      "memory": {
        "usagePercent": 85.5
      },
      "uptime": 86400
    },
    "redis": {
      "lastCheck": 1752883883483
    }
  },
  "summary": {
    "status": "healthy",
    "alerts": 0,
    "uptime": 86400
  }
}
```

## 🚀 Deploy

### Build para Produção

```bash
npm run build
```

### Servir Build

```bash
npx serve -s build -l 3000
```

### Docker (Opcional)

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npx", "serve", "-s", "build", "-l", "3000"]
```

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 🆘 Suporte

Para suporte e dúvidas:

- **Issues**: Abra uma issue no GitHub
- **Documentação**: Consulte este README
- **Backend**: Verifique se o servidor Leaf está rodando na porta 3001

---

**Desenvolvido com ❤️ para o sistema Leaf** 

Dashboard de monitoramento em tempo real para o sistema Leaf de ride-sharing.

## ✨ Características

- **🎨 Design Moderno**: Interface limpa e responsiva com Tailwind CSS
- **🌙 Tema Escuro/Claro**: Alternância automática com preferência salva
- **🔔 Sistema de Notificações**: Sino com contador de alertas em tempo real
- **📊 Métricas em Tempo Real**: Latência, recursos do sistema e sincronização
- **🔐 Autenticação**: Sistema de login com diferentes níveis de acesso
- **📱 Responsivo**: Funciona perfeitamente em desktop, tablet e mobile

## 🚀 Início Rápido

### Windows (Prompt de Comando) - RECOMENDADO
```batch
start-dashboard.bat
```

### Windows (PowerShell)
```powershell
.\start-dashboard.ps1
```

### Instalação Manual

#### Pré-requisitos

- Node.js 16+ 
- npm ou yarn
- Backend Leaf rodando na porta 3001

#### Passos

1. **Instalar dependências:**
```bash
npm install
```

2. **Iniciar o servidor de desenvolvimento:**
```bash
npm start
```

3. **Acessar o dashboard:**
```
http://localhost:3000
```

## 🔑 Credenciais de Acesso

### Usuários de Demonstração

| Usuário | Senha | Nível |
|---------|-------|-------|
| `admin` | `admin123` | Administrador |
| `operator` | `op123` | Operador |
| `viewer` | `view123` | Visualizador |

## 📊 Métricas Monitoradas

### 🎯 Performance
- **Latência média/máxima/mínima** por operação
- **Taxa de sucesso/erro** em tempo real
- **Throughput** (operações por minuto)
- **Histórico de performance** (últimas 24h)

### 🖥️ Recursos do Sistema
- **Uso de CPU** do servidor
- **Uso de memória** (RAM)
- **Uptime** do sistema
- **Conexões ativas** WebSocket
- **Load average** do servidor

### 🗄️ Bancos de Dados
- **Status do Redis** (conectado/desconectado)
- **Memória usada** pelo Redis
- **Operações/segundo** no Redis
- **Status do Firebase** (conectado/desconectado)
- **Latência** de operações Firebase

### 🔔 Sistema de Alertas
- **Alertas ativos** (críticos, erros, warnings)
- **Falhas de sincronização** Redis ↔ Firebase
- **Histórico de alertas** (últimas 24h)
- **Taxa de recuperação** automática

## 🎨 Interface

### Header
- **Logo e título** do sistema
- **Status geral** em tempo real
- **Sino de notificações** com contador
- **Toggle de tema** (escuro/claro)
- **Configurações** e logout

### Cards Principais
- **Status Geral**: Saúde do sistema
- **Alertas Ativos**: Contagem de notificações
- **Uptime**: Tempo de funcionamento
- **Operações**: Total de operações processadas

### Métricas Detalhadas
- **Performance de Latência**: Estatísticas detalhadas
- **Recursos do Sistema**: CPU, memória e status dos bancos
- **Gráficos**: Visualizações interativas (em desenvolvimento)

## 🔧 Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_REFRESH_INTERVAL=5000
```

### Personalização

- **Cores**: Edite `tailwind.config.js` para personalizar o tema
- **Intervalo de atualização**: Configure em `src/components/Dashboard.tsx`
- **APIs**: Modifique `src/services/metricsApi.ts` para diferentes endpoints

## 📱 Responsividade

O dashboard é totalmente responsivo e se adapta a:

- **Desktop**: Layout completo com todas as funcionalidades
- **Tablet**: Layout otimizado para telas médias
- **Mobile**: Interface simplificada para telas pequenas

## 🔔 Notificações

### Tipos de Alerta

- **🔴 Crítico**: Problemas graves que requerem atenção imediata
- **🟠 Erro**: Falhas que afetam o funcionamento
- **🟡 Warning**: Avisos sobre possíveis problemas
- **🟢 Info**: Informações gerais do sistema

### Ações

- **Visualizar**: Clique no sino para ver todas as notificações
- **Reconhecer**: Clique no X para marcar como lida
- **Configurar**: Ajuste preferências nas configurações

## 🛠️ Desenvolvimento

### Estrutura do Projeto

```
src/
├── components/          # Componentes React
│   ├── Dashboard.tsx    # Dashboard principal
│   ├── LoginPage.tsx    # Página de login
│   └── NotificationBell.tsx # Sino de notificações
├── contexts/            # Contextos React
│   └── AuthContext.tsx  # Autenticação
├── services/            # Serviços de API
│   └── metricsApi.ts    # API de métricas
├── types/               # Tipos TypeScript
│   └── metrics.ts       # Interfaces de métricas
├── App.tsx              # Componente principal
├── index.tsx            # Ponto de entrada
└── index.css            # Estilos globais
```

### Scripts Disponíveis

```bash
npm start          # Iniciar servidor de desenvolvimento
npm run build      # Build para produção
npm test           # Executar testes
npm run eject      # Ejetar configurações (irreversível)
```

### Scripts de Troubleshooting

```batch
start-dashboard.bat    # Iniciar dashboard (verificação automática)
check-status.bat       # Verificar status do sistema
fix-dashboard.bat      # Corrigir problemas automaticamente
diagnose-dashboard.bat # Diagnóstico completo
```

## 🔗 Integração com Backend

O dashboard se conecta ao backend Leaf através das seguintes APIs:

- `GET /metrics` - Métricas completas do sistema
- `GET /metrics/realtime` - Métricas em tempo real
- `GET /health` - Status de saúde do backend

### Endpoints Esperados

```json
{
  "timestamp": "2025-07-19T00:00:00.000Z",
  "latency": {
    "performance": {
      "avgLatency": 159.64,
      "maxLatency": 963,
      "minLatency": 45,
      "totalOperations": 14,
      "errorRate": 0.00
    }
  },
  "resources": {
    "system": {
      "cpu": 0.15,
      "memory": {
        "usagePercent": 85.5
      },
      "uptime": 86400
    },
    "redis": {
      "lastCheck": 1752883883483
    }
  },
  "summary": {
    "status": "healthy",
    "alerts": 0,
    "uptime": 86400
  }
}
```

## 🚀 Deploy

### Build para Produção

```bash
npm run build
```

### Servir Build

```bash
npx serve -s build -l 3000
```

### Docker (Opcional)

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npx", "serve", "-s", "build", "-l", "3000"]
```

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 🆘 Suporte

Para suporte e dúvidas:

- **Issues**: Abra uma issue no GitHub
- **Documentação**: Consulte este README
- **Backend**: Verifique se o servidor Leaf está rodando na porta 3001

---

**Desenvolvido com ❤️ para o sistema Leaf** 