FROM node:24-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/tsconfig.json ./
COPY server/src ./src
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S api && adduser -S api -G api \
  && mkdir -p /data/uploads \
  && chown -R api:api /data /app
COPY --from=build --chown=api:api /app/package.json ./
COPY --from=build --chown=api:api /app/node_modules ./node_modules
COPY --from=build --chown=api:api /app/dist ./dist
USER api
EXPOSE 4100
CMD ["node", "dist/index.js"]
