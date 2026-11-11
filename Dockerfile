FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build --config vite.pwa.config.ts

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3020
RUN echo '{"type":"module"}' > package.json && npm install --omit=dev express@4.21.2 tlock-js@0.9.0
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist/pwa ./dist/pwa
VOLUME ["/app/data"]
EXPOSE 3020
CMD ["node", "server/index.ts"]
