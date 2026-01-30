FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM alpine:latest
WORKDIR /spooty
COPY --from=builder /usr/lib /usr/lib
COPY --from=builder /usr/local/lib /usr/local/lib
COPY --from=builder /usr/local/include /usr/local/include
COPY --from=builder /usr/local/bin /usr/local/bin

RUN apk add --no-cache ca-certificates ffmpeg python3 deno yt-dlp

COPY --from=builder /spooty/dist .
COPY --from=builder /spooty/src ./src
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env

RUN mkdir -p /spooty/backend/config/.cache
RUN npm prune --production
RUN rm -rf src package.json package-lock.json
EXPOSE 3000
CMD ["node", "backend/main.js"]
