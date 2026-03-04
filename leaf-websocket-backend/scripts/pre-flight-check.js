const { execSync } = require('child_process');
const Redis = require('ioredis');

async function checkPort3001() {
    console.log('🔍 Checking port 3001...');
    try {
        const output = execSync('lsof -i :3001', { encoding: 'utf-8' });
        if (output) {
            console.error('❌ Port 3001 is ALREADY in use!');
            console.log(output);
            console.log('💡 Try running: pkill -f node');
            return false;
        }
    } catch (e) {
        // lsof returns exit code 1 if no process is found
        console.log('✅ Port 3001 is free.');
        return true;
    }
    return true;
}

async function checkRedis() {
    console.log('🔍 Checking Redis connection...');
    const redis = new Redis({
        host: 'localhost',
        port: 6380,
        password: 'leaf_password_production_2025_secure' // Based on server.log observation
    });

    try {
        await redis.ping();
        console.log('✅ Redis is connected.');

        const type = await redis.type('bookings:active');
        console.log(`📊 Type of 'bookings:active': ${type}`);

        if (type !== 'hash' && type !== 'none') {
            console.warn(`⚠️ 'bookings:active' is type '${type}', which is NOT a hash! Fix needed.`);
        }

        await redis.quit();
        return true;
    } catch (e) {
        console.error(`❌ Redis connection failed: ${e.message}`);
        return false;
    }
}

async function main() {
    console.log('🚀 Starting Pre-flight Check...');
    const portOk = await checkPort3001();
    const redisOk = await checkRedis();

    if (portOk && redisOk) {
        console.log('🏁 Pre-flight check PASSED! Ready to start the server.');
        process.exit(0);
    } else {
        console.error('⛔ Pre-flight check FAILED! Fix the issues above before starting.');
        process.exit(1);
    }
}

main();
