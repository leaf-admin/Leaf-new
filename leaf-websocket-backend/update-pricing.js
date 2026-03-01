const admin = require('firebase-admin');
const serviceAccount = require('./firebase-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
    });
}

const db = admin.database();

async function updateCarTypes() {
    try {
        console.log("Configurando parâmetros Leaf Plus e Leaf Elite no banco de produção...");

        const carTypesRef = db.ref('cartypes');

        // Leaf Plus configs
        // Base: 2.79, Fixo: 1.10, perMin: 0.26 => perHour: 15.60, perKm: 1.53, MinFare: 8.50
        const leafPlus = {
            name: 'Leaf Plus',
            base_fare: 2.79,
            fixed_fee: 1.10,
            rate_per_hour: 15.60, // 0.26 * 60
            rate_per_unit_distance: 1.53,
            min_fare: 8.50,
            convenience_fees: 0,
            convenience_fee_type: 'flat',
            extra_info: 'Capacity: 4, Econo',
            image: "https://cdn.pixabay.com/photo/2017/06/03/08/11/car-2368193_640.png"
        };

        // Leaf Elite configs
        // Base: 4.98, Fixo: 1.80, perMin: 0.29 => perHour: 17.40, perKm: 2.41, MinFare: 10.50
        const leafElite = {
            name: 'Leaf Elite',
            base_fare: 4.98,
            fixed_fee: 1.80,
            rate_per_hour: 17.40, // 0.29 * 60
            rate_per_unit_distance: 2.41,
            min_fare: 10.50,
            convenience_fees: 0,
            convenience_fee_type: 'flat',
            extra_info: 'Capacity: 4, Premium',
            image: "https://cdn.pixabay.com/photo/2022/01/23/18/20/car-6961567_640.png"
        };

        await carTypesRef.set({
            'plus': leafPlus,
            'elite': leafElite
        });

        // Also make sure 'settings' has the required format to not crash the app
        await db.ref('settings').update({
            symbol: 'R$',
            code: 'BRL',
            decimal: 2,
            convert_to_mile: false,
            useDistanceMatrix: false,
            prepaid: false
        });

        console.log("Tabela 'cartypes' e 'settings' perfeitamente registradas!");
    } catch (e) {
        console.error("Erro:", e);
    } finally {
        process.exit();
    }
}
updateCarTypes();
