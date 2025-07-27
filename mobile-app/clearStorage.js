const AsyncStorage = require('@react-native-async-storage/async-storage');

// Função para limpar todos os dados do AsyncStorage
const clearAllStorage = async () => {
  try {
    await AsyncStorage.clear();
    console.log('✅ AsyncStorage limpo com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao limpar AsyncStorage:', error);
  }
};

// Função para limpar apenas os dados do usuário
const clearUserData = async () => {
  try {
    await AsyncStorage.removeItem('@user_data');
    console.log('✅ Dados do usuário removidos com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao remover dados do usuário:', error);
  }
};

// Executar limpeza
console.log('🧹 Iniciando limpeza do AsyncStorage...');
clearUserData().then(() => {
  console.log('🎉 Limpeza concluída! Reinicie o app.');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Erro na limpeza:', error);
  process.exit(1);
}); 