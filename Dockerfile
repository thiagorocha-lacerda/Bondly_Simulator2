# syntax=docker/dockerfile:1
# Bondly Commercial Platform — imagem única: o auth-proxy serve o SPA buildado. Node 22 (node:sqlite).
# NÃO VERIFICADO com docker build (Docker ausente no ambiente de autoria).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/pricing-engine/package.json packages/pricing-engine/
COPY apps/commercial-workspace/package.json apps/commercial-workspace/
COPY apps/auth-proxy/package.json apps/auth-proxy/
RUN npm ci
COPY . .
# Ordem explícita: engine -> workspace (SPA) -> auth-proxy
RUN npm run build --workspace @bondly/pricing-engine \
 && npm run build --workspace @bondly/commercial-workspace \
 && npm run build --workspace @bondly/auth-proxy

FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/pricing-engine/package.json packages/pricing-engine/
COPY apps/commercial-workspace/package.json apps/commercial-workspace/
COPY apps/auth-proxy/package.json apps/auth-proxy/
RUN npm ci --omit=dev --workspace @bondly/auth-proxy --workspace @bondly/pricing-engine

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=10000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/apps/commercial-workspace/dist
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/pricing-engine/package.json ./packages/pricing-engine/package.json
COPY --from=build /app/packages/pricing-engine/dist ./packages/pricing-engine/dist
COPY --from=build /app/apps/auth-proxy/package.json ./apps/auth-proxy/package.json
COPY --from=build /app/apps/auth-proxy/dist ./apps/auth-proxy/dist
COPY --from=build /app/apps/commercial-workspace/dist ./apps/commercial-workspace/dist
# /data: volume persistente (EBS). Usuário 'node' (não-root).
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/auth-proxy/dist/server.js"]
