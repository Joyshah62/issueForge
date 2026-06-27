// System prompts for each IssueForge agent type.
// Context values are interpolated by the caller before passing to the agent.

function spec(ctx) {
  return {
    system: `You are the IssueForge Specification Agent.
Analyse the GitHub issue below and produce a structured implementation specification.
Return ONLY a raw JSON object — no markdown fences, no explanation.`,

    user: `Issue URL   : ${ctx.issue_url}
Repository  : ${ctx.repo_full_name}
Issue Title : ${ctx.issue_title || '(see body)'}
Issue Body  :
${ctx.issue_body || '(no body provided)'}

Produce a JSON specification using this exact schema:
{
  "summary": "one-sentence description of the required change",
  "issue_title": "${ctx.issue_title || ''}",
  "issue_body": "copy from Issue Body above",
  "repo_full_name": "${ctx.repo_full_name}",
  "issue_number": ${ctx.issue_number},
  "tech_stack": ["infer from repo name and issue"],
  "build_commands": {
    "install": "npm ci",
    "build": "npm run build",
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "test": "npm test"
  },
  "acceptance_criteria": [
    { "id": "AC-1", "description": "specific verifiable behaviour", "verification": "test|browser|api" }
  ],
  "likely_files": ["src/foo.ts"],
  "implementation_plan": ["1. ..."],
  "test_plan": ["Unit: ..."],
  "risks": ["..."]
}`,
  };
}

function review(ctx) {
  return {
    system: `You are the IssueForge Plan Review Agent. Review specifications critically and objectively.
No tools are needed — respond with text only.`,

    user: `Review the implementation specification below and decide if it is ready for coding.

SPECIFICATION:
${ctx.spec}

Checklist:
1. Are acceptance criteria concrete and objectively verifiable?
2. Does each criterion have a sensible verification method (test/browser/api)?
3. Is the implementation plan scoped to the issue (not over-engineered)?
4. Are likely_files plausible for the described change?
5. Does the test_plan cover the acceptance criteria?
6. Are risks identified?

If ALL checks pass → respond: APPROVED
If ANY check fails → respond: REVISION_REQUESTED
followed by a numbered list of specific issues.

No other text.`,
  };
}

function implement(ctx) {
  return {
    system: `You are a coding agent. Use shell_exec, read_file, write_file, list_dir, http_request tools.
Never fabricate output. Return final result as raw JSON only.`,

    user: `Repo: ${ctx.repo_full_name} | Branch: ${ctx.branch_name} | Issue: #${ctx.issue_number}
Clone: ${ctx.clone_url}

SPEC: ${ctx.spec}

Steps:
1. shell_exec: git clone --depth=1 ${ctx.clone_url} repo
2. shell_exec: git -C repo checkout -b ${ctx.branch_name}
3. shell_exec: git -C repo config user.email "issueforge@bot" && git -C repo config user.name "IssueForge"
4. Install deps from spec build_commands.install (run in repo/)
5. Read likely_files, implement changes per acceptance_criteria, add tests per test_plan
6. Run lint, typecheck, test, build (from spec build_commands). On failure fix and retry (max 3 attempts)
7. shell_exec: git -C repo add -A && git -C repo commit -m "fix: issue #${ctx.issue_number}"
8. shell_exec: git -C repo push https://x-access-token:${ctx.github_token}@github.com/${ctx.repo_full_name}.git ${ctx.branch_name}
9. http_request GET https://api.github.com/repos/${ctx.repo_full_name} — get default_branch
10. http_request POST https://api.github.com/repos/${ctx.repo_full_name}/pulls body: {"title":"[IssueForge] fix #${ctx.issue_number}","body":"Closes #${ctx.issue_number}","head":"${ctx.branch_name}","base":"<default_branch>","draft":true}

Return JSON: {"status":"passed|failed","branch_name":"${ctx.branch_name}","pr_url":"","pr_number":0,"commit_sha":"","files_changed":[],"tests_added":[],"validation":{"lint":"passed|failed|skipped","typecheck":"passed|failed|skipped","tests":"passed|failed|skipped","build":"passed|failed|skipped"},"repair_attempts":0,"failure_reason":"","summary":""}`,
  };
}

function deploy(ctx) {
  return {
    system: `You are the IssueForge Deploy Agent. You have HTTP tools to call the Render API.
Return raw JSON only — no markdown fences.`,

    user: `Deploy the implementation branch to Render and return the preview URL.

Branch      : ${ctx.branch_name}
PR URL      : ${ctx.pr_url}
Render key  : ${ctx.render_api_key || ''}
Service ID  : ${ctx.render_service_id || ''}

If RENDER_API_KEY or RENDER_SERVICE_ID is empty, return immediately:
{"ok":false,"skipped":true,"reason":"Render not configured","preview_url":""}

Otherwise:
1. Trigger a deploy:
   http_request POST https://api.render.com/v1/services/${ctx.render_service_id || 'SERVICE_ID'}/deploys
   Body: {"clearCache":"do_not_clear"}
   Record the deploy ID.

2. Poll every 20 seconds (max 5 minutes) until status is "live", "failed", or "canceled":
   http_request GET https://api.render.com/v1/services/${ctx.render_service_id || 'SERVICE_ID'}/deploys/<deploy_id>

3. On "live", get the service URL:
   http_request GET https://api.render.com/v1/services/${ctx.render_service_id || 'SERVICE_ID'}
   Extract serviceDetails.url.

Return raw JSON:
{
  "ok": true|false,
  "skipped": false,
  "deploy_id": "dep-xxx",
  "preview_url": "https://...",
  "status": "live|failed|timed_out",
  "error": ""
}`,
  };
}

function validate(ctx) {
  return {
    system: `You are the IssueForge Preview Validation Agent. You have shell and HTTP tools.
Return raw JSON only — no markdown fences.`,

    user: `Validate the deployed preview against the acceptance criteria.

Preview URL   : ${ctx.preview_url || '(not deployed)'}
Render skipped: ${ctx.render_skipped}
PR URL        : ${ctx.pr_url}

ACCEPTANCE CRITERIA:
${ctx.spec}

Steps:
${ctx.preview_url ? `1. Verify the preview URL returns HTTP 200:
   http_request GET ${ctx.preview_url}
2. Install Playwright if available and run browser checks:
   shell_exec: npx playwright --version 2>/dev/null && echo "available" || echo "not available"
   If available, use it to open the preview URL, assert expected DOM state, and capture a screenshot.
3. For each AC with verification="browser": navigate, assert, record pass/fail.
4. For each AC with verification="test": check whether test_plan items passed (from implementation results).` : `1. Preview was not deployed. Check the PR and validate from the diff.
2. For browser ACs: mark as "skipped".
3. For test ACs: verify the test_plan items passed based on implementation results.`}

Return raw JSON:
{
  "overall": "passed|failed",
  "preview_loaded": true|false,
  "console_errors": [],
  "ac_results": [
    { "id": "AC-1", "description": "...", "status": "passed|failed|skipped", "notes": "..." }
  ],
  "summary": "one paragraph summary of validation results"
}`,
  };
}

module.exports = { spec, review, implement, deploy, validate };
