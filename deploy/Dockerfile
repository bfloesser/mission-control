# Mission Control (Next.js 14 + better-sqlite3) — Deployment-Image für Synology
FROM node:20-bookworm

WORKDIR /app

# playwright ist als Dependency gelistet, wird hier aber nicht gebraucht -> Browser-Download überspringen
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Abhängigkeiten installieren (inkl. devDeps — für den Next.js-Build nötig).
# node:20-bookworm bringt Build-Tools (g++/make/python3) mit, falls better-sqlite3 kompiliert werden muss.
COPY package.json package-lock.json ./
RUN npm ci

# App-Quellcode
COPY . .

# Produktions-Build
RUN npm run build

# Laufzeit-Konfiguration
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/mission-control.db
ENV WORKSPACE_BASE_PATH=/app/data/workspace
ENV PROJECTS_PATH=/app/data/workspace/projects
RUN mkdir -p /app/data/workspace/projects

EXPOSE 4000
CMD ["npx", "next", "start", "-p", "4000"]
