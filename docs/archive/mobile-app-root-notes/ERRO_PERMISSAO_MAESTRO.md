# 🔧 Erro: INSTALL_FAILED_USER_RESTRICTED

## ⚠️ Problema

O Maestro precisa instalar um app auxiliar no dispositivo, mas está sendo bloqueado:

```
INSTALL_FAILED_USER_RESTRICTED: Install canceled by user
```

---

## ✅ Solução: Habilitar Permissões

### Passo 1: Habilitar "Instalar via USB"

1. **No celular:**
   - Configurações > Opções do desenvolvedor
   - Ativar **"Instalar via USB"** ou **"Instalar aplicativos via USB"**

2. **Se não tiver "Opções do desenvolvedor":**
   - Configurações > Sobre o telefone
   - Toque 7x em **"Número da versão"**
   - Volte e procure "Opções do desenvolvedor"

### Passo 2: Permitir Fontes Desconhecidas

1. **Configurações > Segurança**
2. Ativar **"Fontes desconhecidas"** ou **"Instalar apps desconhecidos"**
3. Ou permitir para o app "ADB" / "Depuração USB"

### Passo 3: Verificar Popup no Celular

Quando executar o teste, pode aparecer um popup no celular pedindo permissão:
- ✅ **Aceite** a instalação
- ✅ Marque **"Sempre permitir"** se aparecer

---

## 🧪 Testar se Funcionou

```bash
cd mobile-app

# Executar script de correção
bash scripts/fix-maestro-permissions.sh

# Tentar teste novamente
npm run test:e2e:device .maestro/flows/test-simple-launch.yaml
```

---

## 📋 Checklist

- [ ] Opções do desenvolvedor habilitadas
- [ ] "Instalar via USB" ativado
- [ ] Fontes desconhecidas permitidas
- [ ] Tela do celular desbloqueada
- [ ] Aceitar popup de instalação (se aparecer)

---

## 🆘 Ainda Não Funciona?

### Verificar se há popup no celular

1. **Desbloqueie a tela**
2. **Mantenha a tela ligada**
3. **Execute o teste novamente**
4. **Observe se aparece popup** pedindo permissão

### Verificar marca do celular

Algumas marcas (Xiaomi, Huawei, etc.) têm restrições extras:

**Xiaomi (Redmi):**
- Configurações > Opções do desenvolvedor
- Ativar **"Instalar via USB"**
- Configurações > Apps > Gerenciar apps > Especial > Acesso à instalação
- Permitir para **"ADB"** ou **"Depuração USB"**

**Huawei:**
- Configurações > Segurança
- Permitir instalação de apps desconhecidos
- Configurações > Opções do desenvolvedor
- Ativar "Instalar via USB"

---

## 🎯 Depois de Configurar

```bash
# Testar novamente
npm run test:e2e:device .maestro/flows/test-simple-launch.yaml
```

**Se ainda não funcionar, verifique se há popup no celular pedindo permissão!**













