#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE_DIR = path.resolve(__dirname, "../..");
const LAB_DIR = path.join(MOBILE_DIR, "ux-lab");
const JOURNEYS_PATH = path.join(LAB_DIR, "config", "journeys.json");
const RUBRIC_PATH = path.join(LAB_DIR, "config", "rubric.json");
const TEMPLATE_PATH = path.join(LAB_DIR, "templates", "observation.json");
const DEFAULT_RUNS_DIR = path.join(MOBILE_DIR, "test-results", "ux-lab");
const VALID_ROLES = new Set(["passenger", "driver"]);
const VALID_STATUSES = new Set(["not_run", "pass", "fail", "blocked"]);
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readArg(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function makeRunId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function loadConfig() {
  return {
    journeys: readJson(JOURNEYS_PATH),
    rubric: readJson(RUBRIC_PATH),
    template: readJson(TEMPLATE_PATH),
  };
}

function validateLabConfig(journeysConfig, rubricConfig) {
  const errors = [];
  const journeyIds = new Set();
  const criterionIds = new Set();
  const forbidden = journeysConfig.forbiddenAcceptanceDeepLinks || [];
  const forbiddenTestIds = new Set(
    journeysConfig.forbiddenAcceptanceTestIds || [],
  );

  if (journeysConfig.canonicalStartDeepLink !== "leafapp://robotaxi/home") {
    errors.push("canonicalStartDeepLink must be leafapp://robotaxi/home");
  }
  if (!Array.isArray(journeysConfig.journeys) || journeysConfig.journeys.length < 2) {
    errors.push("at least passenger and driver journeys are required");
  }

  for (const journey of journeysConfig.journeys || []) {
    if (!journey.id || journeyIds.has(journey.id)) {
      errors.push(`invalid or duplicate journey id: ${journey.id || "(empty)"}`);
    }
    journeyIds.add(journey.id);
    if (!VALID_ROLES.has(journey.role)) {
      errors.push(`invalid role for ${journey.id}: ${journey.role}`);
    }
    if (!Array.isArray(journey.states) || journey.states.length === 0) {
      errors.push(`journey ${journey.id} has no states`);
      continue;
    }

    const stateIds = new Set();
    for (const state of journey.states) {
      if (!state.id || stateIds.has(state.id)) {
        errors.push(`invalid or duplicate state in ${journey.id}: ${state.id || "(empty)"}`);
      }
      stateIds.add(state.id);
      if (!state.question || !state.primaryAction) {
        errors.push(`state ${journey.id}/${state.id} needs question and primaryAction`);
      }
      if (!Array.isArray(state.requiredTestIds) || state.requiredTestIds.length === 0) {
        errors.push(`state ${journey.id}/${state.id} needs requiredTestIds`);
      } else {
        for (const testId of state.requiredTestIds) {
          if (forbiddenTestIds.has(testId)) {
            errors.push(
              `state ${journey.id}/${state.id} references forbidden standalone testID ${testId}`,
            );
          }
        }
      }
      const serialized = JSON.stringify(state);
      for (const legacyLink of forbidden) {
        if (serialized.includes(legacyLink)) {
          errors.push(`state ${journey.id}/${state.id} references forbidden link ${legacyLink}`);
        }
      }
    }
  }

  if (!Array.isArray(rubricConfig.criteria) || rubricConfig.criteria.length === 0) {
    errors.push("rubric criteria are required");
  }
  for (const criterion of rubricConfig.criteria || []) {
    if (!criterion.id || criterionIds.has(criterion.id)) {
      errors.push(`invalid or duplicate criterion: ${criterion.id || "(empty)"}`);
    }
    criterionIds.add(criterion.id);
    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) {
      errors.push(`criterion ${criterion.id} needs a positive weight`);
    }
  }

  return errors;
}

function buildObservation(template, journey, state, rubric, participantId) {
  return {
    ...template,
    journeyId: journey.id,
    stateId: state.id,
    role: journey.role,
    participantId,
    task: {
      objective: journey.objective,
      question: state.question,
      expectedPrimaryAction: state.primaryAction,
      requiredTestIds: state.requiredTestIds,
    },
    scores: Object.fromEntries(rubric.criteria.map((criterion) => [criterion.id, null])),
  };
}

