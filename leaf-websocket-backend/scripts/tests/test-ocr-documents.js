/**
 * Script de teste para processar documentos reais (CNH e CRLV)
 * 
 * Uso: node test-ocr-documents.js
 */

const fs = require('fs');
const path = require('path');
const ocrService = require('./services/ocr-service');

// Caminho dos documentos
const DOCUMENTS_PATH = '/home/izaak-dias/Desktop/documents';

// Aguardar inicialização do serviço
async function waitForService() {
  let attempts = 0;
  while (!ocrService.initialized && attempts < 10) {
    console.log('⏳ Aguardando inicialização do serviço OCR...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  if (!ocrService.initialized) {
    console.error('❌ Serviço OCR não inicializou após 10 segundos');
    process.exit(1);
  }
  
  console.log('✅ Serviço OCR inicializado!\n');
}

async function processDocument(filePath, documentType) {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📄 Processando: ${path.basename(filePath)}`);
    console.log(`📋 Tipo: ${documentType}`);
    console.log(`${'='.repeat(60)}\n`);

    // Ler arquivo
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = path.extname(filePath).toLowerCase() === '.pdf' 
      ? 'application/pdf' 
      : 'image/png';

    console.log(`📊 Tamanho do arquivo: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`📝 Tipo MIME: ${mimeType}\n`);

    // Processar documento
    let result;
    const startTime = Date.now();
    
    if (documentType === 'CNH') {
      result = await ocrService.extractCNHData(fileBuffer, mimeType);
    } else if (documentType === 'CRLV') {
      result = await ocrService.extractCRLVData(fileBuffer, mimeType);
    } else {
      throw new Error('Tipo de documento inválido');
    }

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Exibir resultados
    console.log(`\n⏱️  Tempo de processamento: ${processingTime}s\n`);
    console.log('📋 DADOS EXTRAÍDOS:');
    console.log('─'.repeat(60));
    
    // Filtrar apenas campos não-nulos
    const extractedFields = {};
    for (const [key, value] of Object.entries(result)) {
      if (key !== 'textoCompleto' && value !== null && value !== undefined) {
        extractedFields[key] = value;
      }
    }

    // Exibir em formato legível
    for (const [key, value] of Object.entries(extractedFields)) {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
      console.log(`  ${label.padEnd(25)}: ${value}`);
    }

    // Estatísticas
    const totalFields = Object.keys(result).filter(k => k !== 'textoCompleto' && k !== 'confidence').length;
    const extractedCount = Object.keys(extractedFields).length;
    const successRate = ((extractedCount / totalFields) * 100).toFixed(1);

    console.log('\n📊 ESTATÍSTICAS:');
    console.log('─'.repeat(60));
    console.log(`  Campos extraídos: ${extractedCount}/${totalFields} (${successRate}%)`);
    console.log(`  Confiança: ${(result.confidence * 100).toFixed(1)}%`);

    // Mostrar preview do texto completo (primeiros 500 caracteres)
    if (result.textoCompleto) {
      console.log('\n📝 PREVIEW DO TEXTO EXTRAÍDO (primeiros 500 caracteres):');
      console.log('─'.repeat(60));
      const preview = result.textoCompleto.substring(0, 500).replace(/\n/g, ' ');
      console.log(`  ${preview}...`);
    }

    console.log('\n✅ Processamento concluído!\n');

    return result;

  } catch (error) {
    console.error(`\n❌ Erro ao processar ${path.basename(filePath)}:`, error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

async function main() {
  console.log('🚀 Iniciando teste de OCR com documentos reais\n');

  // Aguardar inicialização
  await waitForService();

  // Encontrar arquivos
  const files = fs.readdirSync(DOCUMENTS_PATH);
  
  const cnhFiles = files.filter(f => 
    f.toLowerCase().includes('cnh') && 
    (f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.png'))
  );
  
  const crlvFiles = files.filter(f => 
    (f.toLowerCase().includes('crlv') || f.toLowerCase().includes('veiculo') || f.toLowerCase().includes('veículo')) && 
    (f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.png'))
  );

  console.log(`📁 Arquivos encontrados:`);
  console.log(`   CNH: ${cnhFiles.length} arquivo(s)`);
  console.log(`   CRLV: ${crlvFiles.length} arquivo(s)\n`);

  const results = {
    cnh: [],
    crlv: []
  };

  // Processar CNHs
  if (cnhFiles.length > 0) {
    console.log('\n' + '🆔'.repeat(30));
    console.log('PROCESSANDO CNHs');
    console.log('🆔'.repeat(30));
    
    for (const file of cnhFiles) {
      const filePath = path.join(DOCUMENTS_PATH, file);
      const result = await processDocument(filePath, 'CNH');
      if (result) {
        results.cnh.push({ file, result });
      }
    }
  }

  // Processar CRLVs
  if (crlvFiles.length > 0) {
    console.log('\n' + '🚗'.repeat(30));
    console.log('PROCESSANDO CRLVs');
    console.log('🚗'.repeat(30));
    
    for (const file of crlvFiles) {
      const filePath = path.join(DOCUMENTS_PATH, file);
      const result = await processDocument(filePath, 'CRLV');
      if (result) {
        results.crlv.push({ file, result });
      }
    }
  }

  // Resumo final
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO FINAL');
  console.log('='.repeat(60));
  console.log(`\n✅ CNHs processadas: ${results.cnh.length}`);
  console.log(`✅ CRLVs processados: ${results.crlv.length}\n`);

  // Salvar resultados em JSON
  const outputPath = path.join(__dirname, 'ocr-test-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`💾 Resultados salvos em: ${outputPath}\n`);

  console.log('✨ Teste concluído!\n');
}

// Executar
main().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
