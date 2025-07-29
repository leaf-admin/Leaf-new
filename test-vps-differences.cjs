const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function testVPSDifferences() {
  console.log('🔍 Testando diferenças entre VPSs...\n');

  try {
    // Testar VPS Vultr
    console.log('1. Testando VPS Vultr:');
    const vultrResponse = await execAsync('curl -s https://api.leaf.app.br/dashboard/vps/vultr');
    const vultrData = JSON.parse(vultrResponse.stdout);
    console.log('✅ Vultr:', {
      cpu: vultrData.cpu + '%',
      memory: vultrData.memory + '%',
      disk: vultrData.disk + '%',
      uptime: vultrData.uptime,
      hostname: vultrData.hostname
    });

    // Testar VPS Hostinger
    console.log('\n2. Testando VPS Hostinger:');
    const hostingerResponse = await execAsync('curl -s https://api.leaf.app.br/dashboard/vps/hostinger');
    const hostingerData = JSON.parse(hostingerResponse.stdout);
    console.log('✅ Hostinger:', {
      cpu: hostingerData.cpu + '%',
      memory: hostingerData.memory + '%',
      disk: hostingerData.disk + '%',
      uptime: hostingerData.uptime,
      status: hostingerData.status
    });

    // Comparar diferenças
    console.log('\n3. Comparação:');
    console.log('📊 Vultr vs Hostinger:');
    console.log(`   CPU: ${vultrData.cpu}% vs ${hostingerData.cpu}%`);
    console.log(`   Memory: ${vultrData.memory}% vs ${hostingerData.memory}%`);
    console.log(`   Disk: ${vultrData.disk}% vs ${hostingerData.disk}%`);
    console.log(`   Status: ${vultrData.status} vs ${hostingerData.status}`);

    // Testar Redis
    console.log('\n4. Testando Redis:');
    const redisResponse = await execAsync('curl -s https://api.leaf.app.br/dashboard/redis');
    const redisData = JSON.parse(redisResponse.stdout);
    console.log('✅ Redis:', {
      status: redisData.status,
      memory: redisData.memory.used + 'MB',
      keys: redisData.keys.total,
      connections: redisData.connections
    });

    console.log('\n🎯 Agora os VPSs devem mostrar dados reais e diferentes!');

  } catch (error) {
    console.error('❌ Erro ao testar VPSs:', error.message);
  }
}

testVPSDifferences(); 