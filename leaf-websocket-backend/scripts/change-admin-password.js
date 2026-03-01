#!/usr/bin/env node

/**
 * Script para alterar senha de usuários admin do dashboard
 * 
 * Uso:
 *   node scripts/change-admin-password.js --email admin@leaf.com --password novaSenha123
 *   node scripts/change-admin-password.js (modo interativo)
 */

const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// Inicializar Firebase Admin
try {
  const serviceAccount = require('../firebase-credentials.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error('❌ Erro ao inicializar Firebase Admin:', error.message);
  console.error('   Certifique-se de que firebase-credentials.json existe e está válido.');
  process.exit(1);
}

const firestore = admin.firestore();

// Ler argumentos da linha de comando
const args = process.argv.slice(2);
let email = null;
let password = null;
let listUsers = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--email' && args[i + 1]) {
    email = args[i + 1];
    i++;
  } else if (args[i] === '--password' && args[i + 1]) {
    password = args[i + 1];
    i++;
  } else if (args[i] === '--list' || args[i] === '-l') {
    listUsers = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
📋 Script para Alterar Senha de Usuários Admin

Uso:
  node scripts/change-admin-password.js [opções]

Opções:
  --email EMAIL          Email do usuário admin
  --password SENHA       Nova senha
  --list, -l             Listar todos os usuários admin
  --help, -h             Mostrar esta ajuda

Exemplos:
  # Modo interativo
  node scripts/change-admin-password.js

  # Com parâmetros
  node scripts/change-admin-password.js --email admin@leaf.com --password novaSenha123

  # Listar usuários
  node scripts/change-admin-password.js --list
`);
    process.exit(0);
  }
}

// Interface readline para entrada interativa
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function listAdminUsers() {
  console.log('\n📋 Listando usuários admin...\n');
  
  try {
    const adminUsersRef = firestore.collection('adminUsers');
    const snapshot = await adminUsersRef.get();
    
    if (snapshot.empty) {
      console.log('⚠️  Nenhum usuário admin encontrado.');
      return;
    }
    
    console.log(`✅ Encontrados ${snapshot.size} usuário(s) admin:\n`);
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`   📧 Email: ${data.email}`);
      console.log(`   👤 Nome: ${data.displayName || data.name || 'N/A'}`);
      console.log(`   🔑 Role: ${data.role || 'N/A'}`);
      console.log(`   ✅ Ativo: ${data.active !== false ? 'Sim' : 'Não'}`);
      console.log(`   🔐 Senha configurada: ${data.passwordHash ? 'Sim' : 'Não'}`);
      console.log(`   📅 Criado em: ${data.createdAt?.toDate?.() || 'N/A'}`);
      console.log(`   🔑 ID: ${doc.id}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error.message);
    process.exit(1);
  }
}

async function changePassword() {
  console.log('\n🔐 Alterar Senha de Usuário Admin\n');
  
  // Listar usuários se não especificou email
  if (!email) {
    await listAdminUsers();
    console.log('');
  }
  
  // Solicitar email se não foi fornecido
  if (!email) {
    email = await question('📧 Email do usuário admin: ');
    email = email.trim();
    
    if (!email) {
      console.error('❌ Email é obrigatório.');
      rl.close();
      process.exit(1);
    }
  }
  
  // Buscar usuário
  const adminUsersRef = firestore.collection('adminUsers');
  const snapshot = await adminUsersRef.where('email', '==', email).limit(1).get();
  
  if (snapshot.empty) {
    console.error(`❌ Usuário com email "${email}" não encontrado.`);
    console.log('\n💡 Dica: Use --list para ver todos os usuários admin.');
    rl.close();
    process.exit(1);
  }
  
  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();
  const userId = userDoc.id;
  
  console.log(`\n✅ Usuário encontrado:`);
  console.log(`   📧 Email: ${userData.email}`);
  console.log(`   👤 Nome: ${userData.displayName || userData.name || 'N/A'}`);
  console.log(`   🔑 Role: ${userData.role || 'N/A'}`);
  console.log(`   ✅ Ativo: ${userData.active !== false ? 'Sim' : 'Não'}`);
  console.log('');
  
  // Verificar se usuário está ativo
  if (userData.active === false) {
    console.log('⚠️  Usuário está inativo. Deseja ativá-lo? (s/N): ');
    const activate = await question('');
    if (activate.trim().toLowerCase() === 's') {
      await adminUsersRef.doc(userId).update({ active: true });
      console.log('✅ Usuário ativado.');
    } else {
      console.log('❌ Operação cancelada. Usuário precisa estar ativo para alterar senha.');
      rl.close();
      process.exit(1);
    }
  }
  
  // Solicitar nova senha se não foi fornecida
  if (!password) {
    password = await question('🔒 Nova senha: ');
    password = password.trim();
    
    if (!password) {
      console.error('❌ Senha é obrigatória.');
      rl.close();
      process.exit(1);
    }
    
    if (password.length < 6) {
      console.error('❌ Senha deve ter no mínimo 6 caracteres.');
      rl.close();
      process.exit(1);
    }
    
    const confirmPassword = await question('🔒 Confirmar senha: ');
    if (password !== confirmPassword.trim()) {
      console.error('❌ Senhas não coincidem.');
      rl.close();
      process.exit(1);
    }
  }
  
  // Validar senha
  if (password.length < 6) {
    console.error('❌ Senha deve ter no mínimo 6 caracteres.');
    rl.close();
    process.exit(1);
  }
  
  console.log('\n⏳ Gerando hash da senha...');
  
  // Gerar hash da senha
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);
  
  console.log('✅ Hash gerado');
  
  // Atualizar senha no Firestore
  try {
    await adminUsersRef.doc(userId).update({
      passwordHash: passwordHash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('\n✅ Senha alterada com sucesso!');
    console.log(`\n📋 Detalhes:`);
    console.log(`   📧 Email: ${email}`);
    console.log(`   🔒 Nova senha: ${password}`);
    console.log(`\n⚠️  IMPORTANTE: Guarde a nova senha em local seguro!`);
    
  } catch (error) {
    console.error('❌ Erro ao alterar senha:', error.message);
    rl.close();
    process.exit(1);
  }
  
  rl.close();
}

// Executar
(async () => {
  try {
    if (listUsers) {
      await listAdminUsers();
    } else {
      await changePassword();
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    rl.close();
    process.exit(1);
  }
})();


