# Multi-stage build for Go API
FROM golang:1.23-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod ./
COPY . .

RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/bin/server cmd/server/main.go

# Production runner image
FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /app/bin/server /app/server
COPY --from=builder /app/pkg/database/migrations /app/migrations
COPY .env.example .env

EXPOSE 8080

CMD ["/app/server"]
