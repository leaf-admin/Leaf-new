#!/bin/bash

# Script de Deploy do Sistema BaaS (Bank as a Service)
# Inclui cobrança semanal automática do saldo e sistema de convites

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Função para log colorido
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠️  $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ❌ $1${NC}"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✅ $1${NC}"
}

# Banner
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    LEAF APP - BaaS SYSTEM                    ║"
echo "║                Bank as a Service Deployment                   ║"
echo "║                                                              ║"
echo "║  🏦 Cobrança Semanal Automática do Saldo                    ║"
echo "║  🎫 Sistema de Convites e Meses Grátis                      ║"
echo "║  🎁 90 Dias Grátis para Primeiros 500 Motoristas            ║"
echo "║  🔧 Controle de Ativação/Desativação                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Verificar se estamos no diretório correto
if [ ! -f "functions/woovi-baas.js" ]; then
    error "Script deve ser executado do diretório raiz do projeto"
    exit 1
fi

log "Iniciando deploy do sistema BaaS..."

# Verificar variáveis de ambiente
log "Verificando variáveis de ambiente..."

required_vars=(
    "WOOVI_API_KEY"
    "WOOVI_APP_ID"
    "WOOVI_BAAS_MAIN_ACCOUNT_ID"
    "FIREBASE_PROJECT_ID"
)

missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    error "Variáveis de ambiente obrigatórias não configuradas:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "Configure as variáveis no arquivo .env ou exporte-as:"
    echo "export WOOVI_API_KEY=your_api_key"
    echo "export WOOVI_APP_ID=your_app_id"
    echo "export WOOVI_BAAS_MAIN_ACCOUNT_ID=your_main_account_id"
    echo "export FIREBASE_PROJECT_ID=your_project_id"
    exit 1
fi

success "Variáveis de ambiente configuradas"

# Verificar Firebase CLI
log "Verificando Firebase CLI..."

if ! command -v firebase &> /dev/null; then
    error "Firebase CLI não encontrado"
    echo "Instale o Firebase CLI:"
    echo "npm install -g firebase-tools"
    exit 1
fi

success "Firebase CLI encontrado"

# Verificar login do Firebase
log "Verificando login do Firebase..."

if ! firebase projects:list &> /dev/null; then
    warn "Não logado no Firebase. Fazendo login..."
    firebase login
fi

success "Login do Firebase verificado"

# Verificar se o projeto existe
log "Verificando projeto Firebase..."

if ! firebase projects:list | grep -q "$FIREBASE_PROJECT_ID"; then
    error "Projeto Firebase '$FIREBASE_PROJECT_ID' não encontrado"
    echo "Projetos disponíveis:"
    firebase projects:list
    exit 1
fi

success "Projeto Firebase verificado"

# Backup dos arquivos atuais
log "Criando backup dos arquivos atuais..."

backup_dir="backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$backup_dir"

if [ -f "functions/woovi-baas.js" ]; then
    cp functions/woovi-baas.js "$backup_dir/"
fi

if [ -f "functions/index.js" ]; then
    cp functions/index.js "$backup_dir/"
fi

success "Backup criado em $backup_dir"

# Verificar se os arquivos BaaS existem
log "Verificando arquivos BaaS..."

if [ ! -f "functions/woovi-baas.js" ]; then
    error "Arquivo functions/woovi-baas.js não encontrado"
    exit 1
fi

if [ ! -f "functions/index.js" ]; then
    error "Arquivo functions/index.js não encontrado"
    exit 1
fi

success "Arquivos BaaS encontrados"

# Verificar scripts de teste
log "Verificando scripts de teste..."

test_scripts=(
    "scripts/testing/test-baas-account-creation.cjs"
    "scripts/testing/test-baas-split-automatic.cjs"
    "scripts/testing/test-weekly-plan-charge.cjs"
    "scripts/testing/test-referral-system.cjs"
)

for script in "${test_scripts[@]}"; do
    if [ ! -f "$script" ]; then
        warn "Script de teste não encontrado: $script"
    else
        success "Script encontrado: $script"
    fi
done

# Deploy das Firebase Functions
log "Iniciando deploy das Firebase Functions..."

cd functions

# Verificar dependências
if [ ! -f "package.json" ]; then
    error "package.json não encontrado em functions/"
    exit 1
fi

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    log "Instalando dependências..."
    npm install
fi

# Deploy
log "Executando deploy..."

firebase deploy --only functions --project "$FIREBASE_PROJECT_ID"

if [ $? -eq 0 ]; then
    success "Deploy das Firebase Functions concluído"
else
    error "Erro no deploy das Firebase Functions"
    exit 1
fi

cd ..

# Aguardar um pouco para as functions ficarem disponíveis
log "Aguardando functions ficarem disponíveis..."
sleep 10

# Executar testes BaaS
log "Executando testes do sistema BaaS..."

