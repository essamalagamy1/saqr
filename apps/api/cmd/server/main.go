package main

import (
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/rased/api/internal"
	"github.com/rased/api/internal/notification"
	"github.com/rased/api/pkg/config"
	"github.com/rased/api/pkg/database"
	"github.com/rased/api/pkg/middleware"
	"github.com/rased/api/pkg/redis"
)

func main() {
	// 1. Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// 2. Connect to Database
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Printf("Warning: Failed to connect to DB at %s: %v. Running in offline mode.", cfg.DatabaseURL, err)
	} else {
		defer db.Close()
		log.Println("Connected to PostgreSQL successfully")
	}

	// 3. Connect to Redis
	redisClient, err := redis.Connect(cfg.RedisURL)
	if err != nil {
		log.Printf("Warning: Failed to connect to Redis at %s: %v. PubSub disabled.", cfg.RedisURL, err)
	} else {
		defer redisClient.Close()
	}

	// 4. Initialize Notification Dispatchers
	var pool = db.Pool
	telegramNotifier := notification.NewTelegramNotifier(pool, cfg.TelegramBotToken, cfg.TelegramChatID)

	// 5. Initialize Fiber App
	app := fiber.New(fiber.Config{
		AppName:      "Rased API v1.0",
		ServerHeader: "Rased",
	})

	// 6. Global Middlewares
	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     "*",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		AllowCredentials: false,
	}))
	app.Use(middleware.Logger())

	// 7. Register Routes
	internal.SetupRoutes(app, pool, redisClient, telegramNotifier, cfg)

	// 8. Start Server
	log.Printf("Starting Rased API server on port %s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
