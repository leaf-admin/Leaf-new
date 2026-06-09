# OpenCode GitHub Automation

This runbook explains how LEAF automates the Codex -> OpenCode -> GitHub flow without letting agents run outside the task scope.

## What Is Automated

- `/oc` and `/opencode` comments on GitHub issues or PR review comments can start OpenCode.
- OpenCode runs inside GitHub Actions.
- OpenCode reads `AGENTS.md` and `PROJECT_RULES.md` from the repository.
- The GitHub Action creates the working branch for OpenCode.
- OpenCode can push commits, comment, and open pull requests through the workflow token.
- Governance checks run before OpenCode starts.

## What Is Not Automated

- OpenCode does not run on every new issue.
- OpenCode does not run on every new PR.
- OpenCode does not run for outside contributors unless an authorized LEAF collaborator explicitly comments `/oc` or `/opencode`.
- Codex review is still requested intentionally with `@codex review`.
- Human approval remains required before merge.

## Required GitHub Configuration

Set these in GitHub repository settings under `Settings -> Secrets and variables -> Actions`.

### Repository Variable

- `OPENCODE_MODEL`: the OpenCode model in `provider/model` format.

Examples depend on the provider configured for the project. Keep the final value in GitHub variables, not in the repo.

For LEAF's current Verboo Code provider, recommended examples are:

- `verboo/deepseek-v4-flash`
- `verboo/mimo-v2.5`
- `verboo/minimax-m2.7`

### Repository Secrets

Configure at least one supported provider key:

- `VERBOO_API_KEY`
- `DEEPSEEK_API_KEY`
- `MOONSHOT_API_KEY`
- `KIMI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

For the current LEAF setup, prefer `VERBOO_API_KEY`.

The workflow fails closed when `OPENCODE_MODEL` is missing or no supported provider secret is present.

## Verboo Code Provider

The repo includes `opencode.json` with a `verboo` provider that uses OpenCode's OpenAI-compatible adapter.

The config contains only non-secret provider metadata:

- provider id: `verboo`;
- base URL: `https://code.verboo.ai/router/v1`;
- available models copied from the local OpenCode Desktop config;
- API key reference: `{env:VERBOO_API_KEY}`.

Do not commit the local OpenCode auth file. Desktop credentials are local-only and GitHub Actions cannot use them unless the API key is explicitly provided as a GitHub secret.

## Optional GitHub App Setup

The workflow uses GitHub Actions' built-in `GITHUB_TOKEN` with `use_github_token: true`.

If LEAF later wants commits and PRs to appear as the OpenCode GitHub App instead of `github-actions`, install the OpenCode app and switch the workflow to the app token path. Do this as a separate change with a small validation PR.

## Daily Flow

1. Create a GitHub issue from `.github/ISSUE_TEMPLATE/task.md`.
2. Keep the task small: one issue, one branch, one PR.
3. Add a comment:

```text
/oc implement this issue.

Follow AGENTS.md and PROJECT_RULES.md strictly.
Use the current GitHub Actions branch. Do not create or switch branches.
Keep the scope limited.
Do not change business rules.
Do not add external paid API calls.
Run available lint, tests and build.
Open a pull request.
```

4. When OpenCode opens a PR, request Codex review:

```text
@codex review
```

5. If Codex requests changes, comment on the PR:

```text
/oc apply Codex review comments.

Use the current GitHub Actions branch. Do not create or switch branches.
Do not refactor unrelated code.
Do not change business rules.
Run tests again.
Update the PR summary with evidence.
```

6. Merge only after tests, evidence, and human review are complete.

## Guard Rails

- Trigger requires `/oc` or `/opencode` in the comment.
- Trigger requires `OWNER`, `MEMBER`, or `COLLABORATOR` author association.
- `share: false` prevents public OpenCode session sharing.
- `persist-credentials: false` avoids leaving checkout credentials in Git config.
- `governance:check` must pass before OpenCode runs.
- Provider keys live in GitHub Secrets only.
- Business rules, payment, KYC, safety, maps cost, and store release behavior must follow `AGENTS.md`.

## Trade-offs

- Explicit comments are slower than fully automatic triage, but much safer for LEAF while the product is entering assisted production.
- `GITHUB_TOKEN` setup is simpler than GitHub App setup, but PR authorship appears as GitHub Actions. If authorship separation becomes important, move to the OpenCode app path.
- Provider secrets in GitHub Actions are operationally simple, but access should stay limited to maintainers.
- `AGENTS.md` is the shared source of truth. If a future model ignores it, the PR must be rejected.

## Recommended Branch Protection

After this PR is merged, protect `main` with these required checks where available:

- `Secret Guard`
- `Leaf Release Gate`
- `governance:check` or the workflow/job that runs it
- at least one human approval

## Stop Conditions

Stop and do not merge when:

- OpenCode changes files outside task scope.
- A business rule changes without explicit approval.
- A paid external API path is added or made more frequent.
- Payment, ledger, KYC, safety, or driver-online behavior changes without focused tests.
- The PR lacks test evidence.