function initRun({ runId = makeRunId(), runsDir = DEFAULT_RUNS_DIR, participantId = "internal-01" } = {}) {
  const config = loadConfig();
  const errors = validateLabConfig(config.journeys, config.rubric);
  if (errors.length) {
    throw new Error(`invalid UX lab config:\n- ${errors.join("\n- ")}`);
  }

  const runDir = path.resolve(runsDir, runId);
  if (fs.existsSync(runDir)) {
    throw new Error(`run already exists: ${runDir}`);
  }

  fs.mkdirSync(path.join(runDir, "observations"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "evidence", "passenger"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "evidence", "driver"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "doctor"), { recursive: true });

  const stateCount = config.journeys.journeys.reduce(
    (sum, journey) => sum + journey.states.length,
    0,
  );
  writeJson(path.join(runDir, "run.json"), {
    runId,
    createdAt: new Date().toISOString(),
    status: "prepared",
    buildType: "debug",
    canonicalStartDeepLink: config.journeys.canonicalStartDeepLink,
    participantId,
    stateCount,
    rules: {
      executionTarget: "ios-simulator",
      legacyEvidenceAllowed: false,
      stateInjectionCountsAsIntegratedE2E: false,
      screenshotAloneCountsAsUxValidation: false,
      requireAllStatesForAcceptance: true,
      requirePassForAcceptance: true,
    },
  });

  for (const journey of config.journeys.journeys) {
    for (const state of journey.states) {
      const observation = buildObservation(
        config.template,
        journey,
        state,
        config.rubric,
        participantId,
      );
      writeJson(
        path.join(runDir, "observations", `${journey.role}--${state.id}.json`),
        observation,
      );
    }
  }

  return runDir;
}

function validateObservation(observation, rubric) {
  const errors = [];
  if (!observation.journeyId || !observation.stateId || !VALID_ROLES.has(observation.role)) {
    errors.push("journeyId, stateId and a valid role are required");
  }
  if (!VALID_STATUSES.has(observation.status)) {
    errors.push(`invalid status: ${observation.status}`);
  }
  for (const finding of observation.findings || []) {
    if (!VALID_SEVERITIES.has(finding.severity)) {
      errors.push(`invalid finding severity: ${finding.severity}`);
    }
    if (!finding.title || !finding.evidence || !finding.recommendation) {
      errors.push("every finding needs title, evidence and recommendation");
    }
  }
  if (observation.status === "pass" || observation.status === "fail") {
    if (observation.platform !== "ios") {
      errors.push("executed observations must declare platform ios");
    }
    if (!String(observation.device || "").trim()) {
      errors.push("executed observations must declare the simulator device");
    }
    if (!String(observation.evidence?.video || "").trim()) {
      errors.push("executed observations require a lifecycle video");
    }
    if (!Array.isArray(observation.evidence?.screenshots) || observation.evidence.screenshots.length === 0) {
      errors.push("executed observations require at least one screenshot");
    }
    for (const criterion of rubric.criteria) {
      const score = observation.scores?.[criterion.id];
      if (!Number.isFinite(score) || score < 0 || score > 3) {
        errors.push(`score ${criterion.id} must be between 0 and 3`);
      } else if (observation.status === "pass" && criterion.gate === true && score < 2) {
        errors.push(`gate score ${criterion.id} must be at least 2 for pass`);
      }
    }
  }
  return errors;
}

function validateObservationContract(observation, journey, state) {
  const errors = [];
  const expectedTask = {
    objective: journey.objective,
    question: state.question,
    expectedPrimaryAction: state.primaryAction,
    requiredTestIds: state.requiredTestIds,
  };

  if (observation.journeyId !== journey.id) {
    errors.push(`journeyId must be ${journey.id}`);
  }
  for (const field of ["objective", "question", "expectedPrimaryAction"]) {
    if (observation.task?.[field] !== expectedTask[field]) {
      errors.push(`task.${field} does not match the canonical journey contract`);
    }
  }
  if (
    JSON.stringify(observation.task?.requiredTestIds) !==
    JSON.stringify(expectedTask.requiredTestIds)
  ) {
    errors.push("task.requiredTestIds does not match the canonical journey contract");
  }

  return errors;
}

function resolveRunEvidencePath(runDir, evidencePath) {
  const normalized = String(evidencePath || "").trim();
  if (!normalized) return { error: "empty evidence path" };
  if (path.isAbsolute(normalized)) {
    return { error: `evidence path must be relative to the run: ${normalized}` };
  }
  const resolved = path.resolve(runDir, normalized);
  const runPrefix = `${path.resolve(runDir)}${path.sep}`;
  if (!resolved.startsWith(runPrefix)) {
    return { error: `evidence path escapes the run directory: ${normalized}` };
  }
  return { resolved, normalized };
}