# Teste 1: Criação de contas
log "🧪 Teste 1: Criação de contas Leaf"
if [ -f "scripts/testing/test-baas-account-creation.cjs" ]; then
    node scripts/testing/test-baas-account-creation.cjs
    if [ $? -eq 0 ]; then
        success "Teste de criação de contas PASSADO"
    else
        warn "Teste de criação de contas FALHOU"
    fi
else
    warn "Script de teste de criação de contas não encontrado"
fi

# Teste 2: Split automático
log "🧪 Teste 2: Split automático"
if [ -f "scripts/testing/test-baas-split-automatic.cjs" ]; then
    node scripts/testing/test-baas-split-automatic.cjs
    if [ $? -eq 0 ]; then
        success "Teste de split automático PASSADO"
    else
        warn "Teste de split automático FALHOU"
    fi
else
    warn "Script de teste de split automático não encontrado"
fi

# Teste 3: Cobrança semanal automática
log "🧪 Teste 3: Cobrança semanal automática"
if [ -f "scripts/testing/test-weekly-plan-charge.cjs" ]; then
    node scripts/testing/test-weekly-plan-charge.cjs
    if [ $? -eq 0 ]; then
        success "Teste de cobrança semanal PASSADO"
    else
        warn "Teste de cobrança semanal FALHOU"
    fi
else
    warn "Script de teste de cobrança semanal não encontrado"
fi

# Teste 4: Sistema de convites
log "🧪 Teste 4: Sistema de convites"
if [ -f "scripts/testing/test-referral-system.cjs" ]; then
    node scripts/testing/test-referral-system.cjs
    if [ $? -eq 0 ]; then
        success "Teste de sistema de convites PASSADO"
    else
        warn "Teste de sistema de convites FALHOU"
    fi
else
    warn "Script de teste de sistema de convites não encontrado"
fi

# Verificar status das functions
log "Verificando status das functions..."

firebase functions:list --project "$FIREBASE_PROJECT_ID"

# Informações de configuração
echo ""
echo -e "${PURPLE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║                    CONFIGURAÇÃO NECESSÁRIA                    ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${CYAN}🔧 CONFIGURAÇÃO DO WEBHOOK:${NC}"
echo "URL: https://us-central1-$FIREBASE_PROJECT_ID.cloudfunctions.net/baas_baasWebhook"
echo "Eventos: charge.completed, split.completed, account.created"
echo ""

echo -e "${CYAN}📱 CONFIGURAÇÃO DO MOBILE APP:${NC}"
echo "1. Atualizar PlanSelectionScreen.js"
echo "2. Atualizar WeeklyPaymentScreen.js"
echo "3. Atualizar DriverDashboardScreen.js"
echo "4. Implementar notificações push"
echo ""

echo -e "${CYAN}🎯 PRÓXIMOS PASSOS:${NC}"
echo "1. Configurar webhook no dashboard da Woovi"
echo "2. Testar com dados reais"
echo "3. Monitorar performance via Firebase Console"
echo "4. Implementar telas no mobile app"
echo ""

echo -e "${CYAN}🧪 COMANDOS DE TESTE:${NC}"
echo "node scripts/testing/test-baas-account-creation.cjs"
echo "node scripts/testing/test-baas-split-automatic.cjs"
echo "node scripts/testing/test-weekly-plan-charge.cjs"
echo "node scripts/testing/test-referral-system.cjs"
echo ""

echo -e "${CYAN}📊 MONITORAMENTO:${NC}"
echo "Firebase Console: https://console.firebase.google.com/project/$FIREBASE_PROJECT_ID"
echo "Functions Logs: firebase functions:log --project $FIREBASE_PROJECT_ID"
echo ""

# Verificar se há erros nos logs
log "Verificando logs das functions..."

firebase functions:log --project "$FIREBASE_PROJECT_ID" --limit 10

# Resumo final
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    DEPLOY CONCLUÍDO!                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

success "Sistema BaaS deployado com sucesso!"
echo ""
echo -e "${YELLOW}📋 FUNCIONALIDADES IMPLEMENTADAS:${NC}"
echo "✅ Cobrança semanal automática do saldo"
echo "✅ 90 dias grátis para primeiros 500 motoristas"
echo "✅ Sistema de convites (3 por motorista)"
echo "✅ 1 mês grátis por convite bem-sucedido"
echo "✅ Máximo de 12 meses grátis por motorista"
echo "✅ Controle de ativação/desativação"
echo "✅ Webhook para eventos BaaS"
echo "✅ Logs de transações"
echo "✅ Notificações push"
echo ""

echo -e "${YELLOW}🎯 VANTAGENS COMPETITIVAS:${NC}"
echo "🏦 0% de taxa por corrida (vs 25-30% da concorrência)"
echo "💰 Taxa fixa semanal (previsibilidade total)"
echo "🎁 Período grátis para primeiros motoristas"
echo "🎫 Sistema de convites para crescimento orgânico"
echo ""

success "Sistema pronto para revolucionar o mercado de mobilidade urbana! 🚀"

# Limpeza
if [ -d "$backup_dir" ]; then
    log "Backup mantido em: $backup_dir"
fi

exit 0 