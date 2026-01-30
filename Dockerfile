FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM node:18.20.4-alpine
WORKDIR /spooty
COPY --from=builder /spooty/dist .
COPY --from=builder /spooty/src ./src
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env
RUN apk add --no-cache ca-certificates ffmpeg python3 curl unzip

# Install upstream yt-dlp (Pi 5 = aarch64)
RUN curl -L --fail -o /usr/local/bin/yt-dlp \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64 \
  && chmod +x /usr/local/bin/yt-dlp

# Install upstream deno 2.x (Pi 5 = aarch64)
RUN curl -L --fail -o /tmp/deno.zip \
  https://github.com/denoland/deno/releases/latest/download/deno-aarch64-unknown-linux-gnu.zip \
  && unzip /tmp/deno.zip -d /usr/local/bin \
  && rm /tmp/deno.zip \
  && chmod +x /usr/local/bin/deno

RUN mkdir -p /spooty/backend/config/.cache
RUN npm prune --production
RUN rm -rf src package.json package-lock.json
EXPOSE 3000
CMD ["node", "backend/main.js"]