function inspectEvidenceArtifacts(observation, runDir, cache = new Map()) {
  if (observation.status !== "pass" && observation.status !== "fail") return [];
  const errors = [];
  const artifacts = [
    { kind: "video", value: observation.evidence?.video },
    ...(observation.evidence?.screenshots || []).map((value) => ({ kind: "screenshot", value })),
  ];

  for (const artifact of artifacts) {
    const resolvedPath = resolveRunEvidencePath(runDir, artifact.value);
    if (resolvedPath.error) {
      errors.push(resolvedPath.error);
      continue;
    }
    const { resolved, normalized } = resolvedPath;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      errors.push(`evidence file does not exist: ${normalized}`);
      continue;
    }

    if (observation.status === "pass") {
      const acceptedRoot = `${path.join(path.resolve(runDir), "evidence", observation.role)}${path.sep}`;
      if (!resolved.startsWith(acceptedRoot) || normalized.split(path.sep).includes("diagnostics")) {
        errors.push(`pass evidence must live in evidence/${observation.role}: ${normalized}`);
        continue;
      }
    }

    const cacheKey = `${artifact.kind}:${resolved}`;
    if (cache.has(cacheKey)) {
      errors.push(...cache.get(cacheKey));
      continue;
    }

    const artifactErrors = [];
    if (artifact.kind === "screenshot") {
      const signature = fs.readFileSync(resolved).subarray(0, 8);
      const isPng = signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = signature[0] === 0xff && signature[1] === 0xd8;
      if (!isPng && !isJpeg) {
        artifactErrors.push(`screenshot is not a valid PNG/JPEG: ${normalized}`);
      }
    } else {
      const probe = spawnSync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height",
        "-of", "json",
        resolved,
      ], { encoding: "utf8" });
      if (probe.status !== 0) {
        artifactErrors.push(`video probe failed: ${normalized}`);
      } else {
        const decode = spawnSync("ffmpeg", [
          "-v", "error",
          "-i", resolved,
          "-map", "0:v:0",
          "-f", "null",
          "-",
        ], { encoding: "utf8", timeout: 180000 });
        if (decode.status !== 0) {
          artifactErrors.push(`video decode failed: ${normalized}`);
        }
      }
    }
    cache.set(cacheKey, artifactErrors);
    errors.push(...artifactErrors);
  }
  return errors;
}

function weightedScore(observation, rubric) {
  let score = 0;
  let weight = 0;
  for (const criterion of rubric.criteria) {
    const value = observation.scores?.[criterion.id];
    if (Number.isFinite(value)) {
      score += value * criterion.weight;
      weight += criterion.weight;
    }
  }
  return weight ? Number((score / weight).toFixed(2)) : null;
}

