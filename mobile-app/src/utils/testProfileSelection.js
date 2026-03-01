import Logger from './Logger';
import { saveStepData, loadStepData, clearAllOnboardingData } from './secureOnboardingStorage';


// Teste específico para o step profile_selection
export const testProfileSelection = async () => {
  try {
    Logger.log('🧪 Testando step profile_selection...');
    
    // Limpar dados existentes
    await clearAllOnboardingData();
    Logger.log('🧹 Dados limpos');
    
    // Teste 1: Salvar dados do profile_selection
    Logger.log('📝 Teste 1: Salvando dados do profile_selection...');
    const testData = {
      userType: 'driver',
      timestamp: new Date().toISOString()
    };
    
    const saveResult = await saveStepData('profile_selection', testData);
    Logger.log('💾 Resultado do salvamento:', saveResult);
    
    // Teste 2: Carregar dados salvos
    Logger.log('📖 Teste 2: Carregando dados salvos...');
    const loadedData = await loadStepData('profile_selection');
    Logger.log('📥 Dados carregados:', loadedData);
    
    // Teste 3: Verificar se dados estão corretos
    const isCorrect = loadedData.userType === testData.userType;
    Logger.log(isCorrect ? '✅ Dados carregados corretamente' : '❌ Dados não conferem');
    
    // Teste 4: Verificar estrutura dos dados
    Logger.log('🔍 Estrutura dos dados:');
    Logger.log('- userType:', loadedData.userType);
    Logger.log('- timestamp:', loadedData.timestamp);
    Logger.log('- Campos extras:', Object.keys(loadedData).filter(key => !['userType', 'timestamp'].includes(key)));
    
    Logger.log('🎉 Teste do profile_selection concluído!');
    return true;
    
  } catch (error) {
    Logger.error('❌ Erro durante teste:', error);
    return false;
  }
};

// Teste de stress para profile_selection
export const testProfileSelectionStress = async () => {
  try {
    Logger.log('🔥 Teste de stress para profile_selection...');
    
    // Limpar dados
    await clearAllOnboardingData();
    
    // Salvar múltiplas vezes
    for (let i = 0; i < 5; i++) {
      const testData = {
        userType: i % 2 === 0 ? 'driver' : 'passenger',
        timestamp: new Date().toISOString(),
        iteration: i
      };
      
      Logger.log(`📝 Iteração ${i}: Salvando...`);
      await saveStepData('profile_selection', testData);
      
      // Carregar imediatamente
      const loadedData = await loadStepData('profile_selection');
      Logger.log(`📖 Iteração ${i}: Carregado:`, loadedData.userType);
    }
    
    // Verificar dados finais
    const finalData = await loadStepData('profile_selection');
    Logger.log('📊 Dados finais:', finalData);
    
    Logger.log('🎉 Teste de stress concluído!');
    return true;
    
  } catch (error) {
    Logger.error('❌ Erro durante teste de stress:', error);
    return false;
  }
};


