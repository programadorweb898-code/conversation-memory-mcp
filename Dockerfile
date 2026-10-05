FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY plugins ./plugins
COPY docs ./docs
COPY .env.example README.md ./

ENV NODE_ENV=production

EXPOSE 10000

CMD ["npm", "start"]
