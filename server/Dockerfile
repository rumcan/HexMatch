# Room server image. Tiny on purpose — this process only relays messages.
FROM node:22-alpine

WORKDIR /app

# install deps first so Docker caches them between deploys
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

# Fly injects PORT; the server already reads it, this is just the default
ENV PORT=8080
EXPOSE 8080

# run as a non-root user
USER node

CMD ["node", "server.js"]