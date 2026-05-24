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
# ✅ UNCHANGED: scripts/ (plural) copied for migrate.ts
COPY scripts ./scripts
COPY drizzle.config.ts ./

# ✅ UNCHANGED: pre-create migrations dir so COPY never fails when DATABASE_URL
# is absent at build time and db:migrate exits without creating the directory.
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

# ✅ CHANGED: removed "npx drizzle-kit migrate &&" from CMD.
# drizzle-kit is a devDependency — it is NOT installed in the production stage
# (npm ci --only=production). Running it here caused "Cannot find module
# 'drizzle-kit'" crash-loops on every container start.
#
# Migrations must be run as a Railway Deploy Command BEFORE the container
# starts receiving traffic. Set this in Railway:
#   Service → Settings → Deploy → Deploy Command:
#   npx drizzle-kit migrate
#
# Railway injects DATABASE_URL into that command's environment, so it works
# correctly there. The container itself just starts the app.
ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD ["node", "dist/index.cjs"]
