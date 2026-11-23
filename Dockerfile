FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
RUN mkdir /runtime && cp package*.json /runtime/ \
    && npm ci --prefix /runtime --omit=dev --offline --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript libreoffice-writer poppler-utils tesseract-ocr tesseract-ocr-heb tesseract-ocr-eng \
    fonts-liberation fonts-dejavu-core fonts-noto-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /runtime/node_modules ./node_modules
ENV NODE_ENV=production HOST=0.0.0.0
USER node
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=3s CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server/index.mjs"]
