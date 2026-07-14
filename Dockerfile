FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
RUN mkdir -p /data
ENV PORT=80
EXPOSE 80
CMD ["node", "server.js"]
