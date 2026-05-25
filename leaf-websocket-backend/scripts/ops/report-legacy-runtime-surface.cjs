#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const TARGET_PATHS = [
  'server.js',
  'server.vps.js',
  'firebase-config.js',
  'bootstrap',
  'routes',
  'services',
  'utils',
  'workers',
  'middleware',
  'listeners'
];
const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const IGNORE_PARTS = new Set(['node_modules', 'coverage', 'reports', '.git', 'tmp']);

const CATEGORY_DEFINITIONS = [
  {
    key: 'legacy_feature_flags',
    description: 'Flags de runtime legado e espelhos RTDB',
    patterns: [
      /ENABLE_LEGACY_[A-Z0-9_]+/g,
      /[A-Z0-9_]+_ENABLE_LEGACY_[A-Z0-9_]+/g,
      /ENABLE_[A-Z0-9_]*RTDB[A-Z0-9_]*/g,
      /[A-Z0-9_]*RTDB_MIRROR[A-Z0-9_]*/g
    ]
  },
  {
    key: 'rtdb_access',
    description: 'Acessos diretos ao Realtime Database',
    patterns: [
      /\bgetRealtimeDB\s*\(/g,
      /\badmin\.database\s*\(/g,
      /\bsyncToRealtimeDB\s*\(/g
    ]
  },
  {
    key: 'legacy_routes',
    description: 'Rotas HTTP explicitamente legadas',
    patterns: [
      /\/api\/legacy\//g
    ]
  },
  {
    key: 'legacy_fallback_logs',
    description: 'Logs e mensagens de fallback legado',
    patterns: [
      /Fallback RTDB/g,
      /legacy fallback/gi,
      /rtdb_import/g,
      /rtdb_mirror/g,
      /rtdb_migrated/g
    ]
  }
];

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function walkFiles(entryPath, results = []) {
  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entryPath)) {
      if (IGNORE_PARTS.has(child)) continue;
      walkFiles(path.join(entryPath, child), results);
    }
    return results;
  }

  if (CODE_EXTENSIONS.has(path.extname(entryPath))) {
    results.push(entryPath);
  }
  return results;
}

function collectTargetFiles() {
  const files = [];
  for (const target of TARGET_PATHS) {
    const fullPath = path.join(ROOT_DIR, target);
    if (!fs.existsSync(fullPath)) continue;
    walkFiles(fullPath, files);
  }
  return files.sort();
}

function countMatches(line, regex) {
  const matches = line.match(regex);
  return matches ? matches.length : 0;
}

function buildCategorySummary() {
  return CATEGORY_DEFINITIONS.reduce((acc, category) => {
    acc[category.key] = {
      description: category.description,
      totalMatches: 0,
      files: {}
    };
    return acc;
  }, {});
}

function registerMatch(summary, categoryKey, relativePath, lineNumber, lineContent, count) {
  const category = summary[categoryKey];
  category.totalMatches += count;
  if (!category.files[relativePath]) {
    category.files[relativePath] = {
      totalMatches: 0,
      matches: []
    };
  }
  category.files[relativePath].totalMatches += count;
  category.files[relativePath].matches.push({
    line: lineNumber,
    count,
    content: lineContent.trim().slice(0, 220)
  });
}

function analyzeFiles(files) {
  const summary = buildCategorySummary();
  const perFile = {};

  for (const filePath of files) {
    const relativePath = path.relative(ROOT_DIR, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let fileTotal = 0;

    lines.forEach((line, index) => {
      CATEGORY_DEFINITIONS.forEach((category) => {
        const count = category.patterns.reduce((sum, pattern) => sum + countMatches(line, pattern), 0);
        if (count > 0) {
          registerMatch(summary, category.key, relativePath, index + 1, line, count);
          fileTotal += count;
        }
      });
    });

    if (fileTotal > 0) {
      perFile[relativePath] = fileTotal;
    }
  }

  return {
    categories: summary,
    topFiles: Object.entries(perFile)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 25)
      .map(([file, totalMatches]) => ({ file, totalMatches }))
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Legacy Runtime Surface Report',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- scannedFiles: ${report.scannedFiles}`,
    ''
  ];

  for (const category of CATEGORY_DEFINITIONS) {
    const data = report.categories[category.key];
    lines.push(`## ${category.key}`);
    lines.push(`- description: ${data.description}`);
    lines.push(`- totalMatches: ${data.totalMatches}`);
    const topFiles = Object.entries(data.files)
      .sort((left, right) => right[1].totalMatches - left[1].totalMatches)
      .slice(0, 10);
    if (topFiles.length === 0) {
      lines.push('- topFiles: none');
    } else {
      lines.push('- topFiles:');
      for (const [file, details] of topFiles) {
        lines.push(`  - ${file}: ${details.totalMatches}`);
      }
    }
    lines.push('');
  }

  lines.push('## overall_top_files');
  if (!report.topFiles.length) {
    lines.push('- none');
  } else {
    report.topFiles.forEach((entry) => {
      lines.push(`- ${entry.file}: ${entry.totalMatches}`);
    });
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function main() {
  ensureDirectory(REPORTS_DIR);
  const files = collectTargetFiles();
  const analysis = analyzeFiles(files);
  const timestamp = Date.now();
  const report = {
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    ...analysis
  };

  const jsonPath = path.join(REPORTS_DIR, `legacy-runtime-surface-${timestamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `legacy-runtime-surface-${timestamp}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderMarkdown(report));

  process.stdout.write(`${JSON.stringify({ jsonPath, mdPath, report }, null, 2)}\n`);
}

main();
