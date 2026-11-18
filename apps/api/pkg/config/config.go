package config

import (
	"os"
	"time"

	"github.com/joho/godotenv"
)

// Config holds all application configuration.
type Config struct {
	DatabaseURL string
	RedisURL    string
	JWTSecret   string
	JWTExpiry   time.Duration
	Port        string

	// S3
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	S3Region    string

	// MQTT
	MQTTBroker   string
	MQTTClientID string
	MQTTUsername  string
	MQTTPassword string

	// Telegram
	TelegramBotToken string
	TelegramChatID   string
}

// Load reads environment variables and returns a Config.
func Load() (*Config, error) {
	// Load .env file if it exists (ignore error if missing)
	_ = godotenv.Load()

	jwtExpiry, err := time.ParseDuration(getEnv("JWT_EXPIRY", "24h"))
	if err != nil {
		jwtExpiry = 24 * time.Hour
	}

	return &Config{
		DatabaseURL: getEnv("DATABASE_URL", "postgres://rased:rased@localhost:5432/rased?sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:   getEnv("JWT_SECRET", "change-me-in-production"),
		JWTExpiry:   jwtExpiry,
		Port:        getEnv("PORT", "8080"),

		S3Endpoint:  getEnv("S3_ENDPOINT", ""),
		S3Bucket:    getEnv("S3_BUCKET", ""),
		S3AccessKey: getEnv("S3_ACCESS_KEY", ""),
		S3SecretKey: getEnv("S3_SECRET_KEY", ""),
		S3Region:    getEnv("S3_REGION", ""),

		MQTTBroker:   getEnv("MQTT_BROKER", ""),
		MQTTClientID: getEnv("MQTT_CLIENT_ID", "rased-api"),
		MQTTUsername:  getEnv("MQTT_USERNAME", ""),
		MQTTPassword: getEnv("MQTT_PASSWORD", ""),

		TelegramBotToken: getEnv("TELEGRAM_BOT_TOKEN", ""),
		TelegramChatID:   getEnv("TELEGRAM_CHAT_ID", ""),
	}, nil
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return fallback
}
