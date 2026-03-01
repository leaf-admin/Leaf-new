const admin = require('firebase-admin');
const serviceAccount = require('./firebase-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
    });
}

const db = admin.database();

async function checkRoot() {
    try {
        console.log("Baixando chaves da raiz do banco...");
        let snap = await db.ref('/').once('value');
        let data = snap.val();
        if (data) {
            console.log("Chaves encontradas no DB:", Object.keys(data));
        } else {
            console.log("BANCO DE DADOS TOTALMENTE VAZIO.");
        }
    } catch (e) {
        console.error("Erro:", e);
    } finally {
        process.exit();
    }
}
checkRoot();
