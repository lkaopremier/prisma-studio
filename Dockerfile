FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY entrypoint.sh proxy.js login.html ./
RUN chmod +x entrypoint.sh

ENV PORT=3000

EXPOSE 3000

CMD ["sh", "entrypoint.sh"]
