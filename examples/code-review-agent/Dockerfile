# Multi-stage Dockerfile for Njent Code Review Agent
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root monorepo files for dependencies
COPY package*.json tsconfig.base.json ./
COPY packages/ packages/
COPY examples/code-review-agent/ examples/code-review-agent/

# Install and build
RUN npm ci
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
COPY packages/ packages/
COPY --from=builder /app/examples/code-review-agent/dist ./examples/code-review-agent/dist
COPY --from=builder /app/examples/code-review-agent/package*.json ./examples/code-review-agent/
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "examples/code-review-agent/dist/src/main.js"]
