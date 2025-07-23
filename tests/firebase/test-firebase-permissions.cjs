const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get } = require('firebase/database');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');
const { getAuth, signInAnonymously } = require('firebase/auth');

class FirebasePermissionsTest {
    constructor() {
        this.testId = `perm_test_${Date.now()}`;
        
        // Firebase config (configuração correta do projeto)
        this.firebaseConfig = {
            apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
            authDomain: "leaf-reactnative.firebaseapp.com",
            databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
            projectId: "leaf-reactnative",
            storageBucket: "leaf-reactnative.firebasestorage.app",
            messagingSenderId: "106504629884",
            appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
            measurementId: "G-22368DBCY9"
        };
        
        this.app = initializeApp(this.firebaseConfig);
        this.database = getDatabase(this.app);
        this.firestore = getFirestore(this.app);
        this.auth = getAuth(this.app);
        this.authenticated = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== AUTENTICANDO NO FIREBASE ===', 'AUTH');
        
        try {
            const userCredential = await signInAnonymously(this.auth);
            this.authenticated = true;
            this.log(`✅ Autenticado: ${userCredential.user.uid}`, 'SUCCESS');
            return true;
        } catch (error) {
            this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testRealtimeDatabaseWrite() {
        this.log('=== TESTE 1: REALTIME DATABASE WRITE ===', 'TEST');
        
        try {
            const testData = {
                lat: -23.5505,
                lng: -46.6333,
                timestamp: Date.now(),
                test: true
            };
            
            const testRef = ref(this.database, `test_permissions/${this.testId}`);
            await set(testRef, testData);
            
            this.log('✅ Escrita no Realtime Database funcionou!', 'SUCCESS');
            return true;
            
        } catch (error) {
            this.log(`❌ Erro na escrita do Realtime Database: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testRealtimeDatabaseRead() {
        this.log('=== TESTE 2: REALTIME DATABASE READ ===', 'TEST');
        
        try {
            const testRef = ref(this.database, `test_permissions/${this.testId}`);
            const snapshot = await get(testRef);
            
            if (snapshot.exists()) {
                const data = snapshot.val();
                this.log('✅ Leitura do Realtime Database funcionou!', 'SUCCESS');
                this.log(`   Dados: ${JSON.stringify(data)}`, 'INFO');
                return true;
            } else {
                this.log('❌ Dados não encontrados no Realtime Database', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro na leitura do Realtime Database: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testFirestoreWrite() {
        this.log('=== TESTE 3: FIRESTORE WRITE ===', 'TEST');
        
        try {
            const testData = {
                testId: this.testId,
                timestamp: Date.now(),
                test: true,
                message: 'Teste de permissões'
            };
            
            const testDoc = doc(this.firestore, 'test_permissions', this.testId);
            await setDoc(testDoc, testData);
            
            this.log('✅ Escrita no Firestore funcionou!', 'SUCCESS');
            return true;
            
        } catch (error) {
            this.log(`❌ Erro na escrita do Firestore: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testFirestoreRead() {
        this.log('=== TESTE 4: FIRESTORE READ ===', 'TEST');
        
        try {
            const testDoc = doc(this.firestore, 'test_permissions', this.testId);
            const docSnap = await getDoc(testDoc);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                this.log('✅ Leitura do Firestore funcionou!', 'SUCCESS');
                this.log(`   Dados: ${JSON.stringify(data)}`, 'INFO');
                return true;
            } else {
                this.log('❌ Dados não encontrados no Firestore', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro na leitura do Firestore: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Limpar dados de teste do Realtime Database
            const testRef = ref(this.database, `test_permissions/${this.testId}`);
            await set(testRef, null);
            this.log('✅ Dados de teste removidos do Realtime Database', 'SUCCESS');
            
            // Limpar dados de teste do Firestore
            const testDoc = doc(this.firestore, 'test_permissions', this.testId);
            await setDoc(testDoc, {});
            this.log('✅ Dados de teste removidos do Firestore', 'SUCCESS');
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runPermissionsTest() {
        this.log('🚀 INICIANDO TESTE DE PERMISSÕES FIREBASE', 'START');
        
        const results = {
            auth: false,
            rtdbWrite: false,
            rtdbRead: false,
            firestoreWrite: false,
            firestoreRead: false
        };
        
        try {
            // 1. Autenticação
            results.auth = await this.authenticateFirebase();
            if (!results.auth) {
                this.log('❌ Falha na autenticação', 'ERROR');
                return results;
            }
            
            // 2. Teste Realtime Database
            results.rtdbWrite = await this.testRealtimeDatabaseWrite();
            results.rtdbRead = await this.testRealtimeDatabaseRead();
            
            // 3. Teste Firestore
            results.firestoreWrite = await this.testFirestoreWrite();
            results.firestoreRead = await this.testFirestoreRead();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. Firebase Auth: ${results.auth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Realtime DB Write: ${results.rtdbWrite ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Realtime DB Read: ${results.rtdbRead ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Firestore Write: ${results.firestoreWrite ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`5. Firestore Read: ${results.firestoreRead ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (results.rtdbWrite && results.rtdbRead) {
                this.log('🎉 PERMISSÕES REALTIME DATABASE OK!', 'SUCCESS');
            } else {
                this.log('🚨 PROBLEMAS NO REALTIME DATABASE', 'ERROR');
            }
            
            if (results.firestoreWrite && results.firestoreRead) {
                this.log('🎉 PERMISSÕES FIRESTORE OK!', 'SUCCESS');
            } else {
                this.log('🚨 PROBLEMAS NO FIRESTORE', 'ERROR');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante os testes: ${error.message}`, 'ERROR');
        } finally {
            await this.cleanup();
        }
        
        return results;
    }
}

// Executar teste
async function runFirebasePermissionsTest() {
    const tester = new FirebasePermissionsTest();
    return await tester.runPermissionsTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runFirebasePermissionsTest()
        .then(results => {
            console.log('\n🏁 Teste de permissões Firebase concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { FirebasePermissionsTest, runFirebasePermissionsTest }; 