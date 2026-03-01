# 🚀 Guia de Build de Release - Leaf App

## Build de Release Funcional

Este guia explica como criar uma build de release funcional para testes com motorista em outro aparelho.

### Pré-requisitos

1. **Node.js e npm** instalados
2. **Android SDK** configurado
3. **Java JDK** (versão 11 ou superior)
4. **Expo CLI** instalado globalmente: `npm install -g expo-cli`

### Método 1: Script Automatizado (Recomendado)

```bash
cd mobile-app
./build-release-functional.sh
```

O script irá:
- ✅ Verificar dependências
- ✅ Limpar builds anteriores
- ✅ Gerar bundle JavaScript
- ✅ Compilar APK de release
- ✅ Criar APK com timestamp: `leaf-app-release-YYYYMMDD-HHMMSS.apk`

### Método 2: Build Manual

```bash
cd mobile-app

# 1. Limpar builds anteriores
cd android
./gradlew clean
cd ..

# 2. Gerar bundle JavaScript
npx expo export --platform android --output-dir android/app/src/main/assets/ --clear

# 3. Compilar APK
cd android
./gradlew assembleRelease
cd ..

# 4. APK estará em: android/app/build/outputs/apk/release/app-release.apk
```

### Instalação no Dispositivo

#### Via ADB (Recomendado)

```bash
# Listar dispositivos conectados
adb devices

# Instalar APK
adb install -r leaf-app-release-YYYYMMDD-HHMMSS.apk

# Para múltiplos dispositivos
adb -s <DEVICE_ID> install -r leaf-app-release-YYYYMMDD-HHMMSS.apk
```

#### Via Transferência Manual

1. Copie o arquivo `.apk` para o celular
2. Abra o arquivo no celular
3. Permita instalação de fontes desconhecidas se solicitado
4. Instale o aplicativo

### Testes Recomendados

Com a nova build, teste:

1. **Modal de Cancelamento:**
   - ✅ Solicitar uma corrida
   - ✅ Clicar em "Cancelar" durante a busca
   - ✅ Verificar modal: "Tem certeza que deseja cancelar?"
   - ✅ Testar botão "Desejo aguardar" (deve continuar busca)
   - ✅ Testar botão "Sim, cancelar" (deve mostrar mensagem de reembolso)

2. **Timer de Busca:**
   - ✅ Verificar que timer continua de onde parou após "Desejo aguardar"
   - ✅ Verificar que timer reseta ao cancelar

3. **Sincronização de Eventos:**
   - ✅ Passageiro solicita corrida → Motorista recebe notificação
   - ✅ Motorista aceita → Passageiro vê motorista a caminho
   - ✅ Motorista chega → Passageiro vê "Motorista chegou"
   - ✅ Início da corrida → Ambos veem rota em tempo real
   - ✅ Fim da corrida → Ambos veem confirmação

4. **Telas e UI:**
   - ✅ Verificar todas as telas do fluxo
   - ✅ Verificar responsividade
   - ✅ Verificar animações e transições

### Troubleshooting

#### Erro: "Bundle JavaScript não foi gerado"

```bash
# Limpar cache e tentar novamente
rm -rf .expo
rm -rf node_modules/.cache
npx expo export --platform android --output-dir android/app/src/main/assets/ --clear
```

#### Erro: "Gradle build failed"

```bash
# Limpar projeto Android
cd android
./gradlew clean
cd ..

# Tentar novamente
cd android
./gradlew assembleRelease
```

#### APK muito grande

O APK pode ter ~50-100MB dependendo dos assets. Isso é normal para um app React Native com Expo.

### Estrutura do APK Gerado

```
leaf-app-release-YYYYMMDD-HHMMSS.apk
├── Bundle JavaScript (incluindo todas as alterações)
├── Assets (imagens, fontes, etc.)
├── Native modules
└── Configurações do app
```

### Notas Importantes

- ⚠️ Esta build usa keystore de debug (apenas para testes)
- ⚠️ Para produção na Play Store, use keystore de produção
- ✅ Todas as novas alterações estão incluídas:
  - Modal de cancelamento
  - Timer de busca
  - Mensagem de reembolso
  - Sincronização de eventos

### Próximos Passos

Após testar:
1. Reportar bugs encontrados
2. Validar sincronização de eventos
3. Testar em diferentes dispositivos
4. Preparar build de produção para Play Store


