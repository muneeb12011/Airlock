# Airlock API — works on Hugging Face Spaces (Docker SDK), Render, Fly, Railway
# or any container host.
FROM node:20-slim

ENV NODE_ENV=production \
    PORT=7860 \
    TRUST_PROXY=1 \
    UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Run as the unprivileged "node" user; uploads go to a dedicated volume path.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
