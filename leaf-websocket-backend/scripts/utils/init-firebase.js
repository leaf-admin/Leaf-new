const { initializeFirebaseStructure } = require('./firebase-structure');

async function main() {
  console.log('🚀 Inicializando estrutura do Firebase...');
  
  try {
    const success = await initializeFirebaseStructure();
    
    if (success) {
      console.log('✅ Estrutura Firebase criada com sucesso!');
      console.log('');
      console.log('📊 Estrutura criada:');
      console.log('   🔥 Firestore:');
      console.log('     - user_locations');
      console.log('     - driver_status');
      console.log('     - trips');
      console.log('     - statistics');
      console.log('');
      console.log('   ⚡ Realtime Database:');
      console.log('     - locations/{uid}');
      console.log('     - drivers/{uid}/status');
      console.log('     - active_trips/{tripId}');
      console.log('     - realtime_stats');
      console.log('');
      console.log('🔄 Sincronização automática ativada!');
      console.log('   - Localizações → Redis + Firebase');
      console.log('   - Status → Redis + Firebase');
      console.log('   - Estatísticas → Redis + Firebase');
    } else {
      console.error('❌ Erro ao criar estrutura Firebase');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
}

main(); 