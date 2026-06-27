const fs = require('fs/promises');
const path = require('path');
const ws = require('./workspace');

// ── Tool definitions (OpenAI function-calling format) ──────────────────────

const DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'shell_exec',
      description:
        'Execute a shell command inside the workspace directory. Returns stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' },
          subdir: {
            type: 'string',
            description: 'Subdirectory inside the workspace to run in (default: workspace root).',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Max seconds to wait (default 120, max 600).',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the workspace. Returns its text content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (create or overwrite) a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root.' },
          content: { type: 'string', description: 'Full file content.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files in the workspace (up to 3 directory levels deep).',
      parameters: {
        type: 'object',
        properties: {
          subdir: {
            type: 'string',
            description: 'Subdirectory to list (default: workspace root).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make an HTTP request and return the response body.',
      parameters: {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
            description: 'HTTP method.',
          },
          url: { type: 'string', description: 'Full URL.' },
          headers: {
            type: 'object',
            description: 'Request headers (key-value pairs).',
          },
          body: {
            type: 'string',
            description: 'JSON-serialised request body for POST/PATCH/PUT.',
          },
        },
        required: ['method', 'url'],
      },
    },
  },
];

// ── Tool execution ─────────────────────────────────────────────────────────

async function execute(name, args, workspaceDir) {
  const safe = p => {
    const resolved = path.resolve(workspaceDir, p);
    if (!resolved.startsWith(workspaceDir)) throw new Error(`Path escape attempt: ${p}`);
    return resolved;
  };

  switch (name) {
    case 'shell_exec': {
      const cwd = args.subdir ? safe(args.subdir) : workspaceDir;
      const timeout = Math.min(args.timeout_seconds || 120, 600);
      const result = await ws.shell(args.command, cwd, timeout);
      return JSON.stringify(result);
    }

    case 'read_file': {
      const target = safe(args.path);
      try {
        const content = await fs.readFile(target, 'utf8');
        // Truncate very large files so they don't blow the context window
        return content.length > 32_000
          ? content.slice(0, 32_000) + '\n\n[... truncated — file is ' + content.length + ' bytes total]'
          : content;
      } catch (err) {
        return `Error reading file: ${err.message}`;
      }
    }

    case 'write_file': {
      const target = safe(args.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, args.content, 'utf8');
      return `Written ${args.content.length} bytes to ${args.path}`;
    }

    case 'list_dir': {
      const base = args.subdir ? safe(args.subdir) : workspaceDir;
      const files = await ws.listRecursive(base, 3);
      return files.join('\n') || '(empty)';
    }

    case 'http_request': {
      try {
        const opts = {
          method: args.method,
          headers: { 'Content-Type': 'application/json', ...(args.headers || {}) },
        };
        if (args.body) opts.body = args.body;
        const resp = await fetch(args.url, opts);
        const text = await resp.text();
        return JSON.stringify({ status: resp.status, body: text.slice(0, 8_000) });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

module.exports = { DEFINITIONS, execute };
