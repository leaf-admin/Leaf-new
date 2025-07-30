# 🎨 GUIA DE DESENVOLVIMENTO DE DESIGN - TEMPO REAL

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: ✅ **SERVIDOR ATIVO**

---

## 🚀 **SERVIDOR DE DESENVOLVIMENTO ATIVO**

### **✅ Status Atual**
- ✅ Dispositivo conectado: `irsgaiscr4j7cenv`
- ✅ Dependências atualizadas
- ✅ Servidor Expo iniciado com `--dev-client --clear`

---

## 📱 **COMO USAR**

### **🔗 Conectar ao Dispositivo**
1. **Abrir Expo Go** no seu dispositivo Android
2. **Escanear o QR code** que aparece no terminal
3. **Ou pressionar 'a'** no terminal para abrir automaticamente

### **🎨 Trabalhar no Design**
1. **Editar arquivos** no VS Code/Cursor
2. **Salvar** (Ctrl+S)
3. **Ver mudanças** automaticamente no dispositivo
4. **Hot reload** ativo - sem necessidade de rebuild

---

## 📂 **ARQUIVOS PRINCIPAIS PARA DESIGN**

### **🎨 Componentes de UI**
```bash
mobile-app/src/components/
├── ProfileToggle.js          # Toggle passageiro/motorista
├── ThemeSwitch.js           # Switch tema claro/escuro
├── CustomButton.js          # Botões customizados
├── LoadingSpinner.js        # Spinners de carregamento
└── ...
```

### **📱 Telas Principais**
```bash
mobile-app/src/screens/
├── MapScreen.js             # Tela principal do mapa
├── ProfileToggleTestScreen.js # Tela de teste do toggle
├── LoginScreen.js           # Tela de login
├── SettingsScreen.js        # Configurações
└── ...
```

### **🎨 Estilos e Temas**
```bash
mobile-app/src/
├── config/AppConfig.js      # Configurações do app
├── utils/theme.js           # Sistema de temas
└── assets/                  # Imagens e ícones
```

---

## 🎯 **FOCOS DE DESIGN ATUAL**

### **🔄 Toggle Dual-Role (Beta)**
- **Arquivo**: `mobile-app/src/components/ProfileToggle.js`
- **Teste**: `mobile-app/src/screens/ProfileToggleTestScreen.js`
- **Status**: ✅ Implementado, precisa de refinamento visual

### **🎨 Sistema de Temas**
- **Arquivo**: `mobile-app/src/utils/theme.js`
- **Status**: ✅ Implementado, pode ser expandido

### **📱 Layout Principal**
- **Arquivo**: `mobile-app/src/screens/MapScreen.js`
- **Status**: 🔄 Em desenvolvimento

---

## 🛠️ **COMANDOS ÚTEIS**

### **🚀 Desenvolvimento**
```bash
# Iniciar servidor (já ativo)
npx expo start --dev-client --clear

# Reiniciar servidor
npx expo start --dev-client --clear

# Ver logs em tempo real
npx expo start --dev-client --clear --tunnel
```

### **📱 Dispositivo**
```bash
# Ver dispositivos conectados
adb devices

# Ver logs do dispositivo
adb logcat | grep "Expo"

# Instalar Expo Go (se necessário)
# Baixar do Google Play Store
```

### **🔧 Debug**
```bash
# Limpar cache
npx expo start --clear

# Reset completo
npx expo start --clear --reset-cache
```

---

## 🎨 **DICAS DE DESIGN**

### **📱 Mobile-First**
- Usar `Dimensions.get('window')` para responsividade
- Testar em diferentes tamanhos de tela
- Considerar notch e safe areas

### **🎨 Componentes Reutilizáveis**
- Criar componentes em `src/components/`
- Usar props para customização
- Manter consistência visual

### **🌙 Dark/Light Theme**
- Usar `useColorScheme()` do React Native
- Definir cores em `theme.js`
- Testar ambos os temas

### **⚡ Performance**
- Usar `React.memo()` para componentes pesados
- Evitar re-renders desnecessários
- Otimizar imagens e assets

---

## 🔄 **WORKFLOW DE DESENVOLVIMENTO**

### **1. Editar Código**
```javascript
// Exemplo: editar ProfileToggle.js
const ProfileToggle = ({ userId, onModeChange, style = 'discrete' }) => {
  // Fazer mudanças aqui
  return (
    <TouchableOpacity style={styles.toggle}>
      {/* Mudanças aparecem automaticamente */}
    </TouchableOpacity>
  );
};
```

### **2. Salvar Arquivo**
- Ctrl+S no VS Code/Cursor
- Mudanças aparecem instantaneamente no dispositivo

### **3. Testar no Dispositivo**
- Interagir com as mudanças
- Verificar comportamento
- Ajustar se necessário

### **4. Iterar**
- Fazer mais mudanças
- Salvar novamente
- Ver resultados em tempo real

---

## 🎯 **PRÓXIMOS PASSOS DE DESIGN**

### **🔄 Toggle Dual-Role**
- [ ] Refinar animações
- [ ] Melhorar feedback visual
- [ ] Adicionar ícones específicos
- [ ] Testar em diferentes temas

### **📱 MapScreen**
- [ ] Melhorar layout do header
- [ ] Adicionar botões de ação
- [ ] Refinar mapa e controles
- [ ] Implementar drawer/sidebar

### **🎨 Sistema de Temas**
- [ ] Expandir paleta de cores
- [ ] Adicionar mais componentes temáticos
- [ ] Implementar transições suaves
- [ ] Testar acessibilidade

### **📋 Componentes Gerais**
- [ ] Criar biblioteca de componentes
- [ ] Padronizar botões e inputs
- [ ] Implementar loading states
- [ ] Adicionar feedback tátil

---

## 🚨 **TROUBLESHOOTING**

### **❌ Mudanças não aparecem**
```bash
# Reiniciar servidor
npx expo start --clear

# Verificar conexão
adb devices

# Recarregar app no dispositivo
# Puxar para baixo na tela do Expo Go
```

### **❌ Dispositivo desconectado**
```bash
# Reconectar USB
# Verificar depuração USB
adb devices

# Reiniciar ADB
adb kill-server && adb start-server
```

### **❌ Erro de build**
```bash
# Limpar cache
npx expo start --clear --reset-cache

# Verificar dependências
npx expo install --fix
```

---

## 📞 **SUPORTE**

### **🔧 Problemas Técnicos**
1. Verificar se dispositivo está conectado
2. Reiniciar servidor Expo
3. Limpar cache se necessário
4. Verificar logs do dispositivo

### **🎨 Problemas de Design**
1. Testar em diferentes tamanhos
2. Verificar temas claro/escuro
3. Validar acessibilidade
4. Otimizar performance

**🎉 Agora você pode trabalhar no design em tempo real!**

**💡 Dica**: Mantenha o terminal aberto para ver logs e status do servidor. 