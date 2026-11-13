const fs = require('fs');
const path = require('path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../../..', relative), 'utf8');

describe('Santiago zero-downtime deploy contract', () => {
  const nginx = read('nginx.santiago.conf');
  const compose = read('docker-compose.santiago.yml');
  const upstream = read('nginx.d/upstream-leaf-backend.conf');
  const wrapper = read('scripts/deploy-santiago-docker.sh');

  it('keeps the gateway list in an included file the deploy can rewrite', () => {
    expect(nginx).toContain('include /etc/nginx/leaf.d/upstream-leaf-backend.conf;');
    expect(nginx).not.toMatch(/upstream leaf_backend \{[^}]*server websocket:3001/);
    expect(upstream).toContain('server websocket:3001 max_fails=3 fail_timeout=10s;');
    expect(upstream).toContain('server websocket-gateway-2:3001 max_fails=3 fail_timeout=10s;');
    expect(upstream).not.toContain(' down');
    expect(compose).toContain('./nginx.d:/etc/nginx/leaf.d:ro');
    expect(wrapper).toContain('export NGINX_UPSTREAM_FILE="nginx.d/upstream-leaf-backend.conf"');
  });

  it('gives each gateway time to drain before Docker kills it', () => {
    const gatewayBlocks = compose.split('\n  websocket').slice(1);
    expect(gatewayBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of gatewayBlocks.slice(0, 2)) {
      expect(block.split('\n  websocket-gateway-3')[0]).toContain('stop_grace_period: 45s');
    }
  });
});

describe('Santiago load balancer edge contract', () => {
  const nginx = read('nginx.santiago.conf');
  const compose = read('docker-compose.santiago.yml');

  it('serves the load balancer on PROXY-protocol listeners next to the public ones', () => {
    expect(nginx).toContain('listen 80 default_server;');
    expect(nginx).toContain('listen 8080 proxy_protocol;');
    expect(nginx).toContain('listen 443 ssl default_server;');
    expect(nginx).toContain('listen 8443 ssl proxy_protocol;');
  });

  it('forwards exactly one client address, from the PROXY header when present', () => {
    expect(nginx).toMatch(/map \$proxy_protocol_addr \$leaf_client_addr \{\s*''\s+\$remote_addr;\s*default \$proxy_protocol_addr;\s*\}/);
    expect(nginx).not.toContain('$proxy_add_x_forwarded_for');
    expect(nginx).not.toContain('X-Real-IP $remote_addr');
    expect(nginx).toContain('proxy_set_header X-Forwarded-For $leaf_client_addr;');
  });

  it('keeps the PROXY listeners off the public interface', () => {
    expect(compose).toContain('"${SANTIAGO_LB_BIND_IP:-127.0.0.1}:8080:8080"');
    expect(compose).toContain('"${SANTIAGO_LB_BIND_IP:-127.0.0.1}:8443:8443"');
  });
});
