# 📱 LEAF MOBILE APP - VISUALIZAÇÃO COMPLETA

## 🎯 FLUXOS DE NAVEGAÇÃO

### 🔐 FLUXO DE AUTENTICAÇÃO (ONBOARDING)

```
┌─────────────────┐
│   SplashScreen  │ ← Logo Leaf + Loading
└─────────┬───────┘
          │
┌─────────▼───────┐
│ WelcomeScreen   │ ← Animações + 10 idiomas
└─────────┬───────┘
          │
┌─────────▼───────┐
│ProfileSelection │ ← Passageiro ou Motorista
└─────────┬───────┘
          │
┌─────────▼───────┐
│ PhoneInputScreen│ ← Input telefone
└─────────┬───────┘
          │
┌─────────▼───────┐
│PersonalDataScreen│ ← Nome, email, etc
└─────────┬───────┘
          │
┌─────────▼───────┐
│ DriverTermsScreen│ ← Termos (só motorista)
└─────────┬───────┘
          │
┌─────────▼───────┐
│   OTPScreen     │ ← Verificação SMS
└─────────┬───────┘
          │
┌─────────▼───────┐
│DriverDocuments  │ ← CNH, CRLV (motorista)
└─────────┬───────┘
          │
┌─────────▼───────┐
│CompleteRegistration│ ← Finalização
└─────────┬───────┘
          │
    ┌─────▼─────┐
    │   LOGIN   │
    └─────┬─────┘
```

---

## 👤 FLUXO PASSAGEIRO (CUSTOMER)

### 🗺️ TELA PRINCIPAL - MapScreen
```
┌─────────────────────────────────────┐
│ 🔍 [Buscar destino...]             │
├─────────────────────────────────────┤
│                                     │
│           🗺️ MAPA                   │
│        (Google Maps)                │
│                                     │
│    📍 Sua localização              │
│                                     │
├─────────────────────────────────────┤
│ 🚗 UberX    🚙 Comfort   🚐 Van    │
│ R$ 15,90    R$ 25,50    R$ 35,00  │
├─────────────────────────────────────┤
│ 💳 PIX | 🕐 Agendar | 📱 Contato   │
│                                     │
│ [SOLICITAR CORRIDA]                 │
└─────────────────────────────────────┘
```

### 🔍 TELA DE BUSCA - SearchScreen
```
┌─────────────────────────────────────┐
│ ← Voltar    🔍 Buscar endereço     │
├─────────────────────────────────────┤
│ 📍 Casa                            │
│ Rua das Flores, 123                │
├─────────────────────────────────────┤
│ 🏢 Trabalho                        │
│ Av. Paulista, 1000                 │
├─────────────────────────────────────┤
│ 🏥 Hospital                        │
│ Rua da Saúde, 456                  │
├─────────────────────────────────────┤
│                                     │
│ [Buscar no mapa]                   │
└─────────────────────────────────────┘
```

### 📋 BOTTOM TABS (Passageiro)
```
┌─────────────────────────────────────┐
│ 🏠 MAPA | 📋 CORRIDAS | 💰 CARTEIRA│
│                                     │
│ ⚙️ CONFIGURAÇÕES                    │
└─────────────────────────────────────┘
```

---

## 🚗 FLUXO MOTORISTA (DRIVER)

### 🚗 TELA PRINCIPAL - DriverTrips
```
┌─────────────────────────────────────┐
│ 👤 João Silva    🚗 Online         │
├─────────────────────────────────────┤
│ 📊 HOJE: R$ 245,00                 │
│ 🚗 8 corridas | ⭐ 4.8             │
├─────────────────────────────────────┤
│ 🗺️ Área de cobertura              │
│                                     │
│ [ACEITAR CORRIDA]                  │
│ [RECUSAR]                          │
├─────────────────────────────────────┤
│ 📱 Chat | 📞 Ligar | 📍 Navegar    │
└─────────────────────────────────────┘
```

### 💰 DASHBOARD MOTORISTA - DriverDashboardScreen
```
┌─────────────────────────────────────┐
│ 💰 SALDO: R$ 1.250,00              │
├─────────────────────────────────────┤
│ 📊 Esta semana: R$ 2.450,00        │
│ 🚗 45 corridas | ⭐ 4.9             │
├─────────────────────────────────────┤
│ 📈 Gráfico de ganhos               │
│                                     │
│ [VER RELATÓRIO]                    │
├─────────────────────────────────────┤
│ 💳 BaaS | 📅 Pagamentos | 📊 Meta  │
└─────────────────────────────────────┘
```

### 💳 BaaS ACCOUNT - BaaSAccountScreen
```
┌─────────────────────────────────────┐
│ 🏦 CONTA BaaS                      │
├─────────────────────────────────────┤
│ 💰 Saldo: R$ 1.250,00              │
│ 📅 Próximo pagamento: 15/08        │
├─────────────────────────────────────┤
│ 💸 Taxa operacional: R$ 1,49       │
│ 🏛️ Taxa prefeitura: R$ 0,45        │
│ 💳 Taxa Woovi: R$ 0,50             │
├─────────────────────────────────────┤
│ [VER DETALHES] | [HISTÓRICO]       │
└─────────────────────────────────────┘
```

---

## 🔄 TOGGLE PASSAGEIRO/MOTORISTA

### 👤 ProfileToggle Component
```
┌─────────────────────────────────────┐
│ 👤 João Silva                      │
│                                     │
│ [👤 PASSAGEIRO] ←→ [🚗 MOTORISTA]  │
│                                     │
│ Modo atual: PASSAGEIRO             │
└─────────────────────────────────────┘
```

**Localização**: Canto superior direito
**Estilo**: Discreto (como Nubank)
**Animação**: Suave com feedback visual

---

## 🎨 DESIGN SYSTEM

