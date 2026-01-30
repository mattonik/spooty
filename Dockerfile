FROM node:18.20.4-alpine AS deps
WORKDIR /spooty

# Copy root manifests
COPY package.json package-lock.json ./

# Copy workspace manifests (CRITICAL)
COPY src/backend/package.json src/backend/package.json
COPY src/frontend/package.json src/frontend/package.json

# If there are more workspaces, copy their package.json too.
# (Optional) copy any shared workspace packages here as well.

RUN npm ci --workspaces

FROM node:18.20.4-alpine AS builder
WORKDIR /spooty

COPY --from=deps /spooty/node_modules ./node_modules
COPY . .

# Nest CLI: either via devDeps or global; keep global for simplicity
RUN npm i -g @nestjs/cli
RUN npm run build

FROM node:18.20.4-alpine AS runtime
WORKDIR /spooty

RUN apk add --no-cache ca-certificates deno ffmpeg python3 yt-dlp tini

# Copy compiled output + runtime deps
COPY --from=builder /spooty/dist ./dist
COPY --from=builder /spooty/node_modules ./node_modules
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/backend/main.js"]