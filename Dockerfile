# Multi-stage build: compile TypeScript, bundle deps
FROM node:20-alpine AS builder
WORKDIR /app

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy packages
COPY package*.json ./
COPY tsconfig.json ./
COPY vite.config.ts ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY drizzle.config.ts ./

# Build TypeScript → JavaScript
RUN npm run build

# Run database migrations to generate migration files
RUN npm run db:migrate || true

# Production runner stage
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy production packages only
COPY package*.json ./
RUN npm ci --only=production

# Copy runtime files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/_health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run migrations on startup, then start app
ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD sh -c "npx drizzle-kit migrate && node dist/server/index.js"
