# Multi-stage Dockerfile for Njent Code Review Agent
FROM node:22-alpine AS builder

WORKDIR /app

# Optimize Node memory for VPS build containers
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Copy root monorepo files for dependencies
COPY package*.json tsconfig.base.json ./
COPY packages/ packages/
COPY examples/code-review-agent/ examples/code-review-agent/

# Install dependencies and build all packages
RUN npm ci --prefer-offline --no-audit
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy built workspace and dependencies
COPY package*.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/examples/code-review-agent ./examples/code-review-agent
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "examples/code-review-agent/dist/main.js"]
