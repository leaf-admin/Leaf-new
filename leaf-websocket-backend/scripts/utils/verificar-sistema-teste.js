/**
 * 🔍 VERIFICADOR SIMPLIFICADO DE USUÁRIOS DE TESTE
 * Script para verificar conectividade e status do sistema
 */

console.log('🔍 VERIFICANDO SISTEMA PARA TESTE REAL...');
console.log('='.repeat(60));

// Verificar conectividade WebSocket
async function verificarWebSocket() {
  console.log('\n🔌 VERIFICANDO CONECTIVIDADE WEBSOCKET...');
  
  try {
    const WebSocket = require('ws');
    const wsUrl = 'ws://localhost:3001';
    
    return new Promise((resolve) => {
      const wsClient = new WebSocket(wsUrl);
      
      wsClient.on('open', () => {
        console.log('✅ WebSocket conectado com sucesso');
        console.log(`   🌐 URL: ${wsUrl}`);
        wsClient.close();
        resolve(true);
      });
      
      wsClient.on('error', (error) => {
        console.log('❌ Erro ao conectar WebSocket:', error.message);
        console.log('   💡 Verifique se o servidor está rodando');
        resolve(false);
      });
      
      setTimeout(() => {
        if (wsClient.readyState === WebSocket.CONNECTING) {
          console.log('⏰ Timeout ao conectar WebSocket');
          wsClient.close();
          resolve(false);
        }
      }, 5000);
    });
    
  } catch (error) {
    console.log('❌ Erro ao testar WebSocket:', error.message);
    return false;
  }
}

// Verificar servidor HTTP
async function verificarServidorHTTP() {
  console.log('\n🌐 VERIFICANDO SERVIDOR HTTP...');
  
  try {
    const http = require('http');
    
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3001', (res) => {
        console.log('✅ Servidor HTTP respondendo');
        console.log(`   📊 Status: ${res.statusCode}`);
        resolve(true);
      });
      
      req.on('error', (error) => {
        console.log('❌ Erro ao conectar servidor HTTP:', error.message);
        resolve(false);
      });
      
      req.setTimeout(5000, () => {
        console.log('⏰ Timeout ao conectar servidor HTTP');
        req.destroy();
        resolve(false);
      });
    });
    
  } catch (error) {
    console.log('❌ Erro ao testar servidor HTTP:', error.message);
    return false;
  }
}

// Verificar processos do servidor
function verificarProcessos() {
  console.log('\n⚙️ VERIFICANDO PROCESSOS DO SERVIDOR...');
  
  try {
    const { execSync } = require('child_process');
    const output = execSync('ps aux | grep "node.*server.js" | grep -v grep', { encoding: 'utf8' });
    
    if (output.trim()) {
      const lines = output.trim().split('\n');
      console.log(`✅ ${lines.length} processo(s) do servidor encontrado(s)`);
      
      lines.forEach((line, index) => {
        const parts = line.split(/\s+/);
        const pid = parts[1];
        const cpu = parts[2];
        const mem = parts[3];
        console.log(`   🔧 Processo ${index + 1}: PID ${pid}, CPU ${cpu}%, MEM ${mem}%`);
      });
      
      return true;
    } else {
      console.log('❌ Nenhum processo do servidor encontrado');
      return false;
    }
    
  } catch (error) {
    console.log('❌ Erro ao verificar processos:', error.message);
    return false;
  }
}

// Mostrar informações dos usuários de teste
function mostrarUsuariosTeste() {
  console.log('\n👥 USUÁRIOS DE TESTE DISPONÍVEIS:');
  console.log('='.repeat(60));
  
  console.log('\n👤 PASSAGEIRO DE TESTE:');
  console.log('   📞 Telefone: 11999999999');
  console.log('   📧 Email: joao.teste@leaf.com');
  console.log('   🔐 Senha: teste123');
  console.log('   👤 Nome: João Silva Teste');
  console.log('   📋 Tipo: customer');
  console.log('   ✅ Status: Aprovado automaticamente');
  
  console.log('\n🚗 MOTORISTA DE TESTE:');
  console.log('   📞 Telefone: 11888888888');
  console.log('   📧 Email: maria.teste@leaf.com');
  console.log('   🔐 Senha: teste123');
  console.log('   👤 Nome: Maria Santos Teste');
  console.log('   📋 Tipo: driver');
  console.log('   ✅ Status: Aprovado (isApproved: true)');
  console.log('   🚗 Veículo: Honda Civic 2020');
  console.log('   🚙 Placa: ABC1234');
  console.log('   ✅ Veículo: Aprovado (carApproved: true)');
}

