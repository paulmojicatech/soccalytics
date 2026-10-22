# Build:  pnpm nx build worker && docker build -f apps/worker/Dockerfile -t soccalytics-worker .
FROM node:22-alpine
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY apps/worker/dist/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY apps/worker/dist ./
USER app
CMD ["node", "main.js"]
