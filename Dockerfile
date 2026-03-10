FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY entrypoint.sh proxy.js login.html ./
RUN chmod +x entrypoint.sh

ENV PORT=3000

EXPOSE 3000

CMD ["sh", "entrypoint.sh"]
