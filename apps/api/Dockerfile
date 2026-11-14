# Stage 1: Builder
FROM node:22-alpine AS builder

# P1-T07: Pinned pnpm version activated through Corepack
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/api/ apps/api/

# Install dependencies strictly from lockfile
RUN pnpm install --frozen-lockfile

# Build the API
RUN pnpm --filter @360events/api run build

# Stage 2: Runner
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

WORKDIR /app

# P1-T07: Run as non-root user
USER node

# Copy built artifacts and dependencies with correct ownership
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/apps/api ./apps/api

EXPOSE 3000

# src/index.ts compiles to dist/index.js (tsconfig rootDir=src, outDir=dist).
CMD ["node", "apps/api/dist/index.js"]
