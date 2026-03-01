# ⚡ Início Rápido - Testes E2E

## 🎯 Execute seu Primeiro Teste em 3 Passos

### 1️⃣ Preparar
```bash
cd mobile-app
bash scripts/verify-maestro.sh
```

### 2️⃣ Executar Teste com Visualização
```bash
# Teste de login (mais simples)
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

### 3️⃣ Ver Resultados
```bash
# Ver screenshots e logs
bash scripts/view-test-results.sh
```

---

## 📸 O que você vai ver:

1. **Durante o teste:**
   - App abre automaticamente
   - Maestro interage com a tela
   - Screenshots são capturados

2. **Após o teste:**
   - Pasta com screenshots abre automaticamente
   - Logs mostram todas as ações
   - Resultados em XML

---

## 🎥 Ver Tela em Tempo Real

### Opção 1: Android Studio
1. Abra Android Studio
2. `Tools > Device Manager`
3. Clique no dispositivo
4. Veja a tela em tempo real

### Opção 2: ADB
```bash
# Ver tela do dispositivo
adb shell screenrecord /sdcard/screen.mp4
```

---

## 📚 Documentação Completa

- **`COMO_TESTAR_E_ANALISAR.md`** - Guia completo passo a passo
- **`.maestro/flows/README_TESTES_REAIS.md`** - Lista de testes disponíveis

---

## 🆘 Problemas?

```bash
# Verificar configuração
bash scripts/verify-maestro.sh

# Ver logs do último teste
cat .maestro/screenshots/test_*/test.log | tail -50
```

---

**Pronto! Agora você pode testar e analisar! 🚀**













