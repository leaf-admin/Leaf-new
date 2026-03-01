/**
 * Script para criar usuário admin no Firestore
 * 
 * Uso:
 *   node scripts/create-admin-user.js
 *   node scripts/create-admin-user.js --email admin@leaf.com --password senha123 --name "Administrador"
 */

const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const readline = require('readline');

// Inicializar Firebase Admin
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
    return new Promise(resolve => rl.question(query, resolve));
}

async function createAdminUser() {
    console.log('\n🚀 Criar Usuário Admin - Dashboard Leaf\n');
    
    // Verificar argumentos da linha de comando
    const args = process.argv.slice(2);
    let email = null;
    let password = null;
    let name = null;
    let role = null;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--email' && args[i + 1]) {
            email = args[i + 1];
            i++;
        } else if (args[i] === '--password' && args[i + 1]) {
            password = args[i + 1];
            i++;
        } else if (args[i] === '--name' && args[i + 1]) {
            name = args[i + 1];
            i++;
        } else if (args[i] === '--role' && args[i + 1]) {
            role = args[i + 1];
            i++;
        }
    }
    
    // Solicitar dados se não foram fornecidos
    if (!email) {
        email = await question('📧 Email do administrador: ');
    }
    
    if (!email || !email.includes('@')) {
        console.error('❌ Email inválido');
        rl.close();
        process.exit(1);
    }
    
    if (!password) {
        password = await question('🔒 Senha: ');
    }
    
    if (!password || password.length < 6) {
        console.error('❌ Senha deve ter pelo menos 6 caracteres');
        rl.close();
        process.exit(1);
    }
    
    if (!name) {
        name = await question('👤 Nome completo: ');
    }
    
    if (!name) {
        name = 'Administrador';
    }
    
    if (!role) {
        console.log('\n📋 Roles disponíveis:');
        console.log('  1. super-admin (acesso total)');
        console.log('  2. admin (acesso administrativo)');
        console.log('  3. viewer (somente leitura)');
        const roleChoice = await question('Escolha o role (1-3) [1]: ');
        
        switch (roleChoice.trim() || '1') {
            case '1':
                role = 'super-admin';
                break;
            case '2':
                role = 'admin';
                break;
            case '3':
                role = 'viewer';
                break;
            default:
                role = 'super-admin';
        }
    }
    
    // Validar role
    if (!['super-admin', 'admin', 'viewer'].includes(role)) {
        console.error('❌ Role inválido. Use: super-admin, admin ou viewer');
        rl.close();
        process.exit(1);
    }
    
    // Definir permissões baseadas no role
    const ADMIN_PERMISSIONS = {
        'super-admin': [
            'dashboard:read',
            'users:read',
            'users:write',
            'rides:read',
            'rides:write',
            'reports:read',
            'reports:write',
            'system:config',
            'notifications:send'
        ],
        'admin': [
            'dashboard:read',
            'users:read',
            'rides:read',
            'reports:read',
            'notifications:send'
        ],
        'viewer': [
            'dashboard:read'
        ]
    };
    
    const permissions = ADMIN_PERMISSIONS[role];
    
    console.log('\n⏳ Gerando hash da senha...');
    
    // Gerar hash da senha
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    console.log('✅ Hash gerado');
    
    // Verificar se usuário já existe
    const firestore = admin.firestore();
    const adminUsersRef = firestore.collection('adminUsers');
    const existingUser = await adminUsersRef.where('email', '==', email).limit(1).get();
    
    if (!existingUser.empty) {
        const existingDoc = existingUser.docs[0];
        const existingData = existingDoc.data();
        
        console.log('\n⚠️  Usuário já existe!');
        console.log(`   ID: ${existingDoc.id}`);
        console.log(`   Email: ${existingData.email}`);
        console.log(`   Role: ${existingData.role}`);
        console.log(`   Ativo: ${existingData.active !== false ? 'Sim' : 'Não'}`);
        
        const update = await question('\nDeseja atualizar este usuário? (s/N): ');
        
        if (update.toLowerCase() !== 's' && update.toLowerCase() !== 'sim') {
            console.log('❌ Operação cancelada');
            rl.close();
            process.exit(0);
        }
        
        // Atualizar usuário existente
        console.log('\n⏳ Atualizando usuário...');
        
        await adminUsersRef.doc(existingDoc.id).update({
            displayName: name,
            role: role,
            permissions: permissions,
            passwordHash: passwordHash,
            active: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✅ Usuário atualizado com sucesso!');
        console.log(`\n📋 Detalhes:`);
        console.log(`   ID: ${existingDoc.id}`);
        console.log(`   Email: ${email}`);
        console.log(`   Nome: ${name}`);
        console.log(`   Role: ${role}`);
        console.log(`   Permissões: ${permissions.length} permissões`);
        
        rl.close();
        return;
    }
    
    // Criar novo usuário
    console.log('\n⏳ Criando usuário no Firestore...');
    
    const newUserRef = adminUsersRef.doc();
    const userId = newUserRef.id;
    
    await newUserRef.set({
        email: email,
        displayName: name,
        name: name,
        role: role,
        permissions: permissions,
        passwordHash: passwordHash,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLogin: null
    });
    
    console.log('✅ Usuário criado com sucesso!');
    console.log(`\n📋 Detalhes:`);
    console.log(`   ID: ${userId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Nome: ${name}`);
    console.log(`   Role: ${role}`);
    console.log(`   Permissões: ${permissions.length} permissões`);
    console.log(`\n🔐 Credenciais de login:`);
    console.log(`   Email: ${email}`);
    console.log(`   Senha: ${password}`);
    console.log(`\n⚠️  IMPORTANTE: Guarde estas credenciais em local seguro!`);
    
    rl.close();
}

// Executar
createAdminUser()
    .then(() => {
        console.log('\n✅ Processo concluído!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erro ao criar usuário:', error);
        rl.close();
        process.exit(1);
    });
