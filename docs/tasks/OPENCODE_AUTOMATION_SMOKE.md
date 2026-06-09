# OpenCode Automation Smoke

This file exists only to validate the automated GitHub Actions → OpenCode → branch → PR flow.

## Checklist

- [ ] Trigger: `/oc` or `/opencode` comment on an open issue starts the workflow.
- [ ] Provider: OpenCode uses the configured LLM provider (e.g. Verboo) to generate a response.
- [ ] Branch: The workflow creates or reuses a branch named `opencode/issue<number>-<timestamp>`.
- [ ] PR: OpenCode opens a pull request from the branch with summary, files changed, risks, rollback, and evidence.
- [ ] Governance: `npm run governance:check` passes before and after changes.

## When to Remove

Delete this file once a larger smoke (e.g. dashboard smoke) passes successfully against a real task.
