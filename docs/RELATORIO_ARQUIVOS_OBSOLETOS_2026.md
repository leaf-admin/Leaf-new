# 📋 RELATÓRIO COMPLETO - ARQUIVOS OBSOLETOS/DEPRECATED

**Data da Análise:** 2026-01-XX  
**Método:** Análise sistemática do código-fonte  
**Critérios:** Arquivos sem referências diretas ou indiretas no código atual

---

## 📊 RESUMO EXECUTIVO

### Total de Arquivos Analisados
- **Arquivos Potencialmente Obsoletos:** ~223 arquivos
- **Arquivos Confirmados Obsoletos:** 96+ arquivos
- **Arquivos com Referências:** 17 arquivos (manter)
- **Arquivos para Analisar:** 111+ arquivos
- **Impacto da Remoção:** Baixo (apenas arquivos de build/logs/testes)

---

## ✅ CATEGORIA 1: ARQUIVOS DE ROTAS BACKEND (3 arquivos)

### Status: ⚠️ **ANALISAR ANTES DE REMOVER**

#### 1. `leaf-websocket-backend/routes/auth-routes-debug.js`
- **Tamanho:** 21 linhas
- **Função:** Rota de debug para autenticação
- **Referências encontradas:** 
  - ❌ Nenhuma referência no `server.js`
  - ❌ Nenhum import/require encontrado
  - ✅ Apenas mencionado em documentação (`docs/RELATORIO_LIMPEZA_FINAL.md`)
- **Status:** ⚠️ **PODE SER OBSOLETO** - Verificar se é usado em desenvolvimento

#### 2. `leaf-websocket-backend/routes/auth-routes-simple.js`
- **Tamanho:** 21 linhas
- **Função:** Rota simples de autenticação (teste)
- **Referências encontradas:**
  - ❌ Nenhuma referência no `server.js`
  - ❌ Nenhum import/require encontrado
  - ✅ Apenas mencionado em documentação (`docs/RELATORIO_LIMPEZA_FINAL.md`)
- **Status:** ⚠️ **PODE SER OBSOLETO** - Verificar se é usado em desenvolvimento

#### 3. `leaf-websocket-backend/routes/auth.js`
- **Tamanho:** 235 linhas
- **Função:** Rotas de autenticação alternativas
- **Referências encontradas:**
  - ✅ **USADO EM:** `routes/support.js` (linha 3)
  - ✅ **USADO EM:** `routes/admin-users.js` (linha 5)
  - ✅ Exporta `authenticateToken` e `authorizeRole`
- **Status:** ✅ **EM USO** - **NÃO REMOVER**

**Recomendação:** ⚠️ **MANTER** - Arquivo está sendo usado por outros módulos.

---

## ✅ CATEGORIA 2: ARQUIVOS DE BUILD E LOGS (68+ arquivos)

### Status: ✅ **SEGUROS PARA REMOVER**

#### Logs de Build (66 arquivos)
- `mobile-app/build-*.log` (30+ arquivos)
- `mobile-app/build-production-apk.log.old`
- `mobile-app/monitor-*.log` (5+ arquivos)
- `mobile-app/logs-device-*.log` (2 arquivos)
- `mobile-app/metro.log`
- `leaf-dashboard/dashboard.log`
- `leaf-websocket-backend/server*.log` (6 arquivos)

**Referências encontradas:**
- ❌ Nenhuma referência no código
- ✅ Arquivos gerados automaticamente
- ✅ Podem ser recriados a qualquer momento

**Impacto:** Nenhum - arquivos de log temporários

**Recomendação:** ✅ **REMOVER** - Adicionar ao `.gitignore`

---

#### Arquivos de Build Temporários (11 diretórios)
- `mobile-app/test-build/`
- `mobile-app/test-build-clean/`
- `mobile-app/test-build-debug/`
- `mobile-app/test-build-final/`
- `mobile-app/test-build-final-fixed/`
- `mobile-app/test-build-final-success/`
- `mobile-app/test-build-fixed-json/`
- `mobile-app/test-build-no-hermes/`
- `mobile-app/test-build-no-hermes-clean/`
- `mobile-app/test-build-no-pt-json/`
- `mobile-app/test-build-syntax-fixed/`

**Referências encontradas:**
- ❌ Nenhuma referência no código
- ✅ Diretórios de build de teste
- ✅ Podem ser recriados

