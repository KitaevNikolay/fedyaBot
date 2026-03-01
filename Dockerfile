FROM node:20.19.0-alpine AS builder

WORKDIR /app

# Install dependencies for Prisma and build
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Runner
FROM node:20.19.0-alpine

WORKDIR /app

# Prisma needs openssl
RUN apk add --no-cache openssl

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create logs directory and set permissions
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app/logs

COPY package*.json ./
COPY prisma ./prisma
COPY config ./config
# Only production dependencies
RUN npm install --omit=dev

# Copy build result from builder
COPY --from=builder /app/dist ./dist

USER appuser

# Use shell form to allow environment variable expansion if needed, 
# but prefer exec form for better signal handling (SIGTERM)
# We run migration before starting
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
