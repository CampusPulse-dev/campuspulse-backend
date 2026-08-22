# syntax=docker/dockerfile:1.7

# --ignore-scripts throughout: husky is a devDependency and its `prepare`
# script would fail the production install. Prisma's client is generated
# explicitly instead of relying on a postinstall hook.

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- production deps ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# prisma is a runtime dependency: Render runs `prisma migrate deploy` as
# its pre-deploy command, inside this image.
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate

# ---------- runtime ----------
FROM node:22-alpine AS runtime
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