function listObservationFiles(runDir) {
  const dir = path.join(runDir, "observations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dir, name))
    .sort();
}

function buildReport(runDir) {
  const config = loadConfig();
  const run = readJson(path.join(runDir, "run.json"));
  const observations = listObservationFiles(runDir).map((filePath) => ({
    filePath,
    value: readJson(filePath),
  }));
  const validationErrors = [];
  const findings = [];
  const evidenceInspectionCache = new Map();
  const expectedObservationContracts = new Map(
    config.journeys.journeys.flatMap((journey) =>
      journey.states.map((state) => [
        `${journey.role}--${state.id}`,
        { journey, state },
      ]),
    ),
  );
  const expectedObservationKeys = new Set(expectedObservationContracts.keys());
  const actualObservationKeys = new Set(
    observations.map(({ value }) => `${value.role}--${value.stateId}`),
  );
  const observationKeyCounts = observations.reduce((counts, { value }) => {
    const key = `${value.role}--${value.stateId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  const missingObservationKeys = [...expectedObservationKeys]
    .filter((key) => !actualObservationKeys.has(key))
    .sort();
  const unexpectedObservationKeys = [...actualObservationKeys]
    .filter((key) => !expectedObservationKeys.has(key))
    .sort();
  const duplicateObservationKeys = [...observationKeyCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  if (Number(run.stateCount) !== expectedObservationKeys.size) {
    validationErrors.push(
      `run stateCount ${run.stateCount} does not match journey contract ${expectedObservationKeys.size}`,
    );
  }
  missingObservationKeys.forEach((key) =>
    validationErrors.push(`missing observation file for ${key}`),
  );
  unexpectedObservationKeys.forEach((key) =>
    validationErrors.push(`unexpected observation file for ${key}`),
  );
  duplicateObservationKeys.forEach(([key, count]) =>
    validationErrors.push(`duplicate observation files for ${key}: ${count}`),
  );

  for (const item of observations) {
    const errors = validateObservation(item.value, config.rubric);
    const observationKey = `${item.value.role}--${item.value.stateId}`;
    const expectedContract = expectedObservationContracts.get(observationKey);
    if (expectedContract) {
      errors.push(
        ...validateObservationContract(
          item.value,
          expectedContract.journey,
          expectedContract.state,
        ),
      );
    }
    errors.push(...inspectEvidenceArtifacts(item.value, runDir, evidenceInspectionCache));
    errors.forEach((error) => validationErrors.push(`${path.basename(item.filePath)}: ${error}`));
    for (const finding of item.value.findings || []) {
      findings.push({
        ...finding,
        priority: config.rubric.severityToPriority[finding.severity],
        role: item.value.role,
        journeyId: item.value.journeyId,
        stateId: item.value.stateId,
      });
    }
  }

  findings.sort((a, b) => a.priority.localeCompare(b.priority));
  const completed = observations.filter((item) => item.value.status !== "not_run");
  const notRun = observations.filter((item) => item.value.status === "not_run");
  const blocked = observations.filter((item) => item.value.status === "blocked");
  const failed = observations.filter((item) => item.value.status === "fail");
  const acceptanceBlockers = [];
  if (run.buildType !== "debug") {
    acceptanceBlockers.push(
      `run buildType must be debug (current: ${run.buildType || "missing"})`,
    );
  }
  if (run.canonicalStartDeepLink !== config.journeys.canonicalStartDeepLink) {
    acceptanceBlockers.push(
      `run canonicalStartDeepLink must be ${config.journeys.canonicalStartDeepLink} (current: ${run.canonicalStartDeepLink || "missing"})`,
    );
  }
  const requiredRunRules = [
    ["executionTarget", "ios-simulator"],
    ["legacyEvidenceAllowed", false],
    ["stateInjectionCountsAsIntegratedE2E", false],
    ["screenshotAloneCountsAsUxValidation", false],
    ["requireAllStatesForAcceptance", true],
    ["requirePassForAcceptance", true],
  ];
  for (const [rule, expected] of requiredRunRules) {
    if (run.rules?.[rule] !== expected) {
      acceptanceBlockers.push(
        `run rule ${rule} must be ${expected} (current: ${String(run.rules?.[rule])})`,
      );
    }
  }
  if (run.status !== "completed") {
    acceptanceBlockers.push(
      `run status must be completed for acceptance (current: ${run.status || "missing"})`,
    );
  }
  if (missingObservationKeys.length > 0) {
    acceptanceBlockers.push(
      `${missingObservationKeys.length} lifecycle states have no observation file`,
    );
  }
  if (duplicateObservationKeys.length > 0) {
    acceptanceBlockers.push(
      `${duplicateObservationKeys.length} lifecycle states have duplicate observations`,
    );
  }
  if (notRun.length > 0) {
    acceptanceBlockers.push(
      `coverage incomplete: ${notRun.length}/${expectedObservationKeys.size} states remain not_run`,
    );
  }
  if (blocked.length > 0) {
    acceptanceBlockers.push(`${blocked.length} states are blocked`);
  }
  if (failed.length > 0) {
    acceptanceBlockers.push(`${failed.length} states failed UX acceptance`);
  }
  const scored = observations
    .map((item) => weightedScore(item.value, config.rubric))
    .filter(Number.isFinite);
  const averageScore = scored.length
    ? Number((scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(2))
    : null;
  const acceptanceFailed = validationErrors.length > 0 || acceptanceBlockers.length > 0;
  const outputPath = path.join(runDir, "UX_LAB_REPORT.md");
  const lines = [
    "# Leaf UX Lab Report",
    "",
    `- Run: ${run.runId}`,
    `- Build: ${run.buildType}`,
    `- Coverage: ${completed.length}/${expectedObservationKeys.size} states`,
    `- Average weighted score: ${averageScore ?? "not scored"}/3`,
    `- Validation errors: ${validationErrors.length}`,
    `- Acceptance: ${acceptanceFailed ? "FAIL" : "PASS"}`,
    "",
    "## Gates",
    "",
    `- Execution target: ${run.rules?.executionTarget || "not declared"}`,
    `- Canonical start: ${run.canonicalStartDeepLink}`,
    `- Legacy evidence allowed: ${run.rules?.legacyEvidenceAllowed ? "YES - INVALID" : "no"}`,
    `- Integrated E2E may use injected states: ${run.rules?.stateInjectionCountsAsIntegratedE2E ? "YES - INVALID" : "no"}`,
    `- Complete state coverage: ${notRun.length ? `no (${notRun.length} not_run)` : "yes"}`,
    `- All states passed: ${blocked.length || failed.length ? `no (${failed.length} fail, ${blocked.length} blocked)` : "yes"}`,
    "",
    "## Acceptance blockers",
    "",
    ...(acceptanceBlockers.length
      ? acceptanceBlockers.map((blocker) => `- ${blocker}`)
      : ["- None."]),
    "",
    "## Prioritized findings",
    "",
    ...(findings.length
      ? findings.map(
          (finding) =>
            `- ${finding.priority} [${finding.role}/${finding.stateId}] ${finding.title} — ${finding.evidence} — ${finding.recommendation}`,
        )
      : ["- No findings recorded." ]),
    "",
    "## State results",
    "",
    "| Role | State | Status | Score | Time | Mis-taps | Backtracks | Hesitations | Confidence |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...observations.map(({ value }) => {
      const metrics = value.metrics || {};
      return `| ${value.role} | ${value.stateId} | ${value.status} | ${weightedScore(value, config.rubric) ?? "-"} | ${metrics.completionTimeMs ?? "-"} | ${metrics.misTaps ?? "-"} | ${metrics.backtracks ?? "-"} | ${metrics.hesitationsOver3s ?? "-"} | ${metrics.confidence1to5 ?? "-"} |`;
    }),
    "",
    "## Validation errors",
    "",
    ...(validationErrors.length ? validationErrors.map((error) => `- ${error}`) : ["- None."]),
    "",
  ];
  fs.writeFileSync(outputPath, lines.join("\n"));
  return {
    outputPath,
    validationErrors,
    acceptanceBlockers,
    findings,
    coverage: [completed.length, expectedObservationKeys.size],
  };
}

function runDoctor(runDir) {
  const doctorScript = path.join(__dirname, "current-flow-e2e-lab.cjs");
  const result = spawnSync(process.execPath, [
    doctorScript,
    "--out-dir",
    path.join(runDir, "doctor"),
    "--ios-only",
  ], {
    cwd: MOBILE_DIR,
    stdio: "inherit",
  });
  return result.status || 0;
}

function usage() {
  process.stdout.write(`Leaf UX Lab\n\n` +
    `  node scripts/qa/ux-lab.cjs validate\n` +
    `  node scripts/qa/ux-lab.cjs init [--run-id ID] [--participant ID]\n` +
    `  node scripts/qa/ux-lab.cjs doctor --run-dir PATH\n` +
    `  node scripts/qa/ux-lab.cjs report --run-dir PATH\n`);
}

function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    usage();
    return 0;
  }

  if (command === "validate") {
    const config = loadConfig();
    const errors = validateLabConfig(config.journeys, config.rubric);
    if (errors.length) {
      errors.forEach((error) => console.error(`[ux-lab] ${error}`));
      return 1;
    }
    console.log("[ux-lab] configuration valid");
    return 0;
  }

  if (command === "init") {
    const runDir = initRun({
      runId: readArg(args, "--run-id", makeRunId()),
      participantId: readArg(args, "--participant", "internal-01"),
    });
    console.log(`[ux-lab] run prepared: ${runDir}`);
    return 0;
  }

  const runDirArg = readArg(args, "--run-dir");
  if (!runDirArg) {
    console.error("[ux-lab] --run-dir is required");
    return 1;
  }
  const runDir = path.resolve(runDirArg);
  if (command === "doctor") return runDoctor(runDir);
  if (command === "report") {
    const result = buildReport(runDir);
    console.log(`[ux-lab] report: ${result.outputPath}`);
    console.log(`[ux-lab] coverage: ${result.coverage[0]}/${result.coverage[1]}`);
    return result.validationErrors.length || result.acceptanceBlockers.length ? 1 : 0;
  }

  usage();
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  buildObservation,
  buildReport,
  initRun,
  loadConfig,
  validateLabConfig,
  validateObservation,
  weightedScore,
};
