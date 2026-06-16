# --- build web ---
FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci --workspace web --include-workspace-root
COPY web ./web
RUN npm run build --workspace web

# --- build server ---
FROM node:20-slim AS server
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --include-workspace-root
COPY server ./server
RUN npm run prisma:generate --workspace server && npm run build --workspace server

# --- runtime ---
FROM node:20-slim AS runtime
WORKDIR /app/server
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000
COPY --from=server /app/node_modules /app/node_modules
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/prisma ./prisma
COPY --from=server /app/server/package.json ./package.json
COPY --from=web /app/web/dist ./public
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.js"]
