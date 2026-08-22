# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:26-alpine AS deps
WORKDIR /app
# git: @campuspulse/contract is a git dependency.
RUN apk add --no-cache git openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---------- build ----------
FROM node:26-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- production deps ----------
FROM node:26-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache git openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# ---------- runtime ----------
FROM node:26-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

# Never run the API as root.
RUN addgroup -S app && adduser -S app -G app

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app package.json ./

USER app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards SIGTERM, so Nest's shutdown hooks actually run.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
