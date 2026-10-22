# Build:  pnpm nx build api && docker build -f apps/api/Dockerfile -t soccalytics-api .
FROM node:22-alpine
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
RUN corepack enable && addgroup -S app && adduser -S app -G app
WORKDIR /app
# esbuild bundles workspace libs; generatePackageJson lists only third-party deps.
COPY apps/api/dist/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY apps/api/dist ./
COPY libs/db/migrations ./migrations
USER app
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/livez || exit 1
CMD ["node", "main.js"]
