/**
 * REPORT SERVICE
 * 
 * Serviço para geração de relatórios em PDF e Excel
 */

const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

class ReportService {
    constructor() {
        this.templatesDir = path.join(__dirname, '../templates/reports');
        this.ensureTemplatesDir();
    }

    async ensureTemplatesDir() {
        try {
            await fs.mkdir(this.templatesDir, { recursive: true });
        } catch (error) {
            logger.warn(`⚠️ Erro ao criar diretório de templates: ${error.message}`);
        }
    }

    /**
     * Gerar relatório em PDF
     */
    async generatePDFReport(reportData, template = 'default') {
        try {
            // Usar biblioteca leve para PDF (jspdf via API ou puppeteer)
            // Por enquanto, retornar estrutura básica
            const pdfContent = this.buildPDFContent(reportData, template);
            
            logger.info(`✅ Relatório PDF gerado: ${reportData.title}`);
            return {
                success: true,
                content: pdfContent,
                format: 'pdf',
                filename: `${reportData.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`
            };
        } catch (error) {
            logger.error(`❌ Erro ao gerar PDF: ${error.message}`);
            throw error;
        }
    }

    /**
     * Gerar relatório em Excel
     */
    async generateExcelReport(reportData, template = 'default') {
        try {
            const XLSX = require('xlsx');
            const category = reportData.category || template || 'default';
            
            // Criar workbook
            const workbook = XLSX.utils.book_new();
            
            // Adicionar página de informações
            const infoData = [
                ['Relatório', reportData.title],
                ['Categoria', this.getCategoryLabel(category)],
                ['Período', reportData.period || 'N/A'],
                ['Gerado em', new Date().toLocaleString('pt-BR')],
                ['', ''],
            ];
            const infoSheet = XLSX.utils.aoa_to_sheet(infoData);
            XLSX.utils.book_append_sheet(workbook, infoSheet, 'Informações');
            
            // Adicionar resumo se disponível
            if (reportData.summary) {
                const summaryData = Object.entries(reportData.summary).map(([key, value]) => ({
                    Métrica: this.formatLabel(key),
                    Valor: this.formatValue(value, key, category)
                }));
                const summarySheet = XLSX.utils.json_to_sheet(summaryData);
                XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumo');
            }
            
            // Adicionar dados principais
            if (reportData.data && Array.isArray(reportData.data)) {
                const worksheet = XLSX.utils.json_to_sheet(reportData.data);
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Dados');
            }
            
            // Adicionar insights se disponível
            if (reportData.insights) {
                let insightsData;
                if (Array.isArray(reportData.insights)) {
                    insightsData = reportData.insights.map((insight, index) => ({
                        '#': index + 1,
                        'Insight': insight
                    }));
                } else if (typeof reportData.insights === 'object') {
                    insightsData = Object.entries(reportData.insights).map(([key, value]) => ({
                        Categoria: this.formatLabel(key),
                        Descrição: value
                    }));
                } else {
                    insightsData = [{ Insight: reportData.insights }];
                }
                const insightsSheet = XLSX.utils.json_to_sheet(insightsData);
                XLSX.utils.book_append_sheet(workbook, insightsSheet, 'Insights');
            }
            
            // Gerar buffer
            const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            logger.info(`✅ Relatório Excel gerado: ${reportData.title} (categoria: ${category})`);
            return {
                success: true,
                content: excelBuffer,
                format: 'xlsx',
                filename: `${reportData.title.replace(/\s+/g, '_')}_${Date.now()}.xlsx`
            };
        } catch (error) {
            logger.error(`❌ Erro ao gerar Excel: ${error.message}`);
            throw error;
        }
    }

    /**
     * Construir conteúdo PDF (estrutura básica)
     */
    buildPDFContent(reportData, template = 'default') {
        // Determinar categoria e obter estilos específicos
        const category = reportData.category || template || 'default';
        const styles = this.getTemplateStyles(category);
        
        // Estrutura HTML básica que pode ser convertida para PDF
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${reportData.title}</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    <div class="header">
        <h1>${reportData.title}</h1>
        <div class="header-info">
            <p><strong>Período:</strong> ${reportData.period || 'N/A'}</p>
            <p><strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}</p>
            ${reportData.category ? `<p><strong>Categoria:</strong> <span class="category-badge">${this.getCategoryLabel(reportData.category)}</span></p>` : ''}
        </div>
    </div>
    
    ${reportData.summary ? this.buildSummarySection(reportData.summary, category) : ''}
    
    ${reportData.data && reportData.data.length > 0 ? this.buildDataTable(reportData.data, category) : ''}
    
    ${reportData.charts ? this.buildChartsSection(reportData.charts, category) : ''}
    
    ${reportData.insights ? this.buildInsightsSection(reportData.insights, category) : ''}
    
