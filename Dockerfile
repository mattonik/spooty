FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM alpine:latest
ENV NODE_PACKAGE_URL=https://unofficial-builds.nodejs.org/download/release/v18.16.0/node-v18.16.0-linux-x64-musl.tar.gz
RUN apk add libstdc++

WORKDIR /spooty
RUN apk add --no-cache ca-certificates ffmpeg python3 py3-pip deno yt-dlp wget unzip curl && update-ca-certificates
RUN wget $NODE_PACKAGE_URL
RUN mkdir -p /opt/nodejs
RUN tar -zxvf *.tar.gz --directory /opt/nodejs --strip-components=1
RUN rm *.tar.gz
RUN ln -s /opt/nodejs/bin/node /usr/local/bin/node
RUN ln -s /opt/nodejs/bin/npm /usr/local/bin/npm

# npm version coming with node is 9.5.1
# To install specific npm version, run the following command, or remove it to use the default npm version:
RUN npm install -g npm@9.6.6

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
