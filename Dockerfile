FROM node:18.20.4-alpine AS deps
WORKDIR /spooty
COPY package*.json ./
RUN npm ci

FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY --from=deps /spooty/node_modules ./node_modules
COPY . .
RUN npm i -g @nestjs/cli
RUN npm run build

FROM node:18.20.4-alpine AS runtime
WORKDIR /spooty

# OS deps for yt-dlp + EJS + transcoding
RUN apk add --no-cache \
    ca-certificates \
    deno \
    ffmpeg \
    python3 \
    yt-dlp \
    tini

# Copy compiled output + prod dependencies
COPY --from=builder /spooty/dist ./dist
COPY --from=builder /spooty/node_modules ./node_modules
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env

# (Optional) if your runtime expects backend/main.js specifically:
# If dist already contains backend/main.js, you can run from dist.
# Otherwise, ensure the correct entry exists.
ENV NODE_ENV=production

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/backend/main.js"]