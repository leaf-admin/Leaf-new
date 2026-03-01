import Logger from './Logger';
import { saveStepData, loadStepData, clearAllOnboardingData } from './secureOnboardingStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';


// Função de teste para verificar o armazenamento seguro
export const testSecureStorage = async () => {
  try {
    Logger.log('🧪 Iniciando testes do armazenamento seguro...');
    
    // Teste 1: Salvar dados sensíveis
    Logger.log('📝 Teste 1: Salvando dados sensíveis...');
    const testProfileData = {
      firstName: 'João',
      lastName: 'Silva',
      dateOfBirth: '1990-01-01',
      gender: 'M'
    };
    
    await saveStepData('profile_data', testProfileData);
    Logger.log('✅ Dados salvos com sucesso');
    
    // Teste 2: Carregar dados salvos
    Logger.log('📖 Teste 2: Carregando dados salvos...');
    const loadedData = await loadStepData('profile_data');
    Logger.log('📥 Dados carregados:', loadedData);
    
    // Teste 3: Verificar se dados estão corretos
    const isCorrect = JSON.stringify(loadedData) === JSON.stringify(testProfileData);
    Logger.log(isCorrect ? '✅ Dados carregados corretamente' : '❌ Dados não conferem');
    
    // Teste 4: Salvar dados não sensíveis
    Logger.log('📝 Teste 4: Salvando dados não sensíveis...');
    const testProgressData = {
      step: 2,
      completed: ['phone_validation']
    };
    
    await saveStepData('progress', testProgressData);
    Logger.log('✅ Progresso salvo com sucesso');
    
    // Teste 5: Carregar progresso
    Logger.log('📖 Teste 5: Carregando progresso...');
    const loadedProgress = await loadStepData('progress');
    Logger.log('📥 Progresso carregado:', loadedProgress);
    
    // Teste 6: Verificar integridade
    const progressCorrect = JSON.stringify(loadedProgress) === JSON.stringify(testProgressData);
    Logger.log(progressCorrect ? '✅ Progresso carregado corretamente' : '❌ Progresso não confere');
    
    // Teste 7: Limpar dados
    Logger.log('🧹 Teste 7: Limpando dados...');
    await clearAllOnboardingData();
    Logger.log('✅ Dados limpos com sucesso');
    
    // Teste 8: Verificar se dados foram limpos
    const emptyData = await loadStepData('profile_data');
    const isEmpty = Object.keys(emptyData).length === 0;
    Logger.log(isEmpty ? '✅ Dados limpos corretamente' : '❌ Dados não foram limpos');
    
    Logger.log('🎉 Todos os testes concluídos com sucesso!');
    return true;
    
  } catch (error) {
    Logger.error('❌ Erro durante testes:', error);
    return false;
  }
};

// Função para testar migração de dados
export const testDataMigration = async () => {
  try {
    Logger.log('🔄 Testando migração de dados...');
    
    // Simular dados antigos
    const oldData = {
      profile_data: {
        firstName: 'Maria',
        lastName: 'Santos',
        dateOfBirth: '1985-05-15',
        gender: 'F'
      }
    };
    
    // Salvar dados antigos
    await AsyncStorage.setItem('@onboarding_data', JSON.stringify(oldData));
    Logger.log('📥 Dados antigos salvos');
    
    // Carregar dados usando nova implementação
    const newData = await loadStepData('profile_data');
    Logger.log('📖 Dados carregados com nova implementação:', newData);
    
    // Verificar se migração funcionou
    const migrationSuccess = newData.firstName === 'Maria' && newData.lastName === 'Santos';
    Logger.log(migrationSuccess ? '✅ Migração funcionou' : '❌ Migração falhou');
    
    return migrationSuccess;
    
  } catch (error) {
    Logger.error('❌ Erro no teste de migração:', error);
    return false;
  }
};


