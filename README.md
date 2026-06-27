# IssueForge

Autonomous software factory built on SuperPlane. Paste a GitHub issue URL — IssueForge clones the repo, understands the codebase, writes and validates the fix, opens a pull request, deploys a Render preview, and attaches a verification report to the PR.

AI is powered by **open-source Llama-family models** via a self-contained agent runner service. No Anthropic account needed.

## How it works

```
GitHub Issue URL
  → Parse URL
  → Initialize run state
  → Analyze & Specify  [agent-runner: spec]      clone repo, read files, generate structured spec
  → Validate Spec                                  JSON schema gate
  → Review Plan        [agent-runner: review]     independent LLM reviews the spec
  → Implement, Validate, Push, Open PR
                       [agent-runner: implement]  code + lint/test/repair×3 + push + PR
  → Deploy to Render   [agent-runner: deploy]     Render API deploy + poll until live
  → Validate Preview   [agent-runner: validate]   browser test against acceptance criteria
  → Format & Post Evidence                         PR comment with AC table + preview link
  → Record Success
```

Each **agent-runner** step calls your self-hosted agent runner service, which runs a tool-use loop: Llama plans → tools execute (shell, file I/O, git, HTTP) → Llama responds → repeat.

## Prerequisites

| Tool | Purpose |
|------|---------|
| [SuperPlane account](https://app.superplane.com) | Workflow orchestration |
| Groq / Together AI / Ollama | LLM inference (Llama / Qwen3-Coder) |
| GitHub personal-access token | Clone repos, push branches, create PRs |
| Render account | Agent runner deployment + preview deployments |

## Setup

### 1 — Choose a model and provider

| Provider | Model | Speed | Cost | Notes |
|----------|-------|-------|------|-------|
| **Groq** | `llama-3.3-70b-versatile` | ⚡ Very fast | Free tier | Best for getting started |
| **Together AI** | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | Fast | ~$0.90/M tok | Best coding quality (~70% SWE-Bench) |
| **Fireworks AI** | `accounts/fireworks/models/qwen3-coder-480b` | Fast | ~$0.90/M tok | Alternative to Together |
| **Ollama** | `qwen2.5-coder:32b` | Local | Free | Needs 24 GB VRAM |
| **Ollama** | `qwen3:8b` | Local | Free | 6 GB VRAM, lighter option |

Get an API key from your chosen provider.

### 2 — Deploy the agent runner to Render

```bash
cd agent-runner

# Copy and fill in the environment file
cp .env.example .env
# Edit .env — set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, GITHUB_TOKEN, AGENT_RUNNER_KEY

# Deploy to Render (or run locally for testing)
# In the Render dashboard: New → Background Worker → connect this repo → set env vars
```

Key environment variables for the agent runner:

| Variable | Value |
|----------|-------|
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` (or Together/Fireworks/Ollama URL) |
| `LLM_API_KEY` | Your API key |
| `LLM_MODEL` | `llama-3.3-70b-versatile` (or your chosen model) |
| `GITHUB_TOKEN` | GitHub PAT with `repo`, `pull_requests:write`, `issues:write` |
| `AGENT_RUNNER_KEY` | Any random secret string — callers must send this as a Bearer token |
| `RENDER_API_KEY` | Render API key (optional, for preview deploys) |
| `RENDER_SERVICE_ID` | Render service ID to deploy to (optional) |

After deploying, note the public URL (e.g. `https://issueforge-agent.onrender.com`).

### 3 — Configure the canvas

Two placeholders to replace in `canvas.yaml`:

| Placeholder | Replace with |
|-------------|-------------|
| `YOUR_AGENT_RUNNER_KEY` | The `AGENT_RUNNER_KEY` you set above (appears in 5 runnerJS nodes) |
| `YOUR_GITHUB_INTEGRATION_ID` | SuperPlane GitHub integration ID (from step 4) |

Also update the `AGENT_RUNNER_URL` constant in each of the 5 runnerJS agent nodes to your deployed URL.

```bash
# Quick replace:
RUNNER_URL="https://issueforge-agent.onrender.com"
RUNNER_KEY="your-secret-key"
GITHUB_INT_ID="your-github-integration-id"

sed -i '' \
  -e "s|https://issueforge-agent.onrender.com|${RUNNER_URL}|g" \
  -e "s|YOUR_AGENT_RUNNER_KEY|${RUNNER_KEY}|g" \
  -e "s|YOUR_GITHUB_INTEGRATION_ID|${GITHUB_INT_ID}|g" \
  canvas.yaml
```

### 4 — Install the SuperPlane CLI and connect

```bash
# macOS
brew install superplanehq/tap/superplane

superplane connect   # opens browser for auth
superplane whoami
```

### 5 — Connect GitHub in SuperPlane

In the SuperPlane UI → **Integrations** → connect GitHub and authorise the repos IssueForge will work on. Note the integration ID.

### 6 — Create and publish the app

```bash
superplane apps create issueforge --canvas-file canvas.yaml
superplane apps console set issueforge --file console.yaml
superplane apps publish issueforge
```

### 7 — Run on an issue

**Via the CLI:**
```bash
superplane runs start issueforge \
  --template run \
  --param issue_url=https://github.com/owner/repo/issues/123
```

**Via the Console:**  
Open the SuperPlane Console → IssueForge → click **Submit a GitHub Issue** → enter the URL → **Run**.

**Run all five hackathon issues in parallel:**
```bash
for url in \
  "https://github.com/superplanehq/superplane/issues/5368" \
  "https://github.com/superplanehq/superplane/issues/5366" \
  "https://github.com/superplanehq/superplane/issues/5164" \
  "https://github.com/superplanehq/superplane/issues/5160" \
  "https://github.com/superplanehq/superplane/issues/5155"; do
  superplane runs start issueforge --template run --param issue_url="$url" &
done
wait
echo "All five runs submitted."
```

## Canvas overview

| Node | Component | Role |
|------|-----------|------|
| Submit Issue | start (trigger) | Manual start with `issue_url` param |
| Parse Issue URL | runnerJS | Extract owner/repo/number from URL |
| Initialize Run | upsertMemory | Write initial run record |
| Analyze and Specify | runnerJS → **agent-runner: spec** | Fetch issue, clone repo, produce spec JSON |
| Validate Specification | runnerJS | Enforce schema: ACs, plan, test_plan, build_commands |
| Spec Valid? | if | Gate: fail → `specification_failed` |
| Review Plan | runnerJS → **agent-runner: review** | Independent LLM reviews spec for completeness |
| Validate Plan Review | runnerJS | Parse APPROVED / REVISION_REQUESTED |
| Plan Approved? | if | Gate: fail → `plan_review_failed` |
| Implement, Validate, and Open PR | runnerJS → **agent-runner: implement** | Clone → code → lint/test/repair (×3) → push → PR |
| Parse Implementation Result | runnerJS | Extract status, PR URL, validation results |
| Implementation Passed? | if | Gate: fail → `implementation_failed` |
| Deploy to Render | runnerJS → **agent-runner: deploy** | Render API deploy + poll until live |
| Parse Deploy Result | runnerJS | Extract preview URL |
| Deploy OK? | if | Gate (passes when skipped): fail → `deployment_failed` |
| Validate Preview | runnerJS → **agent-runner: validate** | Browser-test preview against acceptance criteria |
| Parse Preview Result | runnerJS | Extract AC pass/fail counts |
| Preview OK? | if | Gate: fail → `preview_verification_failed` |
| Format Evidence Report | runnerJS | Build markdown evidence comment |
| Post Evidence Comment | github.createIssueComment | Attach evidence to PR |
| Record Success | upsertMemory | Write final success state |

## Render architecture

| Service | Purpose |
|---------|---------|
| **Render Web Service** | Hosts the deployed preview branch — one service per repository, redeploys on each run |
| **Render Background Worker** | (optional) Runs the Playwright browser tests in isolation, keeping the web service responsive |

Configure the web service to deploy from the `issueforge/*` branches by connecting your GitHub repo in the Render dashboard and setting the branch filter.

## Console dashboard

The IssueForge Console shows a live table of all runs:

| Column | Description |
|--------|-------------|
| Issue | Linked issue number |
| Repository | `owner/repo` |
| Stage | Current pipeline stage |
| Status | `running` / `success` / `failed` |
| Repairs | Number of repair attempts |
| AC Passed | Acceptance criteria passed count |
| PR | Link to the opened PR |
| Preview | Link to the Render preview |

Rows are colour-coded green (success), blue (running), red (failed). Each row has a **Re-run** action to re-trigger the workflow.

## Failure handling

A failed run always writes a structured record to memory:

```json
{
  "issue_url": "https://github.com/owner/repo/issues/123",
  "status": "failed",
  "stage": "implementation_failed",
  "repair_attempts": "3",
  "error": "TypeScript error in src/foo.ts: ..."
}
```

Possible `stage` values: `specification_failed`, `plan_review_failed`, `implementation_failed`, `deployment_failed`, `preview_verification_failed`, `completed`.

## Project structure

```
issueforge/
├── canvas.yaml      # SuperPlane workflow definition (26 nodes)
├── console.yaml     # SuperPlane Console dashboard
└── README.md        # This file
```

All JavaScript logic is embedded inline in `canvas.yaml` as `runnerJS` node scripts.
