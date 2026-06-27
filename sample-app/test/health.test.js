const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('../server');

// Start the app on an ephemeral port for the duration of the test run.
function listen() {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /health returns 200 with status ok', async () => {
  const server = await listen();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('GET / returns the greeting', async () => {
  const server = await listen();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.message === 'string');
  } finally {
    server.close();
  }
});
