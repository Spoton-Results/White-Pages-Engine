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
# ✅ UNCHANGED: added in previous commit
COPY script ./script
# ✅ CHANGED: scripts/ (plural) was never copied — caused ERR_MODULE_NOT_FOUND
# for /app/scripts/migrate.ts when `npm run db:migrate` ran
COPY scripts ./scripts
COPY drizzle.config.ts ./

# ✅ CHANGED: pre-create migrations dir in the builder stage.
# db:migrate exits immediately when DATABASE_URL is absent at build time,
# so /app/migrations is never created — causing the production stage's
# COPY --from=builder /app/migrations/. to fail with "not found".
# mkdir -p guarantees the directory exists in this layer regardless.
RUN mkdir -p /app/migrations

# Build TypeScript → JavaScript
RUN npm run build

# Run database migrations to generate migration files
# (|| true so a missing DB env at build time doesn't fail the image)
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
# ✅ UNCHANGED: pre-create migrations dir so COPY never fails even if
# db:migrate produced no files (e.g. no DB_URL at build time)
RUN mkdir -p ./migrations
COPY --from=builder /app/migrations/. ./migrations/

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/_health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run migrations on startup, then start app
ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD sh -c "npx drizzle-kit migrate && node dist/server/index.js"
