/**
 * Script para criar/atualizar usuário admin com perfis de acesso padronizados.
 *
 * Perfis:
 * - super-admin: acesso total (inclui exclusão de dados)
 * - support: operação de motoristas/veículos/suporte, sem financeiro/monitoramento e sem exclusão
 * - development: acesso amplo operacional/técnico, sem financeiro e sem exclusão
 *
 * Uso:
 *   node scripts/create-admin-profile-user.js
 *   node scripts/create-admin-profile-user.js --profile support --email suporte@leaf.app.br --password "SenhaForte123!" --name "Equipe Suporte"
 */

const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const readline = require('readline');

try {
  const firebaseConfig = require('../firebase-config');
  firebaseConfig.initializeFirebase();
  console.log('✅ Firebase inicializado');
} catch (error) {
  console.error('❌ Erro ao inicializar Firebase:', error.message);
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

const PROFILE_DEFINITIONS = {
  'super-admin': {
    role: 'super-admin',
    canDeleteData: true,
    financialAccess: true,
    monitoringAccess: true,
    permissions: [
      'dashboard:read',
      'users:read',
      'users:write',
      'drivers:read',
      'drivers:write',
      'drivers:documents:review',
      'vehicles:read',
      'vehicles:write',
      'support:read',
      'support:write',
      'support:tickets:read',
      'support:tickets:write',
      'support:chat:read',
      'support:chat:write',
      'maps:read',
      'maps:write',
      'reports:read',
      'reports:write',
      'notifications:read',
      'notifications:send',
      'programs:read',
      'programs:write',
      'promotions:read',
      'promotions:write',
      'waitlist:read',
      'waitlist:write',
      'monitoring:read',
      'monitoring:write',
      'observability:read',
      'financial:read',
      'financial:write',
      'subscriptions:read',
      'subscriptions:write',
      'system:config',
      'data:delete'
    ]
  },
  support: {
    role: 'support',
    canDeleteData: false,
    financialAccess: false,
    monitoringAccess: false,
    permissions: [
      'dashboard:read',
      'users:read',
      'drivers:read',
      'drivers:write',
      'drivers:documents:review',
      'vehicles:read',
      'vehicles:write',
      'support:read',
      'support:write',
      'support:tickets:read',
      'support:tickets:write',
      'support:chat:read',
      'support:chat:write',
      'maps:read',
      'reports:read',
      'waitlist:read'
    ]
  },
  development: {
    role: 'development',
    canDeleteData: false,
    financialAccess: false,
    monitoringAccess: true,
    permissions: [
      'dashboard:read',
      'users:read',
      'users:write',
      'drivers:read',
      'drivers:write',
      'drivers:documents:review',
      'vehicles:read',
      'vehicles:write',
      'support:read',
      'support:write',
      'support:tickets:read',
      'support:tickets:write',
      'support:chat:read',
      'support:chat:write',
      'maps:read',
      'maps:write',
      'reports:read',
      'reports:write',
      'notifications:read',
      'notifications:send',
      'programs:read',
      'programs:write',
      'promotions:read',
      'promotions:write',
      'waitlist:read',
      'waitlist:write',
      'monitoring:read',
      'monitoring:write',
      'observability:read'
    ]
  }
};

function parseArgs(argv = []) {
  const args = {
    profile: null,
    email: null,
    password: null,
    name: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === '--profile' && next) {
      args.profile = String(next).trim().toLowerCase();
      i += 1;
      continue;
    }
    if (current === '--email' && next) {
      args.email = String(next).trim().toLowerCase();
      i += 1;
      continue;
    }
    if (current === '--password' && next) {
      args.password = String(next);
      i += 1;
      continue;
    }
    if (current === '--name' && next) {
      args.name = String(next).trim();
      i += 1;
      continue;
    }
  }

  return args;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function validateProfile(profile) {
  return Object.prototype.hasOwnProperty.call(PROFILE_DEFINITIONS, profile);
}

async function collectInput(initialArgs) {
  const result = { ...initialArgs };

  if (!result.profile || !validateProfile(result.profile)) {
    console.log('\n📋 Perfis disponíveis:');
    console.log('  1. super-admin');
    console.log('  2. support');
    console.log('  3. development');
    const choice = (await question('Escolha o perfil (1-3) [1]: ')).trim() || '1';
    if (choice === '2') result.profile = 'support';
    else if (choice === '3') result.profile = 'development';
    else result.profile = 'super-admin';
  }

  if (!result.email) {
    result.email = (await question('📧 Email: ')).trim().toLowerCase();
  }
  if (!isValidEmail(result.email)) {
    throw new Error('Email inválido');
  }

  if (!result.password) {
    result.password = await question('🔒 Senha (mín. 10 caracteres): ');
  }
  if (!result.password || result.password.length < 10) {
    throw new Error('Senha deve ter pelo menos 10 caracteres');
  }

  if (!result.name) {
    result.name = (await question('👤 Nome completo: ')).trim();
  }
  if (!result.name) {
    result.name = 'Administrador Leaf';
  }

  return result;
}

async function upsertAdminUser({ profile, email, password, name }) {
  const profileDefinition = PROFILE_DEFINITIONS[profile];
  const firestore = admin.firestore();
  const adminUsersRef = firestore.collection('adminUsers');

  const hashedPassword = await bcrypt.hash(password, 10);

  const payload = {
    email,
    displayName: name,
    name,
    role: profileDefinition.role,
    profileType: profile,
    permissions: profileDefinition.permissions,
    canDeleteData: profileDefinition.canDeleteData,
    accessPolicy: {
      profile,
      financialAccess: profileDefinition.financialAccess,
      monitoringAccess: profileDefinition.monitoringAccess,
      canDeleteData: profileDefinition.canDeleteData,
      updatedAt: new Date().toISOString()
    },
    passwordHash: hashedPassword,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const existing = await adminUsersRef.where('email', '==', email).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    await adminUsersRef.doc(doc.id).update(payload);
    return { created: false, userId: doc.id, role: profileDefinition.role };
  }

  const newRef = adminUsersRef.doc();
  await newRef.set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastLogin: null
  });
  return { created: true, userId: newRef.id, role: profileDefinition.role };
}

async function main() {
  try {
    console.log('\n🚀 Provisionamento de Admin por Perfil\n');
    const args = parseArgs(process.argv.slice(2));
    const input = await collectInput(args);
    const result = await upsertAdminUser(input);

    const profile = PROFILE_DEFINITIONS[input.profile];
    console.log(result.created ? '\n✅ Usuário criado com sucesso!' : '\n✅ Usuário atualizado com sucesso!');
    console.log('\n📋 Detalhes:');
    console.log(`   ID: ${result.userId}`);
    console.log(`   Perfil: ${input.profile}`);
    console.log(`   Role: ${result.role}`);
    console.log(`   Email: ${input.email}`);
    console.log(`   Nome: ${input.name}`);
    console.log(`   Permissões: ${profile.permissions.length}`);
    console.log(`   Financeiro: ${profile.financialAccess ? 'Sim' : 'Não'}`);
    console.log(`   Monitoramento: ${profile.monitoringAccess ? 'Sim' : 'Não'}`);
    console.log(`   Pode excluir dados: ${profile.canDeleteData ? 'Sim' : 'Não'}`);
    console.log('\n🔐 Credenciais de login:');
    console.log(`   Email: ${input.email}`);
    console.log(`   Senha: ${input.password}`);
    console.log('\n⚠️  Guarde estas credenciais em local seguro.');
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main();
