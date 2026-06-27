const OpenAI = require('openai');
const tools = require('./tools');
const ws = require('./workspace');

const MAX_ITERATIONS = 40;

// Rough token estimator: 1 token ≈ 4 chars.
function estimateTokens(messages) {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return sum + Math.ceil(text.length / 4);
  }, 0);
}

// Keep context under the limit by truncating old tool result messages.
// Always preserves: system message, first user message, last N assistant+tool pairs.
function pruneMessages(messages, maxTokens) {
  if (estimateTokens(messages) <= maxTokens) return messages;

  const system = messages[0];
  const firstUser = messages[1];
  // Walk backwards keeping recent messages until we're under budget
  const tail = [];
  let tokens = estimateTokens([system, firstUser]);
  for (let i = messages.length - 1; i >= 2; i--) {
    const est = estimateTokens([messages[i]]);
    if (tokens + est > maxTokens) break;
    tail.unshift(messages[i]);
    tokens += est;
  }
  return [system, firstUser, ...tail];
}

function makeClient() {
  return new OpenAI({
    baseURL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey: process.env.LLM_API_KEY,
  });
}

const DEFAULT_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

// Max tokens to send per request — stay well under Groq's 6K TPM free limit.
// Raise this if using Together AI / a provider with higher limits.
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || '8000', 10);

// Max chars per individual tool result to avoid one large file blowing the budget.
const MAX_TOOL_OUTPUT_CHARS = parseInt(process.env.MAX_TOOL_OUTPUT_CHARS || '4000', 10);

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
    const pruned = pruneMessages(messages, MAX_CONTEXT_TOKENS);

    const params = {
      model,
      messages: pruned,
      max_tokens: opts.maxTokens || 4096,
    };

    if (!opts.noTools) {
      params.tools = tools.DEFINITIONS;
      params.tool_choice = 'auto';
    }

    let response;
    // Retry up to 3 times on rate-limit (429) or overload (503) with backoff
    let badToolCall = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create(params);
        break;
      } catch (err) {
        const msg = err.message || '';
        const isRetryable = msg.includes('429') || msg.includes('503') || msg.includes('rate') || msg.includes('overloaded');
        if (isRetryable && attempt < 2) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 10000)); // 10s, 20s
          continue;
        }
        // Groq returns 400 when the model produces a malformed tool call.
        // Inject a corrective message and let the agent loop retry.
        if (msg.includes('400') && msg.includes('Failed to call a function')) {
          messages.push({ role: 'assistant', content: 'I attempted a tool call but it was malformed.' });
          messages.push({ role: 'user', content: 'Your previous tool call was malformed. Use the exact tool names and parameter schemas provided. Try again.' });
          badToolCall = true;
          break;
        }
        throw new Error(`LLM API error: ${msg}`);
      }
    }

    if (badToolCall) continue;

    const choice = response.choices[0];
    const msg = choice.message;

    messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      lastMessage = msg.content || '';
      break;
    }

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
        const validTools = tools.DEFINITIONS.map(t => t.function.name);
        if (!validTools.includes(name)) {
          output = `Unknown tool "${name}". Available tools: ${validTools.join(', ')}. Use only these.`;
        } else {
          try {
            output = await tools.execute(name, args, workspaceDir);
          } catch (err) {
            output = `Tool error: ${err.message}`;
          }
        }

        // Hard-cap each tool result to keep context manageable
        if (output.length > MAX_TOOL_OUTPUT_CHARS) {
          output = output.slice(0, MAX_TOOL_OUTPUT_CHARS) +
            `\n\n[truncated — ${output.length} chars total, showing first ${MAX_TOOL_OUTPUT_CHARS}]`;
        }

        steps.push({ tool: name, args, output: output.slice(0, 2000), ms: Date.now() - start });

        return { role: 'tool', tool_call_id: tc.id, content: output };
      })
    );

    messages.push(...toolResults);

    // Pace iterations to avoid burning through Groq's TPM rate limit.
    // 3 s gap keeps a 10-turn loop under 12 000 TPM (llama-3.3-70b) comfortably.
    const iterDelay = parseInt(process.env.ITER_DELAY_MS || '3000', 10);
    if (iterDelay > 0) await new Promise(r => setTimeout(r, iterDelay));
  }

  return { lastMessage, steps, iterations: steps.length };
}

module.exports = { run };
