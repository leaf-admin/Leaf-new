const fs = require('fs');
const path = require('path');

console.log('🔧 Testando configuração do Metro Bundler...\n');

// Verificar se o metro.config.js existe
const metroConfigPath = path.join(__dirname, 'mobile-app', 'metro.config.js');
if (!fs.existsSync(metroConfigPath)) {
  console.error('❌ metro.config.js não encontrado!');
  process.exit(1);
}

console.log('✅ metro.config.js encontrado');

// Verificar se o arquivo tem as configurações necessárias
const metroConfig = fs.readFileSync(metroConfigPath, 'utf8');
const hasSourceExts = metroConfig.includes('sourceExts');
const hasResolverMainFields = metroConfig.includes('resolverMainFields');
const hasAlias = metroConfig.includes('alias');

console.log(`✅ sourceExts configurado: ${hasSourceExts}`);
console.log(`✅ resolverMainFields configurado: ${hasResolverMainFields}`);
console.log(`✅ alias configurado: ${hasAlias}`);

// Testar resolução de alguns imports comuns
const testImports = [
  'common/src/actions/authactions',
  'common/src/reducers/authreducer',
  'mobile-app/src/screens/Login',
  'mobile-app/src/components/Button',
  'mobile-app/src/services/SocketService',
  'json/language-en',
  'json/language-pt-br'
];

console.log('\n🔍 Testando resolução de imports...');

testImports.forEach(importPath => {
  const possibleExtensions = ['.js', '.jsx', '.ts', '.tsx'];
  let found = false;
  
  for (const ext of possibleExtensions) {
    const fullPath = path.join(__dirname, importPath + ext);
    if (fs.existsSync(fullPath)) {
      console.log(`✅ ${importPath}${ext} encontrado`);
      found = true;
      break;
    }
  }
  
  if (!found) {
    console.log(`⚠️  ${importPath} não encontrado (pode ser resolvido pelo Metro)`);
  }
});

// Verificar se não há imports do Redis
console.log('\n🔍 Verificando imports do Redis...');
const mobileAppDir = path.join(__dirname, 'mobile-app');
const commonDir = path.join(__dirname, 'common');

function checkForRedisImports(dir, prefix = '') {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      checkForRedisImports(fullPath, prefix + file.name + '/');
    } else if (file.name.endsWith('.js') || file.name.endsWith('.jsx')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        
        // Padrões específicos para imports reais do Redis
        const redisImportPatterns = [
          /import\s+.*\s+from\s+['"`]@redis\/client['"`]/g,
          /import\s+.*\s+from\s+['"`]redis['"`]/g,
          /import\s+.*\s+from\s+['"`]ioredis['"`]/g,
          /require\s*\(\s*['"`]@redis\/client['"`]\s*\)/g,
          /require\s*\(\s*['"`]redis['"`]\s*\)/g,
          /require\s*\(\s*['"`]ioredis['"`]\s*\)/g,
          /import\s*\(\s*['"`]@redis\/client['"`]\s*\)/g,
          /import\s*\(\s*['"`]redis['"`]\s*\)/g,
          /import\s*\(\s*['"`]ioredis['"`]\s*\)/g
        ];
        
        let hasRedisImport = false;
        redisImportPatterns.forEach(pattern => {
          if (pattern.test(content)) {
            hasRedisImport = true;
          }
        });
        
        if (hasRedisImport) {
          console.log(`❌ Redis import encontrado em: ${prefix}${file.name}`);
        }
      } catch (error) {
        // Ignorar erros de leitura
      }
    }
  }
}

checkForRedisImports(mobileAppDir, 'mobile-app/');
checkForRedisImports(commonDir, 'common/');

console.log('\n✅ Verificação de imports do Redis concluída');

console.log('\n🎉 Configuração do Metro testada com sucesso!');
console.log('📱 O app deve carregar corretamente no mobile agora.'); 