# Hugging Face Spaces (Docker SDK) — same pattern as your AgentFlow OS backend.
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# HF Spaces expects the app to listen on port 7860 by default.
ENV PORT=7860
EXPOSE 7860

# Uploaded submission files land here — HF Spaces gives you container-local disk
# that persists for the life of the running container (not across rebuilds).
RUN mkdir -p uploads

CMD ["node", "src/index.js"]
