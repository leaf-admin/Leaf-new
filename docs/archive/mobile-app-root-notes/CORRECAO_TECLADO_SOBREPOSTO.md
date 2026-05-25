# 🔧 CORREÇÃO: Teclado Sobreposto ao Card

## ✅ Alterações Aplicadas

### 1. **AndroidManifest.xml**
Mudado de `adjustPan` para `adjustNothing`:
```xml
android:windowSoftInputMode="adjustNothing"
```

**Comportamento:**
- `adjustNothing`: Nada é ajustado, teclado sobrepõe tudo
- `adjustPan`: Move a view para cima (não queremos isso)
- `adjustResize`: Redimensiona a view (não queremos isso)

### 2. **PassengerUI.js**
- Removido import do `Keyboard` (não necessário)
- Adicionado comentário no container explicando o comportamento

## 🎯 Comportamento Esperado

- ✅ Teclado aparece **SOBREPOSTO** ao card de preço
- ✅ Card permanece **FIXO** na posição original (bottom: 93)
- ✅ Nada se move quando o teclado abre

## 📱 Para Aplicar as Mudanças

**IMPORTANTE:** Mudanças no `AndroidManifest.xml` requerem **rebuild completo** do app:

```bash
cd mobile-app
# Limpar build anterior
cd android
./gradlew clean
cd ..

# Rebuild
npx react-native run-android
```

Ou gere um novo APK.

## ⚠️ Se Ainda Não Funcionar

Se o card ainda estiver subindo, pode ser que:

1. **Há algum KeyboardAvoidingView** em um componente pai (NewMapScreen)
2. **Há algum listener de teclado** ajustando posições dinamicamente
3. **O React Native está usando comportamento padrão** que precisa ser sobrescrito

**Solução adicional:** Adicionar `android:windowSoftInputMode="adjustNothing"` também pode precisar ser configurado no `app.json` ou `app.config.js` do Expo.

---

**Data:** 2025-01-06
**Status:** Implementado - requer rebuild



