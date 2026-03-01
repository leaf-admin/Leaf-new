# ✅ Erro Corrigido: --device não existe

## 🐛 Problema

O Maestro não aceita a opção `--device` na linha de comando.

**Erro:**
```
Unknown option: '--device'
```

## ✅ Solução

O Maestro usa a **variável de ambiente `ANDROID_SERIAL`** para especificar qual dispositivo usar.

### Como Funciona

Quando há múltiplos dispositivos conectados, o Maestro usa:
1. A variável `ANDROID_SERIAL` (se definida)
2. O primeiro dispositivo da lista (se não definida)

### Script Corrigido

O script `run-test-device.sh` agora:
1. Detecta o dispositivo automaticamente
2. Define `ANDROID_SERIAL` antes de executar
3. Executa o teste sem a opção `--device`

## 🚀 Como Usar Agora

### Opção 1: Script Completo (Recomendado)

```bash
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml
```

### Opção 2: Script Simplificado

```bash
npm run test:device .maestro/flows/auth/01-login-customer-real.yaml
```

### Opção 3: Manual

```bash
# Definir dispositivo
export ANDROID_SERIAL=8DZLY9XSJZLVDAX8

# Executar teste
maestro test .maestro/flows/auth/01-login-customer-real.yaml
```

## ✅ Status

**Teste funcionando!** ✅

O Maestro está executando no seu dispositivo físico e você pode ver cada ação acontecendo na tela do celular!













