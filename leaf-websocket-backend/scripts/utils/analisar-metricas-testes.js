/**
 * ANALISADOR DE MÉTRICAS DE TESTES
 * 
 * Coleta e analisa métricas de execução de testes:
 * - Tempo total de execução
 * - Tempo médio por teste
 * - Taxa de sucesso
 * - Distribuição de tempos
 */

const { performance } = require('perf_hooks');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class TestMetricsAnalyzer {
    constructor() {
        this.metrics = {
            testFiles: [],
            totalTests: 0,
            totalPassed: 0,
            totalFailed: 0,
            totalDuration: 0,
            testDetails: []
        };
    }

    async runTestFile(filePath) {
        return new Promise((resolve, reject) => {
            const startTime = performance.now();
            const testFile = path.basename(filePath);
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`🧪 Executando: ${testFile}`);
            console.log(`${'='.repeat(60)}`);

            const child = spawn('node', [filePath], {
                cwd: path.dirname(filePath),
                stdio: 'pipe'
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                // Imprimir em tempo real
                process.stdout.write(output);
            });

            child.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                process.stderr.write(output);
            });

            child.on('close', (code) => {
                const endTime = performance.now();
                const duration = (endTime - startTime) / 1000; // segundos

                // Parsear resultados do stdout
                const results = this.parseTestResults(stdout, stderr);
                
                const metrics = {
                    file: testFile,
                    path: filePath,
                    exitCode: code,
                    duration: duration,
                    tests: results.total,
                    passed: results.passed,
                    failed: results.failed,
                    successRate: results.total > 0 ? (results.passed / results.total * 100) : 0,
                    details: results.testDetails
                };

                this.metrics.testFiles.push(metrics);
                this.metrics.totalTests += results.total;
                this.metrics.totalPassed += results.passed;
                this.metrics.totalFailed += results.failed;
                this.metrics.totalDuration += duration;
                this.metrics.testDetails.push(...results.testDetails);

                resolve(metrics);
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }

    parseTestResults(stdout, stderr) {
        const lines = stdout.split('\n');
        const results = {
            total: 0,
            passed: 0,
            failed: 0,
            testDetails: []
        };

        // Procurar por padrões de resultados
        lines.forEach((line, index) => {
            // Procurar por testes individuais
            if (line.includes('[TESTE]') || line.includes('TC-')) {
                const testMatch = line.match(/TC-(\d+)[:\s]+(.+)/);
                if (testMatch) {
                    const testNumber = testMatch[1];
                    const testName = testMatch[2].trim();
                    
                    // Procurar resultado nas próximas linhas
                    let found = false;
                    for (let i = index; i < Math.min(index + 5, lines.length); i++) {
                        if (lines[i].includes('[PASSOU]')) {
                            results.total++;
                            results.passed++;
                            found = true;
                            
                            // Extrair tempo
                            const timeMatch = lines[i].match(/\(([0-9.]+)s\)/);
                            const duration = timeMatch ? parseFloat(timeMatch[1]) : null;
                            
                            results.testDetails.push({
                                number: testNumber,
                                name: testName,
                                status: 'passed',
                                duration: duration
                            });
                            break;
                        } else if (lines[i].includes('[FALHOU]')) {
                            results.total++;
                            results.failed++;
                            found = true;
                            
                            const timeMatch = lines[i].match(/\(([0-9.]+)s\)/);
                            const duration = timeMatch ? parseFloat(timeMatch[1]) : null;
                            
                            results.testDetails.push({
                                number: testNumber,
                                name: testName,
                                status: 'failed',
                                duration: duration
                            });
                            break;
                        }
                    }
                }
            }

            // Procurar por resumo
            if (line.includes('RESUMO') || line.includes('Total:')) {
                const totalMatch = line.match(/Total:\s*(\d+)/);
                const passedMatch = line.match(/Passou:\s*(\d+)/);
                const failedMatch = line.match(/Falhou:\s*(\d+)/);
                
                if (totalMatch && !results.total) {
                    results.total = parseInt(totalMatch[1]);
                }
                if (passedMatch) {
                    results.passed = parseInt(passedMatch[1]);
                }
                if (failedMatch) {
                    results.failed = parseInt(failedMatch[1]);
                }
            }
        });

        return results;
    }

    generateReport() {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 RELATÓRIO DE MÉTRICAS DE TESTES`);
        console.log(`${'='.repeat(80)}\n`);

        // Resumo Geral
        console.log(`📈 RESUMO GERAL:`);
        console.log(`   Total de Arquivos de Teste: ${this.metrics.testFiles.length}`);
        console.log(`   Total de Testes Executados: ${this.metrics.totalTests}`);
        console.log(`   ✅ Passou: ${this.metrics.totalPassed}`);
        console.log(`   ❌ Falhou: ${this.metrics.totalFailed}`);
        console.log(`   📊 Taxa de Sucesso: ${((this.metrics.totalPassed / this.metrics.totalTests) * 100).toFixed(1)}%`);
        console.log(`   ⏱️  Tempo Total: ${this.metrics.totalDuration.toFixed(2)}s (${(this.metrics.totalDuration / 60).toFixed(2)}min)`);
        console.log(`   ⏱️  Tempo Médio por Teste: ${(this.metrics.totalDuration / this.metrics.totalTests).toFixed(2)}s\n`);

        // Por Arquivo
        console.log(`📁 MÉTRICAS POR ARQUIVO:`);
        this.metrics.testFiles.forEach((file, index) => {
            console.log(`\n   ${index + 1}. ${file.file}`);
            console.log(`      Testes: ${file.tests} | ✅ ${file.passed} | ❌ ${file.failed}`);
            console.log(`      Taxa de Sucesso: ${file.successRate.toFixed(1)}%`);
            console.log(`      Duração: ${file.duration.toFixed(2)}s`);
            console.log(`      Tempo Médio: ${(file.duration / file.tests).toFixed(2)}s por teste`);
            
            if (file.exitCode !== 0) {
                console.log(`      ⚠️  Exit Code: ${file.exitCode}`);
            }
        });

        // Distribuição de Tempos
        const durations = this.metrics.testDetails
            .filter(t => t.duration !== null)
            .map(t => t.duration);
        
        if (durations.length > 0) {
            durations.sort((a, b) => a - b);
            const min = durations[0];
            const max = durations[durations.length - 1];
            const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
            const median = durations[Math.floor(durations.length / 2)];

            console.log(`\n⏱️  DISTRIBUIÇÃO DE TEMPOS:`);
            console.log(`   Mínimo: ${min.toFixed(2)}s`);
            console.log(`   Máximo: ${max.toFixed(2)}s`);
            console.log(`   Média: ${avg.toFixed(2)}s`);
            console.log(`   Mediana: ${median.toFixed(2)}s`);
        }

        // Testes Mais Rápidos/Lentos
        const sortedTests = [...this.metrics.testDetails]
            .filter(t => t.duration !== null)
            .sort((a, b) => a.duration - b.duration);

        if (sortedTests.length > 0) {
            console.log(`\n⚡ TOP 5 TESTES MAIS RÁPIDOS:`);
            sortedTests.slice(0, 5).forEach((test, index) => {
                console.log(`   ${index + 1}. TC-${test.number}: ${test.duration.toFixed(2)}s - ${test.name.substring(0, 50)}`);
            });

            console.log(`\n🐌 TOP 5 TESTES MAIS LENTOS:`);
            sortedTests.slice(-5).reverse().forEach((test, index) => {
                console.log(`   ${index + 1}. TC-${test.number}: ${test.duration.toFixed(2)}s - ${test.name.substring(0, 50)}`);
            });
        }

        // Testes Falhados
        const failedTests = this.metrics.testDetails.filter(t => t.status === 'failed');
        if (failedTests.length > 0) {
            console.log(`\n❌ TESTES FALHADOS (${failedTests.length}):`);
            failedTests.forEach((test, index) => {
                console.log(`   ${index + 1}. TC-${test.number}: ${test.name}`);
                if (test.duration) {
                    console.log(`      Duração: ${test.duration.toFixed(2)}s`);
                }
            });
        }

        console.log(`\n${'='.repeat(80)}\n`);
    }

    async saveReportToFile(filename = 'test-metrics-report.json') {
        const reportPath = path.join(__dirname, filename);
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalFiles: this.metrics.testFiles.length,
                totalTests: this.metrics.totalTests,
                totalPassed: this.metrics.totalPassed,
                totalFailed: this.metrics.totalFailed,
                successRate: ((this.metrics.totalPassed / this.metrics.totalTests) * 100).toFixed(1),
                totalDuration: this.metrics.totalDuration
            },
            files: this.metrics.testFiles,
            testDetails: this.metrics.testDetails
        };

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`💾 Relatório salvo em: ${reportPath}`);
    }
}

async function main() {
    const analyzer = new TestMetricsAnalyzer();
    
    const testFiles = [
        path.join(__dirname, 'test-status-motorista-pagamento.js'),
        path.join(__dirname, 'test-tarifa-viagem-validacoes.js')
    ];

    console.log(`\n🚀 Iniciando análise de métricas de testes...`);
    console.log(`📋 Arquivos a executar: ${testFiles.length}\n`);

    for (const testFile of testFiles) {
        if (!fs.existsSync(testFile)) {
            console.log(`⚠️  Arquivo não encontrado: ${testFile}`);
            continue;
        }

        try {
            await analyzer.runTestFile(testFile);
        } catch (error) {
            console.error(`❌ Erro ao executar ${testFile}:`, error);
        }
    }

    // Gerar relatório
    analyzer.generateReport();

    // Salvar relatório em arquivo
    await analyzer.saveReportToFile();

    // Exit code baseado em falhas
    process.exit(analyzer.metrics.totalFailed > 0 ? 1 : 0);
}

main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});