**Impacto:** Nenhum - diretórios temporários de build

**Recomendação:** ✅ **REMOVER** - Adicionar ao `.gitignore`

---

#### Arquivos APK (15 arquivos)
- `mobile-app/leaf-app-dev-*.apk` (15 arquivos)
- `mobile-app/leaf-app-dev-review-*.apk` (múltiplos)

**Referências encontradas:**
- ❌ Nenhuma referência no código
- ✅ Arquivos binários de build
- ✅ Podem ser recriados

**Impacto:** Nenhum - arquivos binários de build

**Recomendação:** ✅ **REMOVER** - Adicionar ao `.gitignore`

---

## ✅ CATEGORIA 3: ARQUIVOS DE BACKUP E COMPRESSÃO (4 arquivos)

### Status: ✅ **SEGUROS PARA REMOVER**

#### 1. `leaf-websocket-backend/.env.backup.20251218_083038`
- **Tamanho:** Arquivo de backup
- **Referências encontradas:**
  - ✅ Mencionado em `scripts/maintenance/migration/migrate-to-vultr.sh` (script de migração)
  - ✅ Mencionado em `leaf-websocket-backend/scripts/test/test-production-local.sh`
- **Status:** ⚠️ **USADO EM SCRIPTS DE MIGRAÇÃO** - Verificar se scripts ainda são necessários

#### 2. `leaf-websocket-backend/leaf-optimizations-20250826_071621.tar.gz`
- **Tamanho:** Arquivo comprimido
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
- **Status:** ✅ **OBSOLETO** - Backup antigo

#### 3. `leaf-websocket-backend/leaf-ultra-deploy.tar.gz`
- **Tamanho:** Arquivo comprimido
- **Referências encontradas:**
  - ✅ Mencionado em `leaf-websocket-backend/scripts/deploy/deploy-to-vultr.sh`
- **Status:** ⚠️ **USADO EM SCRIPT DE DEPLOY** - Verificar se script ainda é usado

#### 4. `leaf-websocket-backend/leaf-websocket-backend.tar.gz`
- **Tamanho:** Arquivo comprimido
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
- **Status:** ✅ **OBSOLETO** - Backup antigo

**Recomendação:** 
- ✅ Remover `leaf-optimizations-*.tar.gz` e `leaf-websocket-backend.tar.gz`
- ⚠️ Verificar scripts antes de remover `.env.backup.*` e `leaf-ultra-deploy.tar.gz`

---

## ✅ CATEGORIA 4: ARQUIVOS DE CONFIGURAÇÃO ALTERNATIVOS (4 arquivos)

### Status: ⚠️ **ANALISAR ANTES DE REMOVER**

#### 1. `mobile-app/App.simple.js`
- **Tamanho:** 31 linhas
- **Função:** App simples para testes de build
- **Referências encontradas:**
  - ❌ Nenhuma referência no `index.js` (usa `App.js`)
  - ❌ Nenhum import/require encontrado
- **Status:** ✅ **OBSOLETO** - Não usado no build atual

#### 2. `mobile-app/app.config.simple.js`
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
- **Status:** ✅ **OBSOLETO**

#### 3. `mobile-app/app.config.expo-go.js`
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
- **Status:** ✅ **OBSOLETO**

#### 4. `mobile-app/app.config.simple-build.js`
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
- **Status:** ✅ **OBSOLETO**

**Recomendação:** ✅ **REMOVER** - Arquivos de configuração alternativos não usados

---

## ✅ CATEGORIA 5: ARQUIVOS DE REFERÊNCIA E ASSETS (4 arquivos)

### Status: ⚠️ **ANALISAR ANTES DE REMOVER**

#### 1. `landing-page/assets/referencia-files/Placeholder_Halfpage__24_-min.webp`
- **Referências encontradas:**
  - ✅ Mencionado em `landing-page/*.html` (6 arquivos)
- **Status:** ⚠️ **USADO NA LANDING PAGE** - Manter

#### 2. `landing-page/assets/referencia-files/Placeholder_Halfpage__25_-min.webp`
- **Referências encontradas:**
  - ✅ Mencionado em `landing-page/*.html` (6 arquivos)
- **Status:** ⚠️ **USADO NA LANDING PAGE** - Manter

