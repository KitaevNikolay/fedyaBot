FROM node:20.19.0-alpine AS builder

WORKDIR /app

ARG VITE_TELEGRAM_BOT_USERNAME=""
ENV VITE_TELEGRAM_BOT_USERNAME=$VITE_TELEGRAM_BOT_USERNAME
ENV VITE_API_BASE_URL=""

COPY cabinet/package*.json ./
RUN npm install

COPY cabinet ./
RUN npm run build

FROM nginx:1.27-alpine

COPY cabinet/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
