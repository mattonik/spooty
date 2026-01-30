FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM alpine:latest

WORKDIR /spooty
RUN apk add --no-cache ca-certificates nodejs npm ffmpeg python3 py3-pip deno yt-dlp curl && update-ca-certificates

ENV NODE_VERSION=18.20.4

COPY --from=builder /spooty/dist .
COPY --from=builder /spooty/src ./src
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env

RUN mkdir -p /spooty/backend/config/.cache

#RUN npm prune --production
#RUN rm -rf src package.json package-lock.json
EXPOSE 3000
#CMD ["node", "backend/main.js"]
