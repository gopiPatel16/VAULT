# Vault backend.
#
# Two stages so the runtime image carries no compiler, no source and no dev
# dependencies. Runs as an unprivileged user: nothing here needs root, and a
# process that cannot write outside its data volume cannot be made to.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN addgroup -S vault && adduser -S vault -G vault \
 && mkdir -p /data/storage && chown -R vault:vault /data
USER vault

EXPOSE 3000

# Migrations run on start so a fresh volume comes up correct. `migrate deploy`
# only applies committed migrations; it never generates or resets anything.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
