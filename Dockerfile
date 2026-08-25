FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3005
ENV API_HOST=0.0.0.0

EXPOSE 3005

CMD ["node", "scripts/vpsStart.mjs"]
