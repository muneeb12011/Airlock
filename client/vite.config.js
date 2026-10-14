import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Link-preview crawlers (Slack, LinkedIn, Facebook) need absolute image URLs.
// Set VITE_PUBLIC_URL to your frontend's address, e.g. https://app.example.com
function socialMeta(publicUrl) {
  const base = (publicUrl || "").replace(/\/$/, "");
  return {
    name: "airlock-social-meta",
    transformIndexHtml(html) {
      return html
        .replaceAll("%OG_IMAGE%", `${base}/og-image.png`)
        .replace(/\s*<meta property="og:url" content="%PUBLIC_URL%" \/>/, base ? `\n    <meta property="og:url" content="${base}/" />` : "");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), socialMeta(env.VITE_PUBLIC_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)],
    server: { port: 5173 },
    preview: { port: 4173 },
    build: {
      outDir: "dist",
      sourcemap: false,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: { react: ["react", "react-dom", "react-router-dom"], socket: ["socket.io-client"] },
        },
      },
    },
  };
});
