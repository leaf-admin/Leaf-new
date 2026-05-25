#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function parseOptionValue(name) {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] || null;
}

function readFile(relativePath) {
    const absolutePath = path.join(ROOT, relativePath);
    return fs.readFileSync(absolutePath, 'utf8');
}

function listSocketBootstrapFiles() {
    const bootstrapDir = path.join(ROOT, 'bootstrap');
    return fs.readdirSync(bootstrapDir)
        .filter((fileName) => fileName.startsWith('register-socket-') && fileName.endsWith('.js'))
        .sort()
        .map((fileName) => `bootstrap/${fileName}`);
}

function normalizeLiteral(rawValue) {
    const value = String(rawValue || '').trim();
    const literalMatch = value.match(/^['"`]([^'"`]+)['"`]$/);
    if (literalMatch) {
        return literalMatch[1];
    }

    return `<expr:${value.replace(/\s+/g, ' ').slice(0, 80)}>`;
}

function collectHttpRoutes(relativePath, runtime) {
    const source = readFile(relativePath);
    const routePattern = /app\.(use|get|post|put|patch|delete)\(\s*([^,\n)]+)/g;
    const routes = [];
    let match;

    while ((match = routePattern.exec(source))) {
        const normalizedPath = normalizeLiteral(match[2]);
        if (!normalizedPath.startsWith('/')) {
            continue;
        }

        routes.push({
            runtime,
            file: relativePath,
            method: match[1].toUpperCase(),
            path: normalizedPath
        });
    }

    return routes;
}

function collectSocketEvents(relativePath, runtime) {
    const source = readFile(relativePath);
    const eventPattern = /\b(socket|io)\.(on|once)\(\s*['"`]([^'"`]+)['"`]/g;
    const events = [];
    let match;

    while ((match = eventPattern.exec(source))) {
        events.push({
            runtime,
            file: relativePath,
            target: match[1],
            kind: match[2],
            event: match[3]
        });
    }

    return events;
}

function uniqueBy(items, getKey) {
    const seen = new Set();
    return items.filter((item) => {
        const key = getKey(item);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function buildInventory() {
    const httpSources = [
        { runtime: 'vps', file: 'server.vps.js' },
        { runtime: 'modular', file: 'server.js' },
        { runtime: 'modular', file: 'bootstrap/http-middleware.js' },
        { runtime: 'modular', file: 'bootstrap/register-http-routes.js' },
        { runtime: 'modular', file: 'bootstrap/register-runtime-endpoints.js' }
    ];
    const socketSources = [
        { runtime: 'vps', file: 'server.vps.js' },
        { runtime: 'modular', file: 'server.js' },
        ...listSocketBootstrapFiles().map((file) => ({ runtime: 'modular', file }))
    ];

    const httpRoutes = uniqueBy(
        httpSources.flatMap(({ runtime, file }) => collectHttpRoutes(file, runtime)),
        (route) => `${route.runtime}:${route.file}:${route.method}:${route.path}`
    ).sort((a, b) => `${a.runtime}:${a.path}:${a.method}`.localeCompare(`${b.runtime}:${b.path}:${b.method}`));

    const socketEvents = uniqueBy(
        socketSources.flatMap(({ runtime, file }) => collectSocketEvents(file, runtime)),
        (event) => `${event.runtime}:${event.file}:${event.target}:${event.kind}:${event.event}`
    ).sort((a, b) => `${a.runtime}:${a.event}:${a.file}`.localeCompare(`${b.runtime}:${b.event}:${b.file}`));

    return {
        generatedAt: new Date().toISOString(),
        root: ROOT,
        summary: {
            httpRoutes: httpRoutes.length,
            socketEvents: socketEvents.length,
            httpRoutesByRuntime: countBy(httpRoutes, 'runtime'),
            socketEventsByRuntime: countBy(socketEvents, 'runtime')
        },
        httpRoutes,
        socketEvents
    };
}

function countBy(items, key) {
    return items.reduce((counts, item) => {
        const value = item[key] || 'unknown';
        counts[value] = (counts[value] || 0) + 1;
        return counts;
    }, {});
}

function groupByRuntime(items, getKey) {
    return items.reduce((groups, item) => {
        const runtime = item.runtime || 'unknown';
        groups[runtime] = groups[runtime] || new Map();
        const key = getKey(item);
        if (!groups[runtime].has(key)) {
            groups[runtime].set(key, []);
        }
        groups[runtime].get(key).push(item);
        return groups;
    }, {});
}

function mapKeys(map) {
    return map ? [...map.keys()] : [];
}

function compareRuntimeItems(items, getKey) {
    const groups = groupByRuntime(items, getKey);
    const vps = groups.vps || new Map();
    const modular = groups.modular || new Map();
    const vpsKeys = new Set(mapKeys(vps));
    const modularKeys = new Set(mapKeys(modular));
    const shared = [...vpsKeys].filter((key) => modularKeys.has(key)).sort();
    const onlyVps = [...vpsKeys]
        .filter((key) => !modularKeys.has(key))
        .sort()
        .map((key) => ({ key, items: vps.get(key) || [] }));
    const onlyModular = [...modularKeys]
        .filter((key) => !vpsKeys.has(key))
        .sort()
        .map((key) => ({ key, items: modular.get(key) || [] }));

    return {
        sharedCount: shared.length,
        onlyVpsCount: onlyVps.length,
        onlyModularCount: onlyModular.length,
        shared,
        onlyVps,
        onlyModular
    };
}

function buildParity(inventory) {
    return {
        httpRoutes: compareRuntimeItems(
            inventory.httpRoutes,
            (route) => `${route.method}:${route.path}`
        ),
        socketEvents: compareRuntimeItems(
            inventory.socketEvents,
            (event) => `${event.target}:${event.kind}:${event.event}`
        )
    };
}

function trimItemsForMarkdown(entry) {
    const first = entry.items[0] || {};
    return `${entry.key} (${first.file || 'unknown'})`;
}

function toMarkdown(inventory) {
    const { parity } = inventory;
    const lines = [
        '# Runtime Contract Inventory',
        '',
        `Generated at: ${inventory.generatedAt}`,
        `Root: \`${inventory.root}\``,
        '',
        '## Summary',
        '',
        `- HTTP routes: ${inventory.summary.httpRoutes}`,
        `- Socket events: ${inventory.summary.socketEvents}`,
        `- HTTP by runtime: \`${JSON.stringify(inventory.summary.httpRoutesByRuntime)}\``,
        `- Socket by runtime: \`${JSON.stringify(inventory.summary.socketEventsByRuntime)}\``,
        '',
        '## Parity',
        '',
        `- Shared HTTP routes: ${parity.httpRoutes.sharedCount}`,
        `- HTTP only in VPS runtime: ${parity.httpRoutes.onlyVpsCount}`,
        `- HTTP only in modular runtime: ${parity.httpRoutes.onlyModularCount}`,
        `- Shared socket events: ${parity.socketEvents.sharedCount}`,
        `- Socket events only in VPS runtime: ${parity.socketEvents.onlyVpsCount}`,
        `- Socket events only in modular runtime: ${parity.socketEvents.onlyModularCount}`,
        '',
        '## HTTP Only In VPS',
        ''
    ];

    if (parity.httpRoutes.onlyVps.length === 0) {
        lines.push('- None');
    } else {
        parity.httpRoutes.onlyVps.forEach((entry) => lines.push(`- ${trimItemsForMarkdown(entry)}`));
    }

    lines.push('', '## HTTP Only In Modular', '');
    if (parity.httpRoutes.onlyModular.length === 0) {
        lines.push('- None');
    } else {
        parity.httpRoutes.onlyModular.forEach((entry) => lines.push(`- ${trimItemsForMarkdown(entry)}`));
    }

    lines.push('', '## Socket Events Only In VPS', '');
    if (parity.socketEvents.onlyVps.length === 0) {
        lines.push('- None');
    } else {
        parity.socketEvents.onlyVps.forEach((entry) => lines.push(`- ${trimItemsForMarkdown(entry)}`));
    }

    lines.push('', '## Socket Events Only In Modular', '');
    if (parity.socketEvents.onlyModular.length === 0) {
        lines.push('- None');
    } else {
        parity.socketEvents.onlyModular.forEach((entry) => lines.push(`- ${trimItemsForMarkdown(entry)}`));
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function printText(inventory) {
    console.log('Runtime contract inventory');
    console.log(`Generated at: ${inventory.generatedAt}`);
    console.log(`HTTP routes: ${inventory.summary.httpRoutes}`);
    console.log(`Socket events: ${inventory.summary.socketEvents}`);
    console.log(`HTTP by runtime: ${JSON.stringify(inventory.summary.httpRoutesByRuntime)}`);
    console.log(`Socket by runtime: ${JSON.stringify(inventory.summary.socketEventsByRuntime)}`);
    console.log(`Shared HTTP routes: ${inventory.parity.httpRoutes.sharedCount}`);
    console.log(`HTTP only in VPS: ${inventory.parity.httpRoutes.onlyVpsCount}`);
    console.log(`HTTP only in modular: ${inventory.parity.httpRoutes.onlyModularCount}`);
    console.log(`Shared socket events: ${inventory.parity.socketEvents.sharedCount}`);
    console.log(`Socket only in VPS: ${inventory.parity.socketEvents.onlyVpsCount}`);
    console.log(`Socket only in modular: ${inventory.parity.socketEvents.onlyModularCount}`);
    console.log('');
    console.log('Use --json for full machine-readable output.');
    console.log('Use --markdown <path> and --write <path> to persist reports.');
}

const inventory = buildInventory();
inventory.parity = buildParity(inventory);

const jsonOutputPath = parseOptionValue('--write');
if (jsonOutputPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOutputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonOutputPath), `${JSON.stringify(inventory, null, 2)}\n`);
}

const markdownOutputPath = parseOptionValue('--markdown');
if (markdownOutputPath) {
    fs.mkdirSync(path.dirname(path.resolve(markdownOutputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(markdownOutputPath), toMarkdown(inventory));
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(inventory, null, 2));
} else {
    printText(inventory);
}

if (process.argv.includes('--fail-on-vps-only')) {
    const httpOnlyVps = inventory.parity.httpRoutes.onlyVpsCount;
    const socketOnlyVps = inventory.parity.socketEvents.onlyVpsCount;
    if (httpOnlyVps > 0 || socketOnlyVps > 0) {
        console.error(
            `Runtime parity failed: HTTP only in VPS=${httpOnlyVps}; socket only in VPS=${socketOnlyVps}`
        );
        process.exitCode = 1;
    }
}
