# Sync-Hub – minimal, keine externen Abhängigkeiten (nur Node-Standardbibliothek).
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY index.mjs ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
# /data ist ein Railway-Volume (persistente Mandanten-DBs).
CMD ["node", "index.mjs"]
