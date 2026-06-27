const express = require('express');
const agent = require('./agent');
const prompts = require('./prompts');
const ws = require('./workspace');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3001;
const AGENT_RUNNER_KEY = process.env.AGENT_RUNNER_KEY;

// ── Auth middleware ──────────────────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  if (!AGENT_RUNNER_KEY) return next(); // no key configured → open (dev only)
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== AGENT_RUNNER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    provider: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
  });
});

// ── Main run endpoint ─────────────────────────────────────────────────────────
// POST /api/run
// Body: { run_id, agent_type, context, model? }
app.post('/api/run', async (req, res) => {
  const { run_id, agent_type, context = {}, model } = req.body;

  if (!run_id)     return res.status(400).json({ error: 'run_id is required' });
  if (!agent_type) return res.status(400).json({ error: 'agent_type is required' });

  // Inject secrets from the runner's environment (callers never send raw tokens)
  const ctx = {
    ...context,
    github_token:      process.env.GITHUB_TOKEN,
    render_api_key:    process.env.RENDER_API_KEY || '',
    render_service_id: process.env.RENDER_SERVICE_ID || '',
  };

  // Build the prompt for the requested agent type
  let prompt;
  let noTools = false;
  try {
    switch (agent_type) {
      case 'spec':      prompt = prompts.spec(ctx);      break;
      case 'review':    prompt = prompts.review(ctx);    noTools = true; break;
      case 'implement': prompt = prompts.implement(ctx); break;
      case 'deploy':    prompt = prompts.deploy(ctx);    break;
      case 'validate':  prompt = prompts.validate(ctx);  break;
      default:
        return res.status(400).json({ error: `Unknown agent_type: ${agent_type}` });
    }
  } catch (err) {
    return res.status(400).json({ error: `Prompt build error: ${err.message}` });
  }

  // Each run gets an isolated workspace directory
  let workspaceDir;
  try {
    workspaceDir = await ws.create(`${agent_type}-${run_id}`);
  } catch (err) {
    return res.status(500).json({ error: `Workspace error: ${err.message}` });
  }

  console.log(`[run] id=${run_id} type=${agent_type} workspace=${workspaceDir}`);

  const started = Date.now();
  let result;

  try {
    result = await agent.run(prompt, workspaceDir, { model, noTools });
  } catch (err) {
    await ws.remove(workspaceDir);
    console.error(`[run] FAILED id=${run_id}`, err.message);
    return res.status(500).json({
      status: 'error',
      error: err.message,
      run_id,
      agent_type,
    });
  }

  // Always clean up — workspaces contain cloned repos which can be 100s of MB.
  // On the 512 MB Render free plan we cannot afford to let them accumulate.
  await ws.remove(workspaceDir);

  console.log(
    `[run] DONE id=${run_id} type=${agent_type} iterations=${result.iterations} ms=${Date.now() - started}`
  );

  res.json({
    status: 'success',
    run_id,
    agent_type,
    last_message: result.lastMessage,
    steps_taken: result.iterations,
    duration_ms: Date.now() - started,
  });
});

app.listen(PORT, () => {
  console.log(`IssueForge agent runner listening on :${PORT}`);
  console.log(`  LLM: ${process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1'}`);
  console.log(`  Model: ${process.env.LLM_MODEL || 'llama-3.3-70b-versatile'}`);
  console.log(`  Auth: ${AGENT_RUNNER_KEY ? 'enabled' : 'DISABLED (set AGENT_RUNNER_KEY)'}`);
});
