FROM node:18.20.4-alpine AS deps
WORKDIR /spooty
RUN apk add --no-cache nodejs npm
COPY . .
RUN npm ci
RUN npm run build

FROM alpine:latest
WORKDIR /spooty
RUN apk add --no-cache nodejs npm
COPY --from=builder /spooty/dist .
COPY --from=builder /spooty/src ./src
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env
RUN apk add --no-cache ca-certificates ffmpeg python3 curl unzip deno yt-dlp

RUN mkdir -p /spooty/backend/config/.cache
RUN npm prune --production
RUN rm -rf src package.json package-lock.json
EXPOSE 3000
CMD ["node", "backend/main.js"]
