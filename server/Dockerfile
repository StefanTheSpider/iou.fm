# Sync-Hub – minimal, keine externen Abhängigkeiten (nur Node-Standardbibliothek).
FROM node:20-alpine
WORKDIR /app
# Zeitzone für den Nacht-Cron (00:00 Europe/Berlin)
RUN apk add --no-cache tzdata
ENV TZ=Europe/Berlin
COPY package.json ./
COPY index.mjs ./
COPY shopify.mjs ./
COPY shopify-oauth.mjs ./
COPY billing.mjs ./
COPY stripe.mjs ./
COPY inbound.mjs ./
COPY accountant.mjs ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
# /data ist ein Railway-Volume (persistente Mandanten-DBs).
CMD ["node", "index.mjs"]
