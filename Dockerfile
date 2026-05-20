FROM node:20-slim AS base
WORKDIR /app

# Install openssl for Drizzle/pg compatibility
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# ---- deps ----
FROM base AS deps
COPY package*.json ./
RUN npm ci --prefer-offline

# ---- build ----
FROM deps AS builder
COPY . .
# Generate SQL migration files from schema (no live DB needed for generate)
# Use a placeholder DATABASE_URL so drizzle.config.ts doesn't throw on import
RUN DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder \
    npx drizzle-kit generate || true
RUN npm run build

# ---- production ----
FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy only what's needed to run
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle.config.* ./
# migrations dir is the output of drizzle-kit generate (out: './migrations' in drizzle.config.ts)
COPY --from=builder /app/migrations ./migrations

ENV NODE_ENV=production

EXPOSE 5000

# Run migrations then start server
CMD ["sh", "-c", "npx drizzle-kit migrate && node dist/index.cjs"]