### 🎨 Cores Principais
```
Primária:    #06113C (Azul escuro)
Secundária:  #DDDEEE (Azul claro)  
Verde Leaf:  #41D274
Acento:      #007AFF (Azul iOS)
```

### 🌓 Temas
```
Light Theme:
- Fundo: #FFFFFF
- Texto: #000000
- Bordas: #E0E0E0

Dark Theme:
- Fundo: #1A1A1A
- Texto: #FFFFFF
- Bordas: #333333
```

---

## 📱 TELAS ESPECÍFICAS

### 💰 CARTEIRA - WalletDetails
```
┌─────────────────────────────────────┐
│ 💰 MINHA CARTEIRA                  │
├─────────────────────────────────────┤
│ 💵 Saldo: R$ 150,00                │
├─────────────────────────────────────┤
│ ➕ Adicionar dinheiro               │
│ ➖ Sacar dinheiro                   │
│ 📊 Histórico                       │
├─────────────────────────────────────┤
│ 💳 PIX | 🏦 TED | 💳 Cartão        │
└─────────────────────────────────────┘
```

### ⚙️ CONFIGURAÇÕES - SettingsScreen
```
┌─────────────────────────────────────┐
│ ⚙️ CONFIGURAÇÕES                   │
├─────────────────────────────────────┤
│ 👤 Editar perfil                   │
│ 🔔 Notificações                    │
│ 🌓 Tema escuro/claro               │
│ 🌍 Idioma                          │
├─────────────────────────────────────┤
│ 🚗 Meus veículos                   │
│ 📊 Relatórios                      │
│ ❓ Ajuda                           │
│ 📞 Suporte                         │
└─────────────────────────────────────┘
```

### 📋 LISTA DE CORRIDAS - RideListPage
```
┌─────────────────────────────────────┐
│ 📋 MINHAS CORRIDAS                 │
├─────────────────────────────────────┤
│ 🚗 UberX - R$ 15,90                │
│ 📍 Casa → Trabalho                 │
│ ⏰ 15/07 - 08:30                   │
│ ✅ Concluída                       │
├─────────────────────────────────────┤
│ 🚙 Comfort - R$ 25,50              │
│ 📍 Shopping → Casa                 │
│ ⏰ 14/07 - 19:45                   │
│ ✅ Concluída                       │
└─────────────────────────────────────┘
```

---

## 🔄 FLUXOS DE NAVEGAÇÃO COMPLETOS

### 👤 FLUXO PASSAGEIRO
```
SplashScreen
    ↓
WelcomeScreen
    ↓
ProfileSelection (Passageiro)
    ↓
PhoneInputScreen
    ↓
PersonalDataScreen
    ↓
OTPScreen
    ↓
MapScreen (Tela Principal)
    ├─ SearchScreen
    ├─ RideListPage
    ├─ WalletDetails
    └─ SettingsScreen
        ├─ EditProfileScreen
        ├─ MyVehiclesScreen
        ├─ EarningsReportScreen
        └─ HelpScreen
```

### 🚗 FLUXO MOTORISTA
```
SplashScreen
    ↓
WelcomeScreen
    ↓
ProfileSelection (Motorista)
    ↓
PhoneInputScreen
    ↓
PersonalDataScreen
    ↓
DriverTermsScreen
    ↓
OTPScreen
    ↓
DriverDocumentsScreen
    ↓
CompleteRegistrationScreen
    ↓
DriverTrips (Tela Principal)
    ├─ DriverDashboardScreen
    ├─ BaaSAccountScreen
    ├─ WeeklyPaymentScreen
    ├─ PlanSelectionScreen
    └─ SettingsScreen
```

---

## 🎯 FUNCIONALIDADES PRINCIPAIS

### ✅ IMPLEMENTADAS
- ✅ Sistema de autenticação completo
- ✅ Mapa interativo (Google Maps)
- ✅ Busca de endereços (Google Places)
- ✅ Cálculo de tarifas em tempo real
- ✅ Pagamento PIX integrado
- ✅ Toggle passageiro/motorista
- ✅ Temas claro/escuro
- ✅ Suporte multilingue (10 idiomas)
- ✅ Sistema BaaS completo
- ✅ Rastreamento em tempo real
- ✅ Chat integrado
- ✅ Sistema de avaliações
- ✅ Relatórios detalhados

### 🚧 EM DESENVOLVIMENTO
- 🔄 Notificações push
- 🔄 Chat em tempo real avançado
- 🔄 Sistema de gamificação
- 🔄 Integração com mais gateways

---

## 📊 ESTATÍSTICAS DO APP

**Total de Telas**: 62
**Componentes**: 40+
**Linhas de Código**: ~50.000
**Idiomas**: 10
**Temas**: 2 (Claro/Escuro)
**Fluxos**: 2 (Passageiro/Motorista)

---

## 🎨 DESIGN HIGHLIGHTS

### ✨ CARACTERÍSTICAS
- **Design Moderno**: Interface limpa e intuitiva
- **Animações Suaves**: Transições fluidas
- **Responsivo**: Adapta-se a diferentes telas
- **Acessível**: Suporte a leitores de tela
- **Performance**: Otimizado para velocidade

### 🎯 UX/UI
- **Navegação Intuitiva**: Bottom tabs + Stack navigation
- **Feedback Visual**: Animações e estados de loading
- **Consistência**: Design system unificado
- **Acessibilidade**: Contraste adequado e tamanhos de fonte

---

## 🚀 PRÓXIMOS PASSOS

1. **Teste o app** no dispositivo
2. **Verifique a navegação** entre telas
3. **Teste o toggle** passageiro/motorista
4. **Avalie o design** e UX
5. **Dê feedback** para melhorias

**O app está pronto para testes completos! 🎉** 