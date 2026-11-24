# Next.js standalone image — dipakai oleh deploy/docker-compose.prod.yml.
# Build context = root `tanyadata/` (tempat `.next/standalone` dihasilkan oleh
# `npm run build` + `postbuild` copy-standalone.mjs).
FROM node:22-alpine

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

# standalone sudah memuat server.js, node_modules minimal, dan (lewat postbuild)
# data/analytics.db, data/generated, data/seed, public/fonts, .next/static.
COPY .next/standalone/ ./

# Next tidak menyalin static ke standalone secara default. postbuild sudah
# melakukan ini; baris ini pengaman bila image dibangun dari artifact lain.
COPY .next/static/ ./.next/static/

RUN mkdir -p /app/data/workspace /app/data/seed

EXPOSE 3000

# Tidak ada dev server / watcher. Satu proses Node, non-interaktif.
CMD ["node", "server.js"]
