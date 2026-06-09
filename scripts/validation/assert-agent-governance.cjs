#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");

const requiredFiles = [
  {
    file: "AGENTS.md",
    snippets: [
      "# LEAF Agent Rules",
      "## Required Rules",
      "## Business Rules",
      "## Stop Conditions",
      "## Validation Ladder",
    ],
  },
  {
    file: "PROJECT_RULES.md",
    snippets: [
      "# LEAF Project Rules",
      "## Trade-offs",
      "## Guard Rails",
      "## Stop Conditions",
      "## Branch And PR Rules",
    ],
  },
  {
    file: "ARCHITECTURE.md",
    snippets: [
      "# LEAF Architecture",
      "## Runtime Backend-first",
      "## Payment Invariants",
      "## Ride Lifecycle Invariants",
      "## Legacy Policy",
    ],
  },
  {
    file: "docs/tasks/README.md",
    snippets: [
      "# LEAF Agent Task Workflow",
      "## GitHub Automation",
      "## Codex Task Breakdown Prompt",
      "## OpenCode Execution Prompt",
      "## Codex Review Prompt",
    ],
  },
  {
    file: "docs/tasks/OPENCODE_GITHUB_AUTOMATION.md",
    snippets: [
      "# OpenCode GitHub Automation",
      "## Required GitHub Configuration",
      "## Verboo Code Provider",
      "## Daily Flow",
      "## Guard Rails",
      "## Stop Conditions",
    ],
  },
  {
    file: "docs/tasks/TASK_TEMPLATE.md",
    snippets: [
      "# Task Template",
      "## Out Of Scope",
      "## Acceptance Criteria",
      "## Required Tests",
      "## OpenCode Prompt",
    ],
  },
  {
    file: ".github/ISSUE_TEMPLATE/task.md",
    snippets: [
      "name: Task LEAF",
      "## Fora de escopo",
      "## Criterios de aceite",
      "## Testes obrigatorios",
      "## Prompt para OpenCode",
    ],
  },
  {
    file: ".github/workflows/opencode.yml",
    snippets: [
      "name: opencode",
      "issue_comment:",
      "pull_request_review_comment:",
      "contains(github.event.comment.body, '/oc')",
      "github.event.comment.author_association == 'OWNER'",
      "VERBOO_API_KEY",
      "anomalyco/opencode/github@latest",
      "use_github_token: true",
      "share: false",
      "npm run governance:check",
    ],
  },
  {
    file: "opencode.json",
    snippets: [
      "\"$schema\": \"https://opencode.ai/config.json\"",
      "\"verboo\"",
      "\"@ai-sdk/openai-compatible\"",
      "\"https://code.verboo.ai/router/v1\"",
      "\"apiKey\": \"{env:VERBOO_API_KEY}\"",
      "\"deepseek-v4-flash\"",
    ],
  },
];

const findings = [];

for (const item of requiredFiles) {
  const fullPath = path.join(rootDir, item.file);
  if (!fs.existsSync(fullPath)) {
    findings.push({ file: item.file, issue: "missing file" });
    continue;
  }

  const contents = fs.readFileSync(fullPath, "utf8");
  for (const snippet of item.snippets) {
    if (!contents.includes(snippet)) {
      findings.push({ file: item.file, issue: "missing required snippet", snippet });
    }
  }
}

const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
if (packageJson.scripts?.["governance:check"] !== "node scripts/validation/assert-agent-governance.cjs") {
  findings.push({
    file: "package.json",
    issue: "missing governance:check script",
  });
}

const result = {
  ok: findings.length === 0,
  checkedFiles: requiredFiles.map((item) => item.file),
  findings,
};

console.log(JSON.stringify(result, null, 2));

if (findings.length > 0) {
  process.exitCode = 1;
}
