# deps
FROM node:22-alpine AS deps
RUN npm i -g pnpm@10.27.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# build
FROM node:22-alpine AS build
RUN npm i -g pnpm@10.27.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json package.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

# runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
