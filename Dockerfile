# Mission Control — production image
# Build:  docker compose up -d --build   (or: docker build -t mission-control .)

FROM node:20-alpine AS builder
WORKDIR /app

# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# SQLite DB and credential encryption key live on the /data volume
ENV DATABASE_PATH=/data/mission-control.db

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./

# Runs as root: /data is typically a host bind mount (NAS setups) that a
# non-root container user could not write to without manual chown on the host.
RUN mkdir -p /data
VOLUME /data
EXPOSE 4000

CMD ["npm", "run", "start"]
