# Production image with ffmpeg. Works on Railway, Fly, Render, or any Docker host.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# NEXT_PUBLIC_* values are baked into the browser code at build time. Railway passes
# service variables with these names to the build automatically.
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
RUN npm run build
ENV NODE_ENV=production PORT=4747
EXPOSE 4747
# ./data (embedded DB) and ./storage (audio) should be mounted volumes unless DATABASE_URL and S3 are set.
CMD ["npm", "start"]
