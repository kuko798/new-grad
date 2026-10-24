# Small production image: build the client, then run the dependency-free Node server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data DIST_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/public/data ./data
COPY server ./server
COPY src/lib/types.ts ./src/lib/types.ts
COPY package.json ./
EXPOSE 8787
USER node
CMD ["node", "server/index.ts"]
