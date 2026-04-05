FROM node:22-alpine AS deps
WORKDIR /app
COPY mcp-app-server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=3001
ENV LISTEN=0.0.0.0
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY mcp-app-server/package.json ./package.json
COPY mcp-app-server/src ./src
COPY mcp-app-server/vendor ./vendor
COPY shared ./shared
COPY shape-search/search-index.json ./shape-search/search-index.json
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
