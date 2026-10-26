# Self-host the CENTRA relay instead of Cloudflare. Build from the repo root:
#   docker build -f services/relay/Dockerfile -t centra-relay .
FROM node:22-alpine
WORKDIR /app
COPY packages/relay-core packages/relay-core
COPY services/relay/server.ts services/relay/package.json services/relay/
RUN cd services/relay && npm install --omit=dev ws && mkdir -p node_modules/@centra && ln -s ../../../../packages/relay-core node_modules/@centra/relay-core
ENV PORT=8787 DATA=/data ALLOWED_USERS=tranberg
VOLUME /data
EXPOSE 8787
CMD ["node", "services/relay/server.ts"]