#### 3. `referencia-99/` (diretório completo)
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
  - ✅ Diretório de referência do app 99
- **Status:** ✅ **OBSOLETO** - Diretório de referência não usado

**Recomendação:**
- ⚠️ Manter arquivos da landing-page (estão sendo usados)
- ✅ Remover diretório `referencia-99/`

---

## ✅ CATEGORIA 6: ARQUIVOS DE KEYSTORE E CERTIFICADOS (4 arquivos)

### Status: ⚠️ **MANTER - SEGURANÇA**

#### 1. `mobile-app/@freedom-tech-organization__leaf.jks`
- **Referências encontradas:**
  - ✅ Mencionado em documentação de build
  - ✅ Usado em scripts de build
- **Status:** ⚠️ **USADO EM BUILD** - Manter

#### 2. `mobile-app/leaf-production-release.keystore`
- **Referências encontradas:**
  - ✅ Mencionado em documentação de build
- **Status:** ⚠️ **USADO EM BUILD** - Manter

#### 3. `mobile-app/leaf-release-key.keystore`
- **Referências encontradas:**
  - ✅ Mencionado em documentação de build
- **Status:** ⚠️ **USADO EM BUILD** - Manter

#### 4. `mobile-app/android/app/debug.keystore`
- **Referências encontradas:**
  - ✅ Arquivo padrão do Android
- **Status:** ⚠️ **ARQUIVO PADRÃO** - Manter

**Recomendação:** ⚠️ **MANTER** - Arquivos de segurança necessários para builds

---

## ✅ CATEGORIA 7: ARQUIVOS DE TESTE E SCRIPTS (95+ arquivos)

### Status: ⚠️ **ANALISAR POR CATEGORIA**

#### Scripts de Build (30+ arquivos)
- `mobile-app/build-*.sh` (múltiplos)
- `mobile-app/test-*.sh` (múltiplos)
- `mobile-app/monitor-*.sh` (múltiplos)
- `mobile-app/install-*.sh` (múltiplos)
- `mobile-app/aguardar-*.sh` (múltiplos)
- `mobile-app/verificar-*.sh` (múltiplos)
- `mobile-app/fix-*.sh` (múltiplos)

**Referências encontradas:**
- ⚠️ Alguns podem ser usados em documentação
- ⚠️ Scripts de desenvolvimento/teste

**Recomendação:** ⚠️ **ANALISAR INDIVIDUALMENTE** - Alguns podem ser úteis para desenvolvimento

---

#### Arquivos de Teste JavaScript (20+ arquivos)
- `mobile-app/test-*.js` (múltiplos)
- `mobile-app/test-*.cjs` (múltiplos)

**Referências encontradas:**
- ⚠️ Scripts de teste podem ser úteis
- ⚠️ Verificar se são usados em documentação

**Recomendação:** ⚠️ **ANALISAR INDIVIDUALMENTE** - Manter se úteis para testes

---

## ✅ CATEGORIA 8: ARQUIVOS DE RELATÓRIOS E MÉTRICAS (18+ arquivos)

### Status: ✅ **SEGUROS PARA REMOVER**

#### Arquivos JSON de Relatórios
- `leaf-websocket-backend/validation-report-*.json` (18+ arquivos)
- `leaf-websocket-backend/capacity-report-*.json` (4 arquivos)
- `leaf-websocket-backend/stress-test-*.json` (3 arquivos)
- `leaf-websocket-backend/benchmark-results-*.json` (2 arquivos)

**Referências encontradas:**
- ✅ Mencionados em scripts de stress test
- ✅ Arquivos gerados automaticamente
- ✅ Podem ser recriados

**Status:** ✅ **OBSOLETOS** - Relatórios gerados automaticamente

**Recomendação:** ✅ **REMOVER** - Adicionar ao `.gitignore`

---

## ✅ CATEGORIA 9: ARQUIVOS DE PROCESSO (1 arquivo)

### Status: ✅ **SEGURO PARA REMOVER**

#### 1. `leaf-websocket-backend/server.pid`
- **Função:** Arquivo de PID do processo
- **Referências encontradas:**
  - ❌ Nenhuma referência no código
  - ✅ Arquivo gerado automaticamente
- **Status:** ✅ **OBSOLETO** - Arquivo temporário de processo

**Recomendação:** ✅ **REMOVER** - Adicionar ao `.gitignore`

