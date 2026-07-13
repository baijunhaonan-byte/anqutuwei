# ==================================================
# Dockerfile - 陪玩店网站 (腾讯云 CloudBase 云托管)
# ==================================================
FROM node:18-alpine

WORKDIR /app

# 复制依赖配置并安装
COPY package.json package-lock.json* ./
RUN npm install --production

# 复制项目文件
COPY . .

# 创建数据持久化目录
RUN mkdir -p /data/uploads

# CloudBase 云托管默认暴露 80 端口
# 通过环境变量 PORT=80 让 server.js 监听 80 端口
ENV PORT=80
ENV DATA_DIR=/data

EXPOSE 80

CMD ["node", "server.js"]
