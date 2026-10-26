# Self-host the CENTRA relay (Fly.io, Railway, Render, a NAS…). It only ever stores ciphertext.
FROM node:22-alpine
WORKDIR /relay
COPY package.json server.ts ./
RUN npm install --omit=dev
ENV PORT=8787 DATA=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "server.ts"]