---

## ✅ CATEGORIA 10: ARQUIVOS DE IMAGENS DE TESTE (7 arquivos)

### Status: ⚠️ **ANALISAR ANTES DE REMOVER**

#### Imagens de Screenshot/Documentação
- `mobile-app/01-app-launched.png`
- `mobile-app/02-login-screen.png`
- `mobile-app/03-phone-entered.png`
- `mobile-app/04-after-phone-check.png`
- `mobile-app/07-dashboard-visible.png`
- `mobile-app/app-loaded.png`
- `mobile-app/app-opened.png`

**Referências encontradas:**
- ✅ Mencionados em documentação (`COMO_FUNCIONA_TEMPO_REAL.md`, `VER_TELAS_TEMPO_REAL.md`, etc.)
- ⚠️ Usados para documentação visual

**Status:** ⚠️ **USADOS EM DOCUMENTAÇÃO** - Manter se documentação for importante

**Recomendação:** ⚠️ **MANTER** - Úteis para documentação visual

---

## ✅ CATEGORIA 11: ARQUIVOS DE FONTES (12 arquivos)

### Status: ⚠️ **MANTER - ASSETS DO APP**

#### Fontes Bold
- `mobile-app/assets/fonts/*-Bold*.ttf` (12 arquivos)

**Referências encontradas:**
- ⚠️ Fontes podem ser usadas no app
- ⚠️ Assets do aplicativo

**Status:** ⚠️ **ASSETS DO APP** - Verificar se são usadas

**Recomendação:** ⚠️ **MANTER** - Assets do aplicativo (verificar uso antes)

---

## ✅ CATEGORIA 12: SCRIPTS DE BACKUP (3 arquivos)

### Status: ⚠️ **MANTER - SCRIPTS ÚTEIS**

#### Scripts de Backup
- `scripts/maintenance/backup/redis-backup-automated.sh`
- `scripts/maintenance/backup/setup-backup-vps.sh`
- `scripts/maintenance/backup/setup-redis-backup-cron.sh`

**Referências encontradas:**
- ⚠️ Scripts de manutenção
- ⚠️ Podem ser úteis para produção

**Status:** ⚠️ **SCRIPTS DE MANUTENÇÃO** - Manter se úteis

**Recomendação:** ⚠️ **MANTER** - Scripts de manutenção podem ser úteis

---

## 📊 RESUMO POR CATEGORIA

| Categoria | Total | Obsoletos | Manter | Analisar |
|-----------|-------|-----------|--------|----------|
| **Rotas Backend** | 3 | 2 | 1 | 0 |
| **Build e Logs** | 66 | 66 | 0 | 0 |
| **Backup e Compressão** | 4 | 2 | 0 | 2 |
| **Configuração Alternativa** | 4 | 4 | 0 | 0 |
| **Referência e Assets** | 4 | 1 | 2 | 1 |
| **Keystore e Certificados** | 4 | 0 | 4 | 0 |
| **Teste e Scripts** | 95+ | 0 | 0 | 95+ |
| **Relatórios e Métricas** | 30 | 30 | 0 | 0 |
| **Processo** | 1 | 1 | 0 | 0 |
| **Imagens de Teste** | 7 | 0 | 7 | 0 |
| **Fontes** | 12 | 0 | 0 | 12 |
| **Scripts de Backup** | 3 | 0 | 3 | 0 |
| **TOTAL** | **223+** | **94+** | **16** | **113+** |

---

## 🎯 RECOMENDAÇÕES FINAIS

### ✅ REMOVER IMEDIATAMENTE (96+ arquivos)

1. **Logs de Build (66 arquivos)**
   - Todos os arquivos `*.log`
   - Adicionar ao `.gitignore`

2. **Diretórios de Build (11 diretórios)**
   - Todos os `test-build*`
   - Adicionar ao `.gitignore`

3. **Arquivos APK (15 arquivos)**
   - Todos os `*.apk` (exceto os necessários)
   - Adicionar ao `.gitignore`

4. **Relatórios Gerados (18+ arquivos)**
   - `validation-report-*.json`
   - `capacity-report-*.json`
   - `stress-test-*.json`
   - `benchmark-results-*.json`
   - Adicionar ao `.gitignore`

5. **Arquivos de Backup Antigos (2 arquivos)**
   - `leaf-optimizations-*.tar.gz`
   - `leaf-websocket-backend.tar.gz`

6. **Arquivos de Configuração Alternativos (4 arquivos)**
   - `App.simple.js`
   - `app.config.simple.js`
   - `app.config.expo-go.js`
   - `app.config.simple-build.js`

7. **Diretório de Referência (1 diretório)**
   - `referencia-99/`

8. **Arquivo de Processo (1 arquivo)**
   - `server.pid`
   - Adicionar ao `.gitignore`

**Total:** 96+ arquivos/diretórios seguros para remover

**Detalhamento:**
- Logs: 66 arquivos
- Diretórios de build: 11 diretórios
- APK: 15 arquivos
- Relatórios: 30 arquivos
- Backup antigos: 2 arquivos
- Configurações alternativas: 4 arquivos
- Diretório de referência: 1 diretório
- Arquivo de processo: 1 arquivo

---

### ⚠️ ANALISAR ANTES DE REMOVER (111+ arquivos)

1. **Rotas Backend (2 arquivos)**
   - Verificar se são usados em desenvolvimento
   - `auth-routes-debug.js` - ⚠️ Pode ser usado em desenvolvimento
   - `auth-routes-simple.js` - ⚠️ Pode ser usado em desenvolvimento
   - ~~`auth.js`~~ - ✅ **MANTER** (usado por `support.js` e `admin-users.js`)

2. **Scripts de Build/Teste (95+ arquivos)**
   - Analisar individualmente
   - Manter os úteis para desenvolvimento
   - Remover os obsoletos

3. **Fontes (12 arquivos)**
   - Verificar se são usadas no app
   - Manter se forem assets do app

4. **Arquivos de Backup (2 arquivos)**
   - Verificar se scripts ainda são usados
   - `.env.backup.*`
   - `leaf-ultra-deploy.tar.gz`

---

### ✅ MANTER (17 arquivos)

1. **Keystore e Certificados (4 arquivos)**
   - Necessários para builds
   - Arquivos de segurança

2. **Imagens de Documentação (7 arquivos)**
   - Úteis para documentação visual
   - Screenshots de referência

3. **Assets da Landing Page (2 arquivos)**
   - Usados na landing page
   - `Placeholder_Halfpage_*.webp`

4. **Scripts de Backup (3 arquivos)**
   - Úteis para manutenção
   - Scripts de produção

---

## 📈 IMPACTO DA REMOÇÃO

### Impacto Baixo (94+ arquivos)
- ✅ Logs e arquivos de build
- ✅ Relatórios gerados automaticamente
- ✅ Arquivos temporários
- ✅ Diretórios de build de teste

### Impacto Médio (113+ arquivos)
- ⚠️ Scripts de desenvolvimento/teste
- ⚠️ Arquivos de configuração alternativos
- ⚠️ Fontes e assets

### Impacto Alto (0 arquivos)
- ❌ Nenhum arquivo crítico identificado

---

## 🚀 PLANO DE AÇÃO RECOMENDADO

### Fase 1: Remoção Segura (94+ arquivos)
1. Criar backup do projeto
2. Remover arquivos de logs (68+)
3. Remover diretórios de build (11)
4. Remover arquivos APK (15)
5. Remover relatórios gerados (18+)
6. Remover arquivos de backup antigos (2)
7. Remover configurações alternativas (4)
8. Remover diretório de referência (1)
9. Remover arquivo de processo (1)
10. Atualizar `.gitignore`

**Tempo estimado:** ~30 minutos

### Fase 2: Análise e Remoção Seletiva (113+ arquivos)
1. Analisar scripts de build/teste
2. Verificar uso de fontes
3. Verificar rotas backend alternativas
4. Remover arquivos não utilizados

**Tempo estimado:** 2-3 horas

---

## 📝 CONCLUSÃO

### Arquivos Seguros para Remover: 96+ arquivos
- **Impacto:** Baixo
- **Risco:** Mínimo
- **Benefício:** Limpeza significativa do repositório

### Arquivos para Analisar: 111+ arquivos
- **Impacto:** Médio
- **Risco:** Baixo (com análise)
- **Benefício:** Limpeza adicional após análise

### Arquivos para Manter: 16 arquivos
- **Razão:** Necessários para builds, documentação ou manutenção

---

**Última atualização:** 2026-01-XX

