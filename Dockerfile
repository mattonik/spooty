FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY package.json package-lock.json ./
# IMPORTANT: if this is a workspace monorepo, also copy workspace package.json files here
# COPY src/backend/package.json src/backend/package.json
# COPY src/frontend/package.json src/frontend/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:18.20.4-alpine
WORKDIR /spooty

# system deps
RUN apk add --no-cache ca-certificates curl ffmpeg python3

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

# (Optional) EJS python helper via pip, if you prefer local scripts over remote-components
RUN pip3 install --no-cache-dir yt-dlp-ejs

# app
COPY --from=builder /spooty/dist ./dist
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/node_modules ./node_modules
COPY --from=builder /spooty/src/backend/.env.docker ./.env

RUN mkdir -p /spooty/backend/config/.cache

EXPOSE 3000
CMD ["node", "dist/backend/main.js"]