const { execSync } = require('child_process');
try {
    execSync('npx jest __tests__/auth.test.js --ci --json', { encoding: 'utf8', stdio: 'pipe' });
    console.log('Success!');
} catch (e) {
    console.log('--- STDOUT ---');
    console.log(e.stdout);
    console.log('--- STDERR ---');
    console.log(e.stderr);
}
