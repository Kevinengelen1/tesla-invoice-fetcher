# ============================================================
# Stage 1: Build client
# ============================================================
FROM node:20-alpine AS client-build

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/

RUN npm ci --workspace=packages/client --include-workspace-root

COPY packages/client/ packages/client/
COPY tsconfig.base.json ./

RUN npm run build -w packages/client

# ============================================================
# Stage 2: Build server
# ============================================================
FROM node:20-alpine AS server-build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm ci --workspace=packages/server --include-workspace-root

COPY packages/server/ packages/server/
COPY tsconfig.base.json ./

RUN npm run build -w packages/server

# ============================================================
# Stage 3: Production image
# ============================================================
FROM node:20-alpine AS production

RUN apk add --no-cache tini wget

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm ci --workspace=packages/server --include-workspace-root --omit=dev && \
    npm cache clean --force

# Copy built artifacts
COPY --from=server-build /app/packages/server/dist packages/server/dist
COPY --from=client-build /app/packages/client/dist packages/client/dist

# Create directories for data and invoices
RUN mkdir -p /app/data /app/invoices && \
    chown -R node:node /app

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD-SHELL wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-3001}/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
