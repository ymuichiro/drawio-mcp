FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=3001
ENV LISTEN=0.0.0.0
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
COPY vendor ./vendor
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