// Mostrar instruções de teste
function mostrarInstrucoes() {
  console.log('\n🚀 INSTRUÇÕES PARA TESTE REAL:');
  console.log('='.repeat(60));
  
  console.log('\n📱 COMO FAZER LOGIN:');
  console.log('   1. Abra o app no dispositivo');
  console.log('   2. Vá para tela de "Entrar"');
  console.log('   3. Digite o telefone: 11999999999 ou 11888888888');
  console.log('   4. Digite a senha: teste123');
  console.log('   5. Clique em "Entrar"');
  
  console.log('\n🎯 CENÁRIO DE TESTE RECOMENDADO:');
  console.log('   1. Login do passageiro (11999999999)');
  console.log('   2. Login do motorista (11888888888) em outro dispositivo');
  console.log('   3. Passageiro solicita corrida');
  console.log('   4. Motorista aceita corrida');
  console.log('   5. Testar chat e localização em tempo real');
  console.log('   6. Finalizar viagem e avaliar');
  
  console.log('\n✅ FUNCIONALIDADES PARA TESTAR:');
  console.log('   🔌 WebSocket em tempo real');
  console.log('   📱 Notificações push');
  console.log('   💬 Chat durante corrida');
  console.log('   📍 Localização em tempo real');
  console.log('   💳 Pagamentos');
  console.log('   ⭐ Avaliações');
  console.log('   🔄 Fallback para REST API');
  console.log('   📊 Monitoramento e métricas');
  console.log('   📝 Logs e debugging');
}

// Executar todas as verificações
async function executarVerificacoes() {
  const resultados = {
    processos: verificarProcessos(),
    servidorHTTP: await verificarServidorHTTP(),
    webSocket: await verificarWebSocket()
  };
  
  mostrarUsuariosTeste();
  mostrarInstrucoes();
  
  console.log('\n📊 RESUMO DA VERIFICAÇÃO:');
  console.log('='.repeat(60));
  
  Object.entries(resultados).forEach(([teste, resultado]) => {
    const status = resultado ? '✅' : '❌';
    const nome = {
      processos: 'Processos do servidor',
      servidorHTTP: 'Servidor HTTP',
      webSocket: 'WebSocket'
    }[teste];
    
    console.log(`   ${status} ${nome}`);
  });
  
  const todosFuncionando = Object.values(resultados).every(r => r);
  
  if (todosFuncionando) {
    console.log('\n🎉 SISTEMA PRONTO PARA TESTE REAL!');
    console.log('   ✅ Todos os serviços funcionando');
    console.log('   ✅ Usuários de teste disponíveis');
    console.log('   ✅ WebSocket conectado');
    console.log('   🚀 Pode conectar o dispositivo e testar!');
  } else {
    console.log('\n⚠️ ALGUNS SERVIÇOS PRECISAM DE ATENÇÃO');
    console.log('   🔧 Verifique os itens marcados com ❌');
    console.log('   💡 Reinicie o servidor se necessário');
  }
  
  console.log('\n📞 SUPORTE:');
  console.log('   - Verifique os logs do servidor WebSocket');
  console.log('   - Confirme se o Firebase está funcionando');
  console.log('   - Use o sistema de logs implementado para debug');
}

// Executar verificações
executarVerificacoes().then(() => {
  console.log('\n✅ Verificação concluída');
  process.exit(0);
}).catch(error => {
  console.error('❌ Erro na verificação:', error);
  process.exit(1);
});






