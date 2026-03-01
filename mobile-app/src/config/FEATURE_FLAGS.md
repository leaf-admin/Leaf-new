# 🚩 Feature Flags - Documentação

Sistema de Feature Flags para gerenciar funcionalidades da aplicação de forma centralizada.

## 📁 Arquivos

- `mobile-app/src/services/FeatureFlagService.js` - Serviço principal
- `mobile-app/src/config/kycConfig.js` - Helpers específicos para KYC
- `mobile-app/src/hooks/useFeatureFlag.js` - Hook React para usar flags

## 🚀 Como Usar

### Opção 1: Helper Functions (Recomendado para KYC)

```javascript
import { isKYCEnabled, enableKYC, disableKYC } from '../config/kycConfig';

// Verificar se KYC está habilitado
const enabled = await isKYCEnabled();

if (enabled) {
  // KYC está habilitado
} else {
  // KYC está desabilitado (bypass)
}

// Habilitar KYC
await enableKYC();

// Desabilitar KYC
await disableKYC();
```

### Opção 2: Hook React (Recomendado para componentes)

```javascript
import useFeatureFlag from '../hooks/useFeatureFlag';

function MyComponent() {
  const kycEnabled = useFeatureFlag('KYC_ENABLED', false);
  
  if (kycEnabled) {
    return <KYCVerificationScreen />;
  } else {
    return <DirectOnlineButton />;
  }
}
```

### Opção 3: Serviço Direto (Para casos avançados)

```javascript
import featureFlagService from '../services/FeatureFlagService';

// Obter flag
const enabled = await featureFlagService.getFlag('KYC_ENABLED', false);

// Definir flag
await featureFlagService.setFlag('KYC_ENABLED', true);

// Obter todas as flags
const allFlags = await featureFlagService.getAllFlags();

// Adicionar listener para mudanças
const removeListener = featureFlagService.addListener('KYC_ENABLED', (newValue, oldValue) => {
  console.log(`KYC mudou de ${oldValue} para ${newValue}`);
});

// Remover listener
removeListener();
```

## 🎯 Feature Flags Disponíveis

### KYC_ENABLED
- **Descrição**: Habilita/desabilita verificação KYC antes de ficar online
- **Valor padrão**: `false` (desabilitado)
- **Uso**: Controla se o motorista precisa passar pela verificação KYC

## ➕ Adicionar Nova Feature Flag

1. **Adicionar no FeatureFlagService.js**:

```javascript
this.defaultFlags = {
  KYC_ENABLED: false,
  MINHA_NOVA_FLAG: true, // ← Adicione aqui
};
```

2. **Usar no código**:

```javascript
import featureFlagService from '../services/FeatureFlagService';

const minhaFlag = await featureFlagService.getFlag('MINHA_NOVA_FLAG', true);
```

## 🔄 Inicialização

O FeatureFlagService é inicializado automaticamente no `AppCommon.js` quando o app inicia. Não é necessário inicializar manualmente.

## 💾 Cache

As flags são armazenadas em AsyncStorage para persistência entre sessões. O cache é atualizado automaticamente quando uma flag é modificada.

## 🔮 Futuro: Firebase Remote Config

O sistema está preparado para integração com Firebase Remote Config. Quando necessário, basta implementar o método `fetchRemoteFlags()` no `FeatureFlagService.js`.

## 📝 Exemplo Completo

```javascript
// Em um componente
import { isKYCEnabled } from '../config/kycConfig';

const toggleOnlineStatus = async () => {
  const kycEnabled = await isKYCEnabled();
  
  if (kycEnabled) {
    // Abrir verificação KYC
    navigation.navigate('KYCVerification', {
      onSuccess: () => goOnline()
    });
  } else {
    // Bypass - ficar online direto
    await goOnline();
  }
};
```

## 🛠️ Debug

Para ver todas as flags ativas:

```javascript
import featureFlagService from '../services/FeatureFlagService';

const allFlags = await featureFlagService.getAllFlags();
console.log('Flags ativas:', allFlags);
```

Para resetar todas as flags para valores padrão:

```javascript
await featureFlagService.resetFlags();
```


