#!/bin/bash

# 🌿 LEAF APP - Script de Organização do Projeto
# Organiza arquivos, limpa temporários e atualiza índices

echo "🌿 LEAF APP - Organizando Projeto..."
echo "======================================"

# Função para criar backup
create_backup() {
    echo "📦 Criando backup..."
    timestamp=$(date +"%Y%m%d_%H%M%S")
    backup_dir="backup_${timestamp}"
    mkdir -p "$backup_dir"
    
    # Backup de arquivos importantes
    cp -r documentation/ "$backup_dir/"
    cp -r scripts/ "$backup_dir/"
    cp -r mobile-app/src/ "$backup_dir/"
    cp -r functions/ "$backup_dir/"
    
    echo "✅ Backup criado: $backup_dir"
}

# Função para limpar arquivos temporários
clean_temp_files() {
    echo "🧹 Limpando arquivos temporários..."
    
    # Remover arquivos temporários
    find . -name "*.tmp" -delete
    find . -name "*.log" -delete
    find . -name "*.cache" -delete
    find . -name ".DS_Store" -delete
    find . -name "Thumbs.db" -delete
    
    # Limpar node_modules desnecessários
    find . -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
    
    echo "✅ Arquivos temporários removidos"
}

# Função para organizar documentação
organize_documentation() {
    echo "📚 Organizando documentação..."
    
    # Criar diretórios se não existirem
    mkdir -p documentation/project/payments
    mkdir -p documentation/project/integration
    mkdir -p documentation/project/self-hosted
    
    # Mover arquivos de pagamento
    if [ -f "documentation/project/WOOVI-SETUP-GUIDE.md" ]; then
        mv documentation/project/WOOVI-SETUP-GUIDE.md documentation/project/payments/
    fi
    
    # Mover arquivos de integração
    if [ -f "documentation/project/INTEGRATION_STATUS_REPORT.md" ]; then
        mv documentation/project/INTEGRATION_STATUS_REPORT.md documentation/project/integration/
    fi
    
    echo "✅ Documentação organizada"
}

# Função para organizar scripts
organize_scripts() {
    echo "🛠️ Organizando scripts..."
    
    # Criar diretórios se não existirem
    mkdir -p scripts/testing/payment
    mkdir -p scripts/testing/integration
    mkdir -p scripts/testing/debug
    
    # Mover scripts de pagamento
    for file in scripts/testing/test-*-payment-*.cjs; do
        if [ -f "$file" ]; then
            mv "$file" scripts/testing/payment/
        fi
    done
    
    # Mover scripts de integração
    for file in scripts/testing/test-*-integration-*.cjs; do
        if [ -f "$file" ]; then
            mv "$file" scripts/testing/integration/
        fi
    done
    
    # Mover scripts de debug
    for file in scripts/testing/debug-*.cjs scripts/testing/diagnose-*.cjs; do
        if [ -f "$file" ]; then
            mv "$file" scripts/testing/debug/
        fi
    done
    
    echo "✅ Scripts organizados"
}

# Função para atualizar permissões
update_permissions() {
    echo "🔐 Atualizando permissões..."
    
    # Dar permissão de execução para scripts
    chmod +x scripts/*.sh
    chmod +x scripts/testing/*.cjs
    
    # Dar permissão de leitura para documentação
    chmod 644 documentation/project/*.md
    chmod 644 documentation/project/*.html
    
    echo "✅ Permissões atualizadas"
}

# Função para verificar integridade
check_integrity() {
    echo "🔍 Verificando integridade..."
    
    # Verificar arquivos essenciais
    essential_files=(
        "documentation/project/README.md"
        "documentation/project/MOBILE_APP_IMPLEMENTATION_CHECKLIST.html"
        "scripts/testing/README.md"
        "mobile-app/src/components/PixPaymentScreen.js"
        "functions/woovi-webhook.js"
    )
    
    missing_files=()
    for file in "${essential_files[@]}"; do
        if [ ! -f "$file" ]; then
            missing_files+=("$file")
        fi
    done
    
    if [ ${#missing_files[@]} -eq 0 ]; then
        echo "✅ Todos os arquivos essenciais presentes"
    else
        echo "⚠️ Arquivos faltando:"
        for file in "${missing_files[@]}"; do
            echo "   - $file"
        done
    fi
}

# Função para gerar relatório
generate_report() {
    echo "📊 Gerando relatório..."
    
    report_file="PROJECT_ORGANIZATION_REPORT.md"
    
    cat > "$report_file" << EOF
# 🌿 LEAF APP - Relatório de Organização

## 📅 Data: $(date)

### 📁 Estrutura do Projeto

#### 📚 Documentação
- **Total de arquivos:** $(find documentation -name "*.md" -o -name "*.html" | wc -l)
- **Arquivos principais:** $(ls documentation/project/*.md 2>/dev/null | wc -l)
- **Checklists:** $(find documentation -name "*checklist*" | wc -l)

#### 🛠️ Scripts
- **Total de scripts:** $(find scripts -name "*.cjs" -o -name "*.sh" | wc -l)
- **Scripts de teste:** $(find scripts/testing -name "*.cjs" | wc -l)
- **Scripts de pagamento:** $(find scripts/testing/payment -name "*.cjs" 2>/dev/null | wc -l)

#### 📱 Mobile App
- **Telas:** $(find mobile-app/src/screens -name "*.js" 2>/dev/null | wc -l)
- **Componentes:** $(find mobile-app/src/components -name "*.js" 2>/dev/null | wc -l)
- **Serviços:** $(find mobile-app/src/services -name "*.js" 2>/dev/null | wc -l)

#### ⚡ Backend
- **Functions:** $(find functions -name "*.js" | wc -l)
- **APIs:** $(find functions -name "*api*" | wc -l)
- **Webhooks:** $(find functions -name "*webhook*" | wc -l)

### 🎯 Status de Implementação

#### ✅ Implementado
- Sistema de pagamento PIX
- Webhook processing
- Tarifa mínima R$ 8,50
- Backend híbrido Redis + Firebase
- Fluxo de cadastro

#### 🚧 Em Desenvolvimento
- Integração completa mobile
- Push notifications
- Chat em tempo real

### 📋 Próximos Passos
1. Implementar telas faltantes
2. Conectar WebSocket
3. Testes end-to-end
4. Deploy produção

---
**Relatório gerado automaticamente pelo script de organização**
EOF

    echo "✅ Relatório gerado: $report_file"
}

# Função principal
main() {
    echo "🚀 Iniciando organização do projeto..."
    
    # Criar backup
    create_backup
    
    # Limpar arquivos temporários
    clean_temp_files
    
    # Organizar documentação
    organize_documentation
    
    # Organizar scripts
    organize_scripts
    
    # Atualizar permissões
    update_permissions
    
    # Verificar integridade
    check_integrity
    
    # Gerar relatório
    generate_report
    
    echo ""
    echo "🎉 Organização concluída!"
    echo "📊 Verifique o relatório: PROJECT_ORGANIZATION_REPORT.md"
    echo "📦 Backup criado em: backup_$(date +"%Y%m%d_%H%M%S")"
}

# Executar função principal
main "$@" 