FROM node:18.20.4-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM alpine:latest

WORKDIR /spooty
RUN apk add --no-cache ca-certificates ffmpeg python3 py3-pip deno yt-dlp curl && update-ca-certificates

ENV NODE_VERSION=18.20.4

COPY --from=builder /spooty/dist .
COPY --from=builder /spooty/src ./src
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/src/backend/.env.docker ./.env

RUN mkdir -p /spooty/backend/config/.cache

# Use bash for the shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Create a script file sourced by both interactive and non-interactive bash shells
ENV BASH_ENV=/home/user/.bash_env
RUN touch "${BASH_ENV}"
RUN echo '. "${BASH_ENV}"' >> ~/.bashrc

# Download and install nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | PROFILE="${BASH_ENV}" bash
RUN echo node > .nvmrc
RUN nvm install
RUN nvm use node@18.20.4

RUN node -v
RUN npm -v
RUN npm prune --production
RUN rm -rf src package.json package-lock.json
EXPOSE 3000
CMD ["node", "backend/main.js"]