    <div class="footer">
        <p>Relatório gerado automaticamente pelo sistema LEAF</p>
        <p>© ${new Date().getFullYear()} Leaf Transportation. Todos os direitos reservados.</p>
    </div>
</body>
</html>
        `;
        
        return html;
    }

    /**
     * Obter estilos específicos por categoria
     */
    getTemplateStyles(category) {
        const baseStyles = `
            body { 
                font-family: 'Segoe UI', Arial, sans-serif; 
                margin: 40px; 
                line-height: 1.6;
                color: #2D3748;
            }
            .header {
                border-bottom: 4px solid;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }
            h1 { 
                margin: 0 0 15px 0;
                font-size: 32px;
                font-weight: 700;
            }
            h2 { 
                margin-top: 30px;
                margin-bottom: 15px;
                font-size: 24px;
                font-weight: 600;
            }
            h3 {
                margin-top: 20px;
                margin-bottom: 10px;
                font-size: 18px;
                font-weight: 600;
            }
            .header-info {
                display: flex;
                gap: 30px;
                flex-wrap: wrap;
                font-size: 14px;
                color: #4A5568;
            }
            .header-info p {
                margin: 5px 0;
            }
            .category-badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
            }
            table { 
                width: 100%; 
                border-collapse: collapse; 
                margin: 20px 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            th { 
                padding: 12px;
                text-align: left;
                font-weight: 600;
                font-size: 14px;
            }
            td { 
                padding: 10px 12px;
                border-bottom: 1px solid #E2E8F0;
                font-size: 14px;
            }
            tr:hover {
                background-color: #F7FAFC;
            }
            .summary { 
                padding: 25px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 5px solid;
            }
            .metric { 
                display: inline-block;
                margin: 15px 25px 15px 0;
                vertical-align: top;
            }
            .metric-label { 
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 5px;
            }
            .metric-value { 
                font-size: 28px;
                font-weight: 700;
            }
            .insights {
                background-color: #F7FAFC;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid;
            }
            .insight-item {
                margin: 10px 0;
                padding-left: 20px;
                position: relative;
            }
            .insight-item:before {
                content: "→";
                position: absolute;
                left: 0;
                font-weight: bold;
            }
            .footer { 
                margin-top: 50px;
                padding-top: 20px;
                border-top: 2px solid #E2E8F0;
                font-size: 12px;
                color: #718096;
                text-align: center;
            }
            .footer p {
                margin: 5px 0;
            }
        `;

        const categoryStyles = {
            financial: `
                .header { border-color: #38A169; }
                h1 { color: #22543D; }
                .category-badge { background-color: #C6F6D5; color: #22543D; }
                th { background-color: #38A169; color: white; }
                .summary { background-color: #F0FFF4; border-color: #38A169; }
                .metric-value { color: #22543D; }
                .insights { border-color: #38A169; }
            `,
            operational: `
                .header { border-color: #3182CE; }
                h1 { color: #2C5282; }
                .category-badge { background-color: #BEE3F8; color: #2C5282; }
                th { background-color: #3182CE; color: white; }
                .summary { background-color: #EBF8FF; border-color: #3182CE; }
                .metric-value { color: #2C5282; }
                .insights { border-color: #3182CE; }
            `,
            drivers: `
                .header { border-color: #ED8936; }
                h1 { color: #C05621; }
                .category-badge { background-color: #FEEBC8; color: #C05621; }
                th { background-color: #ED8936; color: white; }
                .summary { background-color: #FFFAF0; border-color: #ED8936; }
                .metric-value { color: #C05621; }
                .insights { border-color: #ED8936; }
            `,
            users: `
                .header { border-color: #805AD5; }
                h1 { color: #553C9A; }
                .category-badge { background-color: #E9D8FD; color: #553C9A; }
                th { background-color: #805AD5; color: white; }
                .summary { background-color: #FAF5FF; border-color: #805AD5; }
                .metric-value { color: #553C9A; }
                .insights { border-color: #805AD5; }
            `,
            system: `
                .header { border-color: #E53E3E; }
                h1 { color: #C53030; }
                .category-badge { background-color: #FED7D7; color: #C53030; }
                th { background-color: #E53E3E; color: white; }
                .summary { background-color: #FFF5F5; border-color: #E53E3E; }
                .metric-value { color: #C53030; }
                .insights { border-color: #E53E3E; }
            `,
            default: `
                .header { border-color: #4A5568; }
                h1 { color: #2D3748; }
                .category-badge { background-color: #E2E8F0; color: #2D3748; }
                th { background-color: #4A5568; color: white; }
                .summary { background-color: #F7FAFC; border-color: #4A5568; }
                .metric-value { color: #2D3748; }
                .insights { border-color: #4A5568; }
            `
        };

        return baseStyles + (categoryStyles[category] || categoryStyles.default);
    }

    /**
     * Obter label da categoria
     */
    getCategoryLabel(category) {
        const labels = {
            financial: 'Financeiro',
            operational: 'Operacional',
            drivers: 'Motoristas',
            users: 'Usuários',
            system: 'Sistema',
            default: 'Geral'
        };
        return labels[category] || labels.default;
    }

    buildSummarySection(summary, category = 'default') {
        let html = '<div class="summary"><h2>Resumo Executivo</h2>';
        for (const [key, value] of Object.entries(summary)) {
            const formattedValue = this.formatValue(value, key, category);
            html += `
                <div class="metric">
                    <div class="metric-label">${this.formatLabel(key)}</div>
                    <div class="metric-value">${formattedValue}</div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    formatValue(value, key, category) {
        // Formatação específica por categoria
        if (category === 'financial') {
            if (typeof value === 'number' && (key.toLowerCase().includes('receita') || key.toLowerCase().includes('valor') || key.toLowerCase().includes('revenue'))) {
                return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
        }
        
        if (typeof value === 'number') {
            if (key.toLowerCase().includes('percent') || key.toLowerCase().includes('taxa') || key.toLowerCase().includes('rate')) {
                return `${value.toFixed(2)}%`;
            }
            if (value > 1000) {
                return value.toLocaleString('pt-BR');
            }
        }
        
        return value;
    }

    formatLabel(label) {
        // Formatar labels para melhor apresentação
        return label
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    buildDataTable(data) {
        if (!data || data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
        let html = '<h2>Dados Detalhados</h2><table><thead><tr>';
        
        headers.forEach(header => {
            html += `<th>${header}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        data.forEach(row => {
            html += '<tr>';
            headers.forEach(header => {
                html += `<td>${row[header] || ''}</td>`;
            });
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        return html;
    }

    buildChartsSection(charts, category = 'default') {
        if (!charts || charts.length === 0) return '';
        
        let html = '<h2>Visualizações e Gráficos</h2>';
        charts.forEach((chart, index) => {
            html += `<div style="margin: 20px 0; padding: 15px; background-color: #F7FAFC; border-radius: 6px;">
                <h3>${chart.title || `Gráfico ${index + 1}`}</h3>
                <p style="color: #718096; font-style: italic; margin: 5px 0;">
                    Tipo: ${chart.type || 'bar'} | ${chart.description || 'Visualização de dados'}
                </p>
                ${chart.data ? `<p style="color: #4A5568; font-size: 12px; margin-top: 10px;">
                    <strong>Dados:</strong> ${JSON.stringify(chart.data).substring(0, 100)}...
                </p>` : ''}
            </div>`;
        });
        return html;
    }

    /**
     * Construir seção de insights
     */
    buildInsightsSection(insights, category = 'default') {
        if (!insights || (Array.isArray(insights) && insights.length === 0)) return '';
        
        let html = '<div class="insights"><h2>Insights e Recomendações</h2>';
        
        if (Array.isArray(insights)) {
            insights.forEach(insight => {
                html += `<div class="insight-item">${insight}</div>`;
            });
        } else if (typeof insights === 'object') {
            for (const [key, value] of Object.entries(insights)) {
                html += `<div class="insight-item"><strong>${this.formatLabel(key)}:</strong> ${value}</div>`;
            }
        } else {
            html += `<div class="insight-item">${insights}</div>`;
        }
        
        html += '</div>';
        return html;
    }

    /**
     * Relatórios pré-configurados
     */
    getPredefinedReports() {
        return [
            {
                id: 'daily-summary',
                name: 'Resumo Diário',
                description: 'Resumo completo das operações do dia',
                category: 'operational',
                defaultPeriod: 'today'
            },
            {
                id: 'weekly-performance',
                name: 'Performance Semanal',
                description: 'Análise de performance da semana',
                category: 'operational',
                defaultPeriod: 'week'
            },
            {
                id: 'monthly-financial',
                name: 'Relatório Financeiro Mensal',
                description: 'Análise financeira completa do mês',
                category: 'financial',
                defaultPeriod: 'month'
            },
            {
                id: 'driver-performance',
                name: 'Performance de Motoristas',
                description: 'Análise de performance dos motoristas',
                category: 'drivers',
                defaultPeriod: 'month'
            },
            {
                id: 'user-growth',
                name: 'Crescimento de Usuários',
                description: 'Análise de crescimento de usuários',
                category: 'users',
                defaultPeriod: 'month'
            },
            {
                id: 'system-health',
                name: 'Saúde do Sistema',
                description: 'Relatório de saúde e performance do sistema',
                category: 'system',
                defaultPeriod: 'week'
            }
        ];
    }
}

module.exports = ReportService;

