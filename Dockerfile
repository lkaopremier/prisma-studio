FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV PORT=5555

EXPOSE 5555

CMD ["sh", "entrypoint.sh"]
