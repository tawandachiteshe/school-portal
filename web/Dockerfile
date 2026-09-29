FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 5173

FROM deps AS build
# The college's name, baked into the build (src/lib/college.ts); docker-compose passes COLLEGE_NAME.
ARG VITE_COLLEGE_NAME="Campus College"
ENV VITE_COLLEGE_NAME=$VITE_COLLEGE_NAME
COPY . .
RUN bun run build

FROM nginx:1.29-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
