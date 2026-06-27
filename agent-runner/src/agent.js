const OpenAI = require('openai');
const tools = require('./tools');
const ws = require('./workspace');

const MAX_ITERATIONS = 40;

// Build the OpenAI client once; all config comes from environment.
function makeClient() {
  return new OpenAI({
    baseURL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey: process.env.LLM_API_KEY,
  });
}

const DEFAULT_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

/**
 * Run a tool-use agent loop.
 *
 * @param {{ system: string, user: string }} prompt
 * @param {string} workspaceDir  Absolute path to the per-run workspace.
 * @param {object} opts          { model?, maxIterations?, noTools? }
 * @returns {{ lastMessage: string, steps: Array, iterations: number }}
 */
async function run(prompt, workspaceDir, opts = {}) {
  const client = makeClient();
  const model = opts.model || DEFAULT_MODEL;
  const maxIter = opts.maxIterations || MAX_ITERATIONS;

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];

  const steps = [];
  let lastMessage = '';

  for (let i = 0; i < maxIter; i++) {
    const params = {
      model,
      messages,
      max_tokens: 4096,
    };

    // Some agent types (review) don't need tools
    if (!opts.noTools) {
      params.tools = tools.DEFINITIONS;
      params.tool_choice = 'auto';
    }

    let response;
    try {
      response = await client.chat.completions.create(params);
    } catch (err) {
      throw new Error(`LLM API error: ${err.message}`);
    }

    const choice = response.choices[0];
    const msg = choice.message;

    // Push the assistant message to the thread
    messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

    // No tool calls → the agent is done
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      lastMessage = msg.content || '';
      break;
    }

    // Execute each tool call in parallel and collect results
    const toolResults = await Promise.all(
      msg.tool_calls.map(async tc => {
        const name = tc.function.name;
        let args;
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch (_) {
          args = {};
        }

        const start = Date.now();
        let output;
        try {
          output = await tools.execute(name, args, workspaceDir);
        } catch (err) {
          output = `Tool error: ${err.message}`;
        }

        steps.push({ tool: name, args, output: output.slice(0, 2000), ms: Date.now() - start });

        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: output,
        };
      })
    );

    messages.push(...toolResults);
  }

  return { lastMessage, steps, iterations: steps.length };
}

module.exports = { run };
