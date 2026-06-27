const express = require('express');

const app = express();

// Simple in-memory greeting store
let greeting = 'Hello, world!';

app.get('/', (_req, res) => {
  res.json({ message: greeting });
});

// Health check — returns basic service status.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: require('./package.json').version,
  });
});

function createServer() {
  return app;
}

// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`sample-app listening on :${port}`);
  });
}

module.exports = { app, createServer };
