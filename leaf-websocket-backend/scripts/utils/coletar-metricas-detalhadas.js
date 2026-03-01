/**
 * COLETOR DE MÉTRICAS DETALHADAS DE TESTES
 * 
 * Executa todos os testes e coleta métricas individuais:
 * - Tempo de execução por teste
 * - Taxa de sucesso
 * - Distribuição de tempos
 * - Top 5 mais rápidos/lentos
 */

const { performance } = require('perf_hooks');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class DetailedMetricsCollector {
    constructor() {
        this.allMetrics = [];
        this.summary = {
            totalTests: 0,
            totalPassed: 0,
            totalFailed: 0,
            totalDuration: 0,
            files: []
        };
    }

    async runTestFile(filePath) {
        return new Promise((resolve, reject) => {
            const startTime = performance.now();
            const testFile = path.basename(filePath);
            
            console.log(`\n${'='.repeat(70)}`);
            console.log(`🧪 Executando: ${testFile}`);
            console.log(`${'='.repeat(70)}`);

            const child = spawn('node', [filePath], {
                cwd: path.dirname(filePath),
                stdio: 'pipe'
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                const endTime = performance.now();
                const duration = (endTime - startTime) / 1000;

                const testMetrics = this.parseTestOutput(stdout, stderr, testFile, duration, code);
                
                this.allMetrics.push(...testMetrics.tests);
                this.summary.totalTests += testMetrics.total;
                this.summary.totalPassed += testMetrics.passed;
                this.summary.totalFailed += testMetrics.failed;
                this.summary.totalDuration += duration;
                this.summary.files.push({
                    file: testFile,
                    total: testMetrics.total,
                    passed: testMetrics.passed,
                    failed: testMetrics.failed,
                    duration: duration,
                    successRate: testMetrics.total > 0 ? (testMetrics.passed / testMetrics.total * 100) : 0
                });

                resolve(testMetrics);
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }

    parseTestOutput(stdout, stderr, fileName, fileDuration, exitCode) {
        const lines = stdout.split('\n');
        const tests = [];
        let total = 0;
        let passed = 0;
        let failed = 0;

        lines.forEach((line, index) => {
            // Procurar por testes individuais
            if (line.includes('[TESTE]')) {
                const testMatch = line.match(/\[TESTE\]\s*(.+)/);
                if (testMatch) {
                    const testName = testMatch[1].trim();
                    let testDuration = null;
                    let status = 'unknown';
                    
                    // Procurar resultado nas próximas linhas
                    for (let i = index; i < Math.min(index + 10, lines.length); i++) {
                        if (lines[i].includes('[PASSOU]')) {
                            status = 'passed';
                            total++;
                            passed++;
                            
                            const timeMatch = lines[i].match(/\(([0-9.]+)s\)/);
                            if (timeMatch) {
                                testDuration = parseFloat(timeMatch[1]);
                            }
                            break;
                        } else if (lines[i].includes('[FALHOU]')) {
                            status = 'failed';
                            total++;
                            failed++;
                            
                            const timeMatch = lines[i].match(/\(([0-9.]+)s\)/);
                            if (timeMatch) {
                                testDuration = parseFloat(timeMatch[1]);
                            }
                            break;
                        }
                    }

                    if (status !== 'unknown') {
                        tests.push({
                            file: fileName,
                            name: testName,
                            status: status,
                            duration: testDuration,
                            fileDuration: fileDuration
                        });
                    }
                }
            }
        });

        // Se não encontrou testes individuais, procurar resumo
        if (tests.length === 0) {
            const summaryMatch = stdout.match(/Total:\s*(\d+)[\s\S]*?Passou:\s*(\d+)[\s\S]*?Falhou:\s*(\d+)/);
            if (summaryMatch) {
                total = parseInt(summaryMatch[1]);
                passed = parseInt(summaryMatch[2]);
                failed = parseInt(summaryMatch[3]);
            }
        }

        return { tests, total, passed, failed };
    }

    generateDetailedReport() {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 RELATÓRIO DETALHADO DE MÉTRICAS DE TESTES`);
        console.log(`${'='.repeat(80)}\n`);

        // Resumo Geral
        console.log(`📈 RESUMO GERAL:`);
        console.log(`   Total de Arquivos: ${this.summary.files.length}`);
        console.log(`   Total de Testes: ${this.summary.totalTests}`);
        console.log(`   ✅ Passou: ${this.summary.totalPassed}`);
        console.log(`   ❌ Falhou: ${this.summary.totalFailed}`);
        console.log(`   📊 Taxa de Sucesso: ${((this.summary.totalPassed / this.summary.totalTests) * 100).toFixed(1)}%`);
        console.log(`   ⏱️  Tempo Total: ${this.summary.totalDuration.toFixed(2)}s (${(this.summary.totalDuration / 60).toFixed(2)}min)`);
        console.log(`   ⏱️  Tempo Médio por Teste: ${(this.summary.totalDuration / this.summary.totalTests).toFixed(2)}s\n`);

        // Por Arquivo
        console.log(`📁 MÉTRICAS POR ARQUIVO:`);
        this.summary.files.forEach((file, index) => {
            console.log(`\n   ${index + 1}. ${file.file}`);
            console.log(`      Testes: ${file.total} | ✅ ${file.passed} | ❌ ${file.failed}`);
            console.log(`      Taxa de Sucesso: ${file.successRate.toFixed(1)}%`);
            console.log(`      Duração Total: ${file.duration.toFixed(2)}s`);
            if (file.total > 0) {
                console.log(`      Tempo Médio: ${(file.duration / file.total).toFixed(2)}s por teste`);
            }
        });

        // Testes Individuais
        console.log(`\n📋 TESTES INDIVIDUAIS COM MÉTRICAS:`);
        this.allMetrics.forEach((test, index) => {
            const statusIcon = test.status === 'passed' ? '✅' : '❌';
            const durationStr = test.duration !== null ? `${test.duration.toFixed(2)}s` : 'N/A';
            console.log(`\n   ${index + 1}. ${statusIcon} ${test.name}`);
            console.log(`      Arquivo: ${test.file}`);
            console.log(`      Status: ${test.status === 'passed' ? 'PASSOU' : 'FALHOU'}`);
            console.log(`      Duração: ${durationStr}`);
        });

        // Distribuição de Tempos
        const durations = this.allMetrics
            .filter(t => t.duration !== null && t.status === 'passed')
            .map(t => t.duration);
        
        if (durations.length > 0) {
            durations.sort((a, b) => a - b);
            const min = durations[0];
            const max = durations[durations.length - 1];
            const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
            const median = durations[Math.floor(durations.length / 2)];

            console.log(`\n⏱️  DISTRIBUIÇÃO DE TEMPOS DOS TESTES:`);
            console.log(`   Mínimo: ${min.toFixed(2)}s`);
            console.log(`   Máximo: ${max.toFixed(2)}s`);
            console.log(`   Média: ${avg.toFixed(2)}s`);
            console.log(`   Mediana: ${median.toFixed(2)}s`);
        }

        // Top 5 Mais Rápidos
        const sortedByDuration = [...this.allMetrics]
            .filter(t => t.duration !== null && t.status === 'passed')
            .sort((a, b) => a.duration - b.duration);

        if (sortedByDuration.length > 0) {
            console.log(`\n⚡ TOP 5 TESTES MAIS RÁPIDOS:`);
            sortedByDuration.slice(0, 5).forEach((test, index) => {
                console.log(`   ${index + 1}. ${test.duration.toFixed(2)}s - ${test.name.substring(0, 60)}`);
                console.log(`      Arquivo: ${test.file}`);
            });

            console.log(`\n🐌 TOP 5 TESTES MAIS LENTOS:`);
            sortedByDuration.slice(-5).reverse().forEach((test, index) => {
                console.log(`   ${index + 1}. ${test.duration.toFixed(2)}s - ${test.name.substring(0, 60)}`);
                console.log(`      Arquivo: ${test.file}`);
            });
        }

        // Testes Falhados
        const failedTests = this.allMetrics.filter(t => t.status === 'failed');
        if (failedTests.length > 0) {
            console.log(`\n❌ TESTES FALHADOS (${failedTests.length}):`);
            failedTests.forEach((test, index) => {
                console.log(`   ${index + 1}. ${test.name}`);
                console.log(`      Arquivo: ${test.file}`);
                if (test.duration) {
                    console.log(`      Duração: ${test.duration.toFixed(2)}s`);
                }
            });
        }

        console.log(`\n${'='.repeat(80)}\n`);
    }

    async saveReportToFile(filename = 'metricas-detalhadas-testes.json') {
        const reportPath = path.join(__dirname, filename);
        const report = {
            timestamp: new Date().toISOString(),
            summary: this.summary,
            tests: this.allMetrics,
            statistics: {
                totalTests: this.summary.totalTests,
                totalPassed: this.summary.totalPassed,
                totalFailed: this.summary.totalFailed,
                successRate: ((this.summary.totalPassed / this.summary.totalTests) * 100).toFixed(1),
                totalDuration: this.summary.totalDuration,
                averageDuration: (this.summary.totalDuration / this.summary.totalTests).toFixed(2)
            }
        };

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`💾 Relatório detalhado salvo em: ${reportPath}`);
    }
}

async function main() {
    const collector = new DetailedMetricsCollector();
    
    const testFiles = [
        path.join(__dirname, 'test-status-motorista-pagamento.js'),
        path.join(__dirname, 'test-tarifa-viagem-validacoes.js'),
        path.join(__dirname, 'test-noshow-reembolsos.js'),
        path.join(__dirname, 'test-chat-incidentes-suporte.js'),
        path.join(__dirname, 'test-historico-relatorios.js')
    ];

    console.log(`\n🚀 Coletando métricas detalhadas de todos os testes...`);
    console.log(`📋 Arquivos a executar: ${testFiles.length}\n`);

    for (const testFile of testFiles) {
        if (!fs.existsSync(testFile)) {
            console.log(`⚠️  Arquivo não encontrado: ${testFile}`);
            continue;
        }

        try {
            await collector.runTestFile(testFile);
        } catch (error) {
            console.error(`❌ Erro ao executar ${testFile}:`, error);
        }
    }

    // Gerar relatório
    collector.generateDetailedReport();

    // Salvar relatório em arquivo
    await collector.saveReportToFile();

    // Exit code baseado em falhas
    process.exit(collector.summary.totalFailed > 0 ? 1 : 0);
}

main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});


