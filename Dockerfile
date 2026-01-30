FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM node:18.20.4-alpine
WORKDIR /spooty

RUN apk add --no-cache ca-certificates curl ffmpeg python3 unzip \
  && update-ca-certificates

RUN curl -L --fail -o /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64 \
  && chmod +x /usr/local/bin/yt-dlp

RUN curl -L --fail -o /tmp/deno.zip \
    https://github.com/denoland/deno/releases/latest/download/deno-aarch64-unknown-linux-gnu.zip \
  && unzip /tmp/deno.zip -d /usr/local/bin \
  && rm /tmp/deno.zip \
  && chmod +x /usr/local/bin/deno

COPY --from=builder /spooty/dist ./dist
COPY --from=builder /spooty/node_modules ./node_modules
COPY --from=builder /spooty/src/backend/.env.docker ./.env
COPY --from=builder /spooty/package.json ./package.json

RUN mkdir -p /spooty/backend/config/.cache

EXPOSE 3000
CMD ["node", "dist/backend/main.js"]