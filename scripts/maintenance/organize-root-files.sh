#!/bin/bash

# 🌿 LEAF APP - Script de Organização de Arquivos do Root
# Move todos os arquivos MD, scripts e PDFs para diretórios apropriados

echo "🌿 LEAF APP - Organizando Arquivos do Root..."
echo "=============================================="

# Função para criar diretórios se não existirem
create_directories() {
    echo "📁 Criando diretórios..."
    
    # Diretórios para documentação
    mkdir -p documentation/project/status-reports
    mkdir -p documentation/project/logs
    mkdir -p documentation/project/studies
    mkdir -p documentation/project/analytics
    
    # Diretórios para scripts
    mkdir -p scripts/deploy
    mkdir -p scripts/services
    mkdir -p scripts/root
    
    # Diretórios para PDFs e estudos
    mkdir -p documentation/studies/pdf
    mkdir -p documentation/studies/reports
    
    echo "✅ Diretórios criados"
}

# Função para mover arquivos MD de status
move_status_files() {
    echo "📋 Movendo arquivos de status..."
    
    # Arquivos de status para status-reports
    status_files=(
        "STATUS_WOOVI_FINAL.md"
        "API_KEYS_STATUS.md"
        "CORRECOES_METRICAS_MONITORAMENTO.md"
        "RESUMO_METRICAS_MONITORAMENTO.md"
        "PROBLEMAS_RESOLVIDOS.md"
    )
    
    for file in "${status_files[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "documentation/project/status-reports/"
            echo "✅ Movido: $file → status-reports/"
        fi
    done
}

# Função para mover logs
move_log_files() {
    echo "📝 Movendo arquivos de log..."
    
    # Arquivos de log para logs
    log_files=(
        "LOG_COMPLETO_28_JULHO_2025.md"
    )
    
    for file in "${log_files[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "documentation/project/logs/"
            echo "✅ Movido: $file → logs/"
        fi
    done
}

# Função para mover estudos
move_study_files() {
    echo "📊 Movendo arquivos de estudo..."
    
    # Arquivos de estudo para studies
    study_files=(
        "PROJETO_ORGANIZADO.md"
    )
    
    for file in "${study_files[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "documentation/project/studies/"
            echo "✅ Movido: $file → studies/"
        fi
    done
}

# Função para mover PDFs
move_pdf_files() {
    echo "📄 Movendo arquivos PDF..."
    
    # Arquivos PDF para studies/pdf
    pdf_files=(
        "ESTUDO_COMPLETO_STAKEHOLDERS.pdf"
    )
    
    for file in "${pdf_files[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "documentation/studies/pdf/"
            echo "✅ Movido: $file → studies/pdf/"
        fi
    done
}

# Função para mover scripts
move_script_files() {
    echo "🛠️ Movendo scripts..."
    
    # Scripts de deploy para deploy
    deploy_scripts=(
        "deploy-rapido.sh"
    )
    
    for file in "${deploy_scripts[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "scripts/deploy/"
            echo "✅ Movido: $file → deploy/"
        fi
    done
    
    # Scripts de serviços para services
    service_scripts=(
        "restart-all-services.sh"
    )
    
    for file in "${service_scripts[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "scripts/services/"
            echo "✅ Movido: $file → services/"
        fi
    done
}

# Função para mover índices
move_index_files() {
    echo "📚 Movendo arquivos de índice..."
    
    # Arquivos de índice para root
    index_files=(
        "INDEX_FINAL.md"
        "PROJECT_ORGANIZATION_REPORT.md"
    )
    
    for file in "${index_files[@]}"; do
        if [ -f "$file" ]; then
            mv "$file" "scripts/root/"
            echo "✅ Movido: $file → root/"
        fi
    done
}

# Função para atualizar README principal
update_main_readme() {
    echo "📖 Atualizando README principal..."
    
    # Verificar se existe README.md no root
    if [ -f "README.md" ]; then
        # Mover para documentation se não for o README principal do projeto
        if ! grep -q "LEAF APP" README.md; then
            mv README.md "documentation/project/"
            echo "✅ Movido: README.md → project/"
        else
            echo "ℹ️ README.md principal mantido no root"
        fi
    fi
}

# Função para limpar arquivos desnecessários
clean_unnecessary_files() {
    echo "🧹 Limpando arquivos desnecessários..."
    
    # Lista de arquivos que podem ser removidos ou movidos
    unnecessary_files=(
        "yarn.lock"
        "package-lock.json"
        "package.json"
    )
    
    for file in "${unnecessary_files[@]}"; do
        if [ -f "$file" ]; then
            # Verificar se é necessário manter no root
            if [ "$file" = "package.json" ]; then
                echo "ℹ️ Mantido no root: $file (necessário para npm/yarn)"
            else
                echo "ℹ️ Mantido no root: $file (dependência)"
            fi
        fi
    done
}

