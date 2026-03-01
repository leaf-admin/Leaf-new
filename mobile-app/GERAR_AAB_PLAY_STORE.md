# 📱 GERAR AAB PARA PLAY STORE

**Data:** 29/01/2025  
**Status:** ✅ **CONFIGURAÇÕES ATUALIZADAS PARA PLAY STORE**

---

## ✅ VERIFICAÇÕES REALIZADAS

### **1. Target SDK Version**
- ✅ **targetSdkVersion: 35** (Atualizado - Play Store exige mínimo 33)
- ✅ **compileSdkVersion: 35** (Atualizado)
- ✅ **minSdkVersion: 24** (Android 7.0+)

### **2. Version Code e Version Name**
- ✅ **versionCode: 2** (Incrementado de 1 para 2)
- ✅ **versionName: "1.0.1"** (Atualizado de 1.0.0 para 1.0.1)

### **3. Assinatura de Produção**
- ✅ **Keystore**: `leaf-production-release.keystore`
- ✅ **Key Alias**: `leaf-production-key`
- ✅ **Signing Config**: Configurado para release builds

### **4. Permissões AndroidManifest.xml**
- ✅ Todas as permissões declaradas corretamente:
  - ACCESS_FINE_LOCATION ✅
  - ACCESS_COARSE_LOCATION ✅
  - ACCESS_BACKGROUND_LOCATION ✅
  - FOREGROUND_SERVICE ✅
  - FOREGROUND_SERVICE_LOCATION ✅
  - CAMERA ✅
  - INTERNET ✅
  - E mais...

### **5. EAS Build Configuration**
- ✅ **Profile Production**: Configurado para gerar AAB
- ✅ **buildType**: `app-bundle` ✅
- ✅ **gradleCommand**: `:app:bundleRelease` ✅

### **6. Configurações do App**
- ✅ **Package Name**: `br.com.leaf.ride` ✅
- ✅ **App Icon**: Configurado ✅
- ✅ **Adaptive Icon**: Configurado ✅
- ✅ **Hermes Engine**: Habilitado ✅

---

## 🚀 COMANDO PARA GERAR AAB

### **Opção 1: Build de Produção (Recomendado)**
```bash
cd mobile-app
npx eas build --platform android --profile production
```

Este comando vai:
1. ✅ Gerar AAB assinado para produção
2. ✅ Usar credenciais de produção do EAS
3. ✅ Build otimizado para Play Store
4. ✅ Upload automático para download

### **Opção 2: Build Local (Alternativa)**
```bash
cd mobile-app/android
./gradlew clean
./gradlew bundleRelease
```

**Arquivo gerado:**
- `app/build/outputs/bundle/release/app-release.aab`

**Limitação:** Precisa de keystore local configurado.

---

## 📋 EXIGÊNCIAS PLAY STORE - STATUS

| Exigência | Status | Detalhes |
|-----------|--------|----------|
| **Target SDK 33+** | ✅ | Target SDK 35 |
| **Version Code único** | ✅ | Version Code 2 |
| **AAB formato** | ✅ | Build type: app-bundle |
| **Assinatura de produção** | ✅ | Keystore configurado |
| **64-bit support** | ✅ | NDK configurado |
| **Permissões declaradas** | ✅ | AndroidManifest.xml |
| **Privacy Policy** | ✅ | Configurado em app.config.js |
| **Terms of Service** | ✅ | Configurado em app.config.js |
| **App Icon** | ✅ | 1024x1024px configurado |
| **Adaptive Icon** | ✅ | Configurado |

---

## 🔍 PRÓXIMOS PASSOS APÓS BUILD

1. **Download do AAB:**
   - Acessar: https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds
   - Baixar arquivo `.aab` gerado

2. **Upload para Play Console:**
   - Acessar: https://play.google.com/console
   - Ir em "Criar app" ou selecionar app existente
   - Upload do AAB na seção "Produção" ou "Teste interno"

3. **Preencher informações:**
   - Categoria do app
   - Descrição
   - Screenshots
   - Classificação de conteúdo
   - Dados de privacidade

4. **Enviar para revisão:**
   - Play Store revisa em 1-7 dias
   - Notificação quando aprovado

---

## 📝 NOTAS IMPORTANTES

1. **Version Code**: Deve ser único e sempre incrementar a cada release
2. **Version Name**: Pode ser qualquer string (ex: "1.0.1")
3. **Target SDK**: Deve ser atualizado anualmente conforme Play Store exige
4. **AAB vs APK**: Play Store aceita apenas AAB desde agosto 2021
5. **Assinatura**: EAS gerencia automaticamente as credenciais de produção

---

**Status:** ✅ **PRONTO PARA GERAR AAB**

Execute o comando:
```bash
cd mobile-app && npx eas build --platform android --profile production
```


