FROM node:22-slim

# git + curl needed by the agent's shell tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001

# Cap Node heap at 1.5 GB — leaves ~500 MB for child processes
# (git clone, npm install, test runners) on the 2 GB Render standard plan.
CMD ["node", "--max-old-space-size=1536", "src/index.js"]
