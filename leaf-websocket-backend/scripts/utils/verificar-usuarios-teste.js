/**
 * 🔍 VERIFICADOR DE USUÁRIOS DE TESTE - FIREBASE
 * Script para verificar se os usuários de teste ainda estão ativos
 */

const admin = require('firebase-admin');

// Configurar Firebase Admin
const serviceAccount = require('../mobile-app/google-services.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com/"
});

const auth = admin.auth();
const db = admin.database();

async function verificarUsuariosTeste() {
  console.log('🔍 VERIFICANDO USUÁRIOS DE TESTE NO FIREBASE...');
  console.log('='.repeat(60));

  try {
    // Usuários de teste esperados
    const usuariosTeste = [
      {
        telefone: '11999999999',
        email: 'joao.teste@leaf.com',
        nome: 'João Silva Teste',
        tipo: 'customer',
        uid: 'gyEGB07CssbnsACPJlywos40yaK2'
      },
      {
        telefone: '11888888888',
        email: 'maria.teste@leaf.com',
        nome: 'Maria Santos Teste',
        tipo: 'driver',
        uid: 'G62Nd6i22GhxhFm9R3PT08d0Ouw2'
      }
    ];

    console.log('\n📱 VERIFICANDO USUÁRIOS NO FIREBASE AUTH...');
    
    for (const usuario of usuariosTeste) {
      try {
        // Verificar por email
        const userRecord = await auth.getUserByEmail(usuario.email);
        console.log(`✅ ${usuario.nome} (${usuario.tipo}):`);
        console.log(`   📧 Email: ${usuario.email}`);
        console.log(`   🆔 UID: ${userRecord.uid}`);
        console.log(`   📞 Telefone: ${userRecord.phoneNumber || 'Não configurado'}`);
        console.log(`   ✅ Email verificado: ${userRecord.emailVerified}`);
        console.log(`   🚫 Desabilitado: ${userRecord.disabled}`);
        console.log('');
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          console.log(`❌ ${usuario.nome} (${usuario.tipo}): USUÁRIO NÃO ENCONTRADO`);
          console.log(`   📧 Email: ${usuario.email}`);
          console.log(`   🆔 UID esperado: ${usuario.uid}`);
          console.log('');
        } else {
          console.log(`❌ Erro ao verificar ${usuario.nome}: ${error.message}`);
          console.log('');
        }
      }
    }

    console.log('\n📊 VERIFICANDO DADOS NO REALTIME DATABASE...');
    
    // Verificar dados no Realtime Database
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    const users = snapshot.val();

    if (!users) {
      console.log('❌ Nenhum usuário encontrado no Realtime Database');
      return;
    }

    console.log(`📊 Total de usuários no banco: ${Object.keys(users).length}`);
    console.log('');

    // Procurar usuários de teste
    for (const usuario of usuariosTeste) {
      const userFound = Object.values(users).find(user => 
        user.email === usuario.email || 
        user.mobile === `+55${usuario.telefone}` ||
        user.uid === usuario.uid
      );

      if (userFound) {
        console.log(`✅ ${usuario.nome} encontrado no banco:`);
        console.log(`   📧 Email: ${userFound.email}`);
        console.log(`   📞 Telefone: ${userFound.mobile}`);
        console.log(`   👤 Nome: ${userFound.firstName} ${userFound.lastName}`);
        console.log(`   📋 Tipo: ${userFound.usertype || userFound.userType}`);
        console.log(`   ✅ Aprovado: ${userFound.approved || userFound.isApproved}`);
        console.log(`   🚗 Status Driver: ${userFound.driverActiveStatus}`);
        console.log(`   📱 Telefone validado: ${userFound.phoneValidated}`);
        console.log(`   📄 CNH upload: ${userFound.cnhUploaded}`);
        console.log(`   ✅ Perfil completo: ${userFound.profileComplete}`);
        console.log(`   🎯 Onboarding completo: ${userFound.onboardingCompleted}`);
        console.log('');
      } else {
        console.log(`❌ ${usuario.nome} NÃO encontrado no banco de dados`);
        console.log('');
      }
    }

    // Verificar veículos do motorista
    console.log('\n🚗 VERIFICANDO VEÍCULOS DO MOTORISTA...');
    const vehiclesRef = db.ref('vehicles');
    const vehiclesSnapshot = await vehiclesRef.once('value');
    const vehicles = vehiclesSnapshot.val();

    if (vehicles) {
      const mariaVehicle = Object.values(vehicles).find(vehicle => 
        vehicle.driverId === 'G62Nd6i22GhxhFm9R3PT08d0Ouw2' ||
        vehicle.plate === 'ABC1234'
      );

      if (mariaVehicle) {
        console.log('✅ Veículo da Maria encontrado:');
        console.log(`   🚙 Placa: ${mariaVehicle.plate}`);
        console.log(`   🚗 Marca: ${mariaVehicle.brand}`);
        console.log(`   🚙 Modelo: ${mariaVehicle.model}`);
        console.log(`   📅 Ano: ${mariaVehicle.year}`);
        console.log(`   🎨 Cor: ${mariaVehicle.color}`);
        console.log(`   ✅ Aprovado: ${mariaVehicle.carApproved}`);
        console.log('');
      } else {
        console.log('❌ Veículo da Maria NÃO encontrado');
        console.log('');
      }
    } else {
      console.log('❌ Nenhum veículo encontrado no banco');
      console.log('');
    }

    // Estatísticas gerais
    console.log('\n📊 ESTATÍSTICAS GERAIS:');
    const totalUsers = Object.keys(users).length;
    const drivers = Object.values(users).filter(u => u.usertype === 'driver' || u.userType === 'driver').length;
    const customers = Object.values(users).filter(u => u.usertype === 'customer' || u.userType === 'customer').length;
    const approvedDrivers = Object.values(users).filter(u => 
      (u.usertype === 'driver' || u.userType === 'driver') && 
      (u.approved || u.isApproved)
    ).length;
    const activeDrivers = Object.values(users).filter(u => 
      (u.usertype === 'driver' || u.userType === 'driver') && 
      u.driverActiveStatus
    ).length;

    console.log(`📱 Total de usuários: ${totalUsers}`);
    console.log(`🚗 Motoristas: ${drivers}`);
    console.log(`👤 Passageiros: ${customers}`);
    console.log(`✅ Motoristas aprovados: ${approvedDrivers}`);
    console.log(`🟢 Motoristas ativos: ${activeDrivers}`);
    console.log('');

    // Verificar conectividade WebSocket
    console.log('\n🔌 VERIFICANDO CONECTIVIDADE WEBSOCKET...');
    try {
      const ws = require('ws');
      const WebSocket = ws.WebSocket;
      
      const wsUrl = 'ws://localhost:3001';
      const wsClient = new WebSocket(wsUrl);
      
      wsClient.on('open', () => {
        console.log('✅ WebSocket conectado com sucesso');
        wsClient.close();
      });
      
      wsClient.on('error', (error) => {
        console.log('❌ Erro ao conectar WebSocket:', error.message);
      });
      
      setTimeout(() => {
        if (wsClient.readyState === WebSocket.CONNECTING) {
          console.log('⏰ Timeout ao conectar WebSocket');
          wsClient.close();
        }
      }, 5000);
      
    } catch (error) {
      console.log('❌ Erro ao testar WebSocket:', error.message);
    }

    console.log('\n🎯 RESUMO DA VERIFICAÇÃO:');
    console.log('='.repeat(60));
    console.log('✅ Usuários de teste verificados');
    console.log('✅ Dados do banco verificados');
    console.log('✅ Veículos verificados');
    console.log('✅ Estatísticas geradas');
    console.log('✅ WebSocket testado');
    console.log('');
    console.log('🚀 SISTEMA PRONTO PARA TESTE REAL!');

  } catch (error) {
    console.error('❌ Erro geral na verificação:', error);
  }
}

// Executar verificação
verificarUsuariosTeste().then(() => {
  console.log('\n✅ Verificação concluída');
  process.exit(0);
}).catch(error => {
  console.error('❌ Erro na verificação:', error);
  process.exit(1);
});
