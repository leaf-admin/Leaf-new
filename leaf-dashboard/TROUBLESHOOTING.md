# Troubleshooting - Leaf Dashboard

## Problemas Comuns e Soluções

### 1. Erros de Importação do TypeScript

**Problema:** `Cannot find module 'lucide-react'` ou `Cannot find module 'react-dom/client'`

**Solução:**
```bash
# Limpar cache e reinstalar dependências
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### 2. Erros do Tailwind CSS

**Problema:** `Unknown at rule @tailwind` ou `Unknown at rule @apply`

**Solução:**
- Instalar a extensão "Tailwind CSS IntelliSense" no VS Code
- Verificar se o arquivo `.vscode/settings.json` está configurado corretamente
- Reiniciar o VS Code após instalar a extensão

### 3. Problemas com React Scripts

**Problema:** Servidor não inicia ou erros de compilação

**Solução:**
```bash
# Verificar versão do Node.js (recomendado: 16+)
node --version

# Limpar cache do React Scripts
npx react-scripts --version
```

### 4. Scripts de Correção Automática

**Para Windows (Prompt de Comando):**
```batch
fix-dashboard.bat
```

**Para Windows (PowerShell):**
```powershell
.\fix-dashboard.ps1
```

**Para diagnóstico:**
```batch
diagnose-dashboard.bat
```

### 5. Verificações Manuais

1. **Verificar dependências:**
   ```bash
   npm list --depth=0
   ```

2. **Verificar TypeScript:**
   ```bash
   npx tsc --noEmit
   ```

3. **Verificar Tailwind:**
   ```bash
   npx tailwindcss --help
   ```

### 6. Configurações do VS Code

Certifique-se de ter as seguintes extensões instaladas:
- Tailwind CSS IntelliSense
- TypeScript Importer
- ES7+ React/Redux/React-Native snippets

### 7. Problemas de Porta

**Problema:** Porta 3000 já está em uso

**Solução:**
```bash
# Verificar processos na porta 3000
netstat -ano | findstr :3000

# Matar processo se necessário
taskkill /PID <PID> /F
```

### 8. Problemas de Cache

**Solução completa:**
```bash
# Limpar todos os caches
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
npm start
```

## Contato

Se os problemas persistirem, verifique:
1. Versão do Node.js (recomendado: 16+)
2. Versão do npm (recomendado: 8+)
3. Logs de erro completos no console 

## Problemas Comuns e Soluções

### 1. Erros de Importação do TypeScript

**Problema:** `Cannot find module 'lucide-react'` ou `Cannot find module 'react-dom/client'`

**Solução:**
```bash
# Limpar cache e reinstalar dependências
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### 2. Erros do Tailwind CSS

**Problema:** `Unknown at rule @tailwind` ou `Unknown at rule @apply`

**Solução:**
- Instalar a extensão "Tailwind CSS IntelliSense" no VS Code
- Verificar se o arquivo `.vscode/settings.json` está configurado corretamente
- Reiniciar o VS Code após instalar a extensão

### 3. Problemas com React Scripts

**Problema:** Servidor não inicia ou erros de compilação

**Solução:**
```bash
# Verificar versão do Node.js (recomendado: 16+)
node --version

# Limpar cache do React Scripts
npx react-scripts --version
```

### 4. Scripts de Correção Automática

**Para Windows (Prompt de Comando):**
```batch
fix-dashboard.bat
```

**Para Windows (PowerShell):**
```powershell
.\fix-dashboard.ps1
```

**Para diagnóstico:**
```batch
diagnose-dashboard.bat
```

### 5. Verificações Manuais

1. **Verificar dependências:**
   ```bash
   npm list --depth=0
   ```

2. **Verificar TypeScript:**
   ```bash
   npx tsc --noEmit
   ```

3. **Verificar Tailwind:**
   ```bash
   npx tailwindcss --help
   ```

### 6. Configurações do VS Code

Certifique-se de ter as seguintes extensões instaladas:
- Tailwind CSS IntelliSense
- TypeScript Importer
- ES7+ React/Redux/React-Native snippets

### 7. Problemas de Porta

**Problema:** Porta 3000 já está em uso

**Solução:**
```bash
# Verificar processos na porta 3000
netstat -ano | findstr :3000

# Matar processo se necessário
taskkill /PID <PID> /F
```

### 8. Problemas de Cache

**Solução completa:**
```bash
# Limpar todos os caches
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
npm start
```

## Contato

Se os problemas persistirem, verifique:
1. Versão do Node.js (recomendado: 16+)
2. Versão do npm (recomendado: 8+)
3. Logs de erro completos no console 

## Problemas Comuns e Soluções

### 1. Erros de Importação do TypeScript

**Problema:** `Cannot find module 'lucide-react'` ou `Cannot find module 'react-dom/client'`

**Solução:**
```bash
# Limpar cache e reinstalar dependências
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### 2. Erros do Tailwind CSS

**Problema:** `Unknown at rule @tailwind` ou `Unknown at rule @apply`

**Solução:**
- Instalar a extensão "Tailwind CSS IntelliSense" no VS Code
- Verificar se o arquivo `.vscode/settings.json` está configurado corretamente
- Reiniciar o VS Code após instalar a extensão

### 3. Problemas com React Scripts

**Problema:** Servidor não inicia ou erros de compilação

**Solução:**
```bash
# Verificar versão do Node.js (recomendado: 16+)
node --version

# Limpar cache do React Scripts
npx react-scripts --version
```

### 4. Scripts de Correção Automática

**Para Windows (Prompt de Comando):**
```batch
fix-dashboard.bat
```

**Para Windows (PowerShell):**
```powershell
.\fix-dashboard.ps1
```

**Para diagnóstico:**
```batch
diagnose-dashboard.bat
```

### 5. Verificações Manuais

1. **Verificar dependências:**
   ```bash
   npm list --depth=0
   ```

2. **Verificar TypeScript:**
   ```bash
   npx tsc --noEmit
   ```

3. **Verificar Tailwind:**
   ```bash
   npx tailwindcss --help
   ```

### 6. Configurações do VS Code

Certifique-se de ter as seguintes extensões instaladas:
- Tailwind CSS IntelliSense
- TypeScript Importer
- ES7+ React/Redux/React-Native snippets

### 7. Problemas de Porta

**Problema:** Porta 3000 já está em uso

**Solução:**
```bash
# Verificar processos na porta 3000
netstat -ano | findstr :3000

# Matar processo se necessário
taskkill /PID <PID> /F
```

### 8. Problemas de Cache

**Solução completa:**
```bash
# Limpar todos os caches
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
npm start
```

## Contato

Se os problemas persistirem, verifique:
1. Versão do Node.js (recomendado: 16+)
2. Versão do npm (recomendado: 8+)
3. Logs de erro completos no console 