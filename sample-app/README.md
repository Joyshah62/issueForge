# IssueForge Sample App

A minimal Express application used as a target for IssueForge end-to-end runs.
It is intentionally small so the autonomous agent has a clear, self-contained
codebase to modify.

## Endpoints

- `GET /` — returns a JSON greeting.
- `GET /health` — returns `{ "status": "ok", "version": "..." }`.

## Scripts

| Command           | Description                          |
|-------------------|--------------------------------------|
| `npm install`     | Install dependencies.                |
| `npm start`       | Start the server (default port 3000).|
| `npm test`        | Run the test suite (`node --test`).  |
| `npm run lint`    | No-op (no linter configured).        |
| `npm run typecheck` | No-op (not a TypeScript project).  |
| `npm run build`   | No-op (nothing to build).            |

## Running locally

```bash
cd sample-app
npm install
npm start
# in another shell:
curl http://localhost:3000/health
```