# Função para criar índices atualizados
create_updated_indexes() {
    echo "📋 Criando índices atualizados..."
    
    # Criar índice para status reports
    cat > "documentation/project/status-reports/README.md" << 'EOF'
# 📊 Status Reports - LEAF APP

## 📋 Arquivos de Status

### 🔧 Configurações e APIs
- [API_KEYS_STATUS.md](./API_KEYS_STATUS.md) - Status das API Keys
- [STATUS_WOOVI_FINAL.md](./STATUS_WOOVI_FINAL.md) - Status final do Woovi

### 📈 Métricas e Monitoramento
- [CORRECOES_METRICAS_MONITORAMENTO.md](./CORRECOES_METRICAS_MONITORAMENTO.md) - Correções de métricas
- [RESUMO_METRICAS_MONITORAMENTO.md](./RESUMO_METRICAS_MONITORAMENTO.md) - Resumo de métricas

### 🛠️ Problemas e Soluções
- [PROBLEMAS_RESOLVIDOS.md](./PROBLEMAS_RESOLVIDOS.md) - Problemas resolvidos

---
**Última atualização:** $(date)
EOF

    # Criar índice para logs
    cat > "documentation/project/logs/README.md" << 'EOF'
# 📝 Logs - LEAF APP

## 📋 Arquivos de Log

### 📅 Logs por Data
- [LOG_COMPLETO_28_JULHO_2025.md](./LOG_COMPLETO_28_JULHO_2025.md) - Log completo de 28/07/2025

---
**Última atualização:** $(date)
EOF

    # Criar índice para estudos
    cat > "documentation/project/studies/README.md" << 'EOF'
# 📊 Estudos - LEAF APP

## 📋 Arquivos de Estudo

### 📈 Análises e Relatórios
- [PROJETO_ORGANIZADO.md](./PROJETO_ORGANIZADO.md) - Projeto organizado

---
**Última atualização:** $(date)
EOF

    # Criar índice para scripts
    cat > "scripts/deploy/README.md" << 'EOF'
# 🚀 Scripts de Deploy - LEAF APP

## 📋 Scripts Disponíveis

### 🚀 Deploy Rápido
- [deploy-rapido.sh](./deploy-rapido.sh) - Deploy rápido do projeto

---
**Última atualização:** $(date)
EOF

    cat > "scripts/services/README.md" << 'EOF'
# ⚙️ Scripts de Serviços - LEAF APP

## 📋 Scripts Disponíveis

### 🔄 Gerenciamento de Serviços
- [restart-all-services.sh](./restart-all-services.sh) - Reiniciar todos os serviços

---
**Última atualização:** $(date)
EOF

    echo "✅ Índices criados"
}

# Função para verificar organização
check_organization() {
    echo "🔍 Verificando organização..."
    
    # Verificar se arquivos foram movidos corretamente
    moved_dirs=(
        "documentation/project/status-reports"
        "documentation/project/logs"
        "documentation/project/studies"
        "documentation/studies/pdf"
        "scripts/deploy"
        "scripts/services"
        "scripts/root"
    )
    
    for dir in "${moved_dirs[@]}"; do
        if [ -d "$dir" ]; then
            file_count=$(find "$dir" -type f | wc -l)
            echo "✅ $dir: $file_count arquivos"
        fi
    done
}

# Função para gerar relatório final
generate_final_report() {
    echo "📊 Gerando relatório final..."
    
    report_file="ORGANIZATION_FINAL_REPORT.md"
    
    cat > "$report_file" << EOF
# 🌿 LEAF APP - Relatório Final de Organização

## 📅 Data: $(date)

### 📁 Arquivos Organizados

#### 📋 Status Reports
$(ls -1 documentation/project/status-reports/*.md 2>/dev/null | wc -l) arquivos movidos para status-reports/

#### 📝 Logs
$(ls -1 documentation/project/logs/*.md 2>/dev/null | wc -l) arquivos movidos para logs/

#### 📊 Estudos
$(ls -1 documentation/project/studies/*.md 2>/dev/null | wc -l) arquivos movidos para studies/

#### 📄 PDFs
$(ls -1 documentation/studies/pdf/*.pdf 2>/dev/null | wc -l) arquivos movidos para studies/pdf/

#### 🛠️ Scripts
$(ls -1 scripts/deploy/*.sh 2>/dev/null | wc -l) scripts movidos para deploy/
$(ls -1 scripts/services/*.sh 2>/dev/null | wc -l) scripts movidos para services/

### 🎯 Resultado
- ✅ Todos os arquivos MD organizados
- ✅ Scripts categorizados
- ✅ PDFs movidos para estudos
- ✅ Índices atualizados
- ✅ Estrutura limpa no root

### 📁 Estrutura Final
\`\`\`
Sourcecode/
├── documentation/
│   ├── project/
│   │   ├── status-reports/     # Status e configurações
│   │   ├── logs/              # Logs por data
│   │   └── studies/           # Estudos e análises
│   └── studies/
│       └── pdf/               # PDFs de estudos
├── scripts/
│   ├── deploy/                # Scripts de deploy
│   ├── services/              # Scripts de serviços
│   └── root/                  # Índices principais
└── [outros diretórios...]
\`\`\`

---
**Relatório gerado automaticamente pelo script de organização**
EOF

    echo "✅ Relatório final gerado: $report_file"
}

# Função principal
main() {
    echo "🚀 Iniciando organização dos arquivos do root..."
    
    # Criar diretórios
    create_directories
    
    # Mover arquivos por categoria
    move_status_files
    move_log_files
    move_study_files
    move_pdf_files
    move_script_files
    move_index_files
    update_main_readme
    clean_unnecessary_files
    
    # Criar índices atualizados
    create_updated_indexes
    
    # Verificar organização
    check_organization
    
    # Gerar relatório final
    generate_final_report
    
    echo ""
    echo "🎉 Organização dos arquivos do root concluída!"
    echo "📊 Verifique o relatório: ORGANIZATION_FINAL_REPORT.md"
    echo "📁 Estrutura organizada em: documentation/ e scripts/"
}

# Executar função principal
main "$@" 