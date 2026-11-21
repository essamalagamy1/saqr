package internal

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rased/api/internal/ai_service"
	"github.com/rased/api/internal/auth"
	"github.com/rased/api/internal/branch"
	"github.com/rased/api/internal/camera"
	"github.com/rased/api/internal/company"
	"github.com/rased/api/internal/detection"
	"github.com/rased/api/internal/events"
	"github.com/rased/api/internal/notification"
	"github.com/rased/api/internal/task"
	"github.com/rased/api/internal/zone"
	"github.com/rased/api/pkg/config"
	"github.com/rased/api/pkg/middleware"
	"github.com/rased/api/pkg/redis"
)

// SetupRoutes registers all API routes
func SetupRoutes(app *fiber.App, db *pgxpool.Pool, redisClient *redis.Client, notifier *notification.TelegramNotifier, cfg *config.Config) {
	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "rased-api",
		})
	})

	api := app.Group("/api/v1")

	// Public Auth routes
	authHandler := auth.NewHandler(db, cfg)
	authGroup := api.Group("/auth")
	authGroup.Post("/login", authHandler.Login)
	authGroup.Post("/register", authHandler.Register)
	authGroup.Post("/refresh", authHandler.RefreshToken)
	authGroup.Post("/logout", authHandler.Logout)

	// Protected routes (require JWT)
	protected := api.Group("", middleware.Auth(cfg.JWTSecret), middleware.Tenant())

	// Company
	compHandler := company.NewHandler(db)
	compGroup := protected.Group("/company")
	compGroup.Get("/current", compHandler.GetCurrent)
	compGroup.Put("/current", compHandler.UpdateCurrent)

	// Branches
	branchHandler := branch.NewHandler(db)
	branchGroup := protected.Group("/branches")
	branchGroup.Get("/", branchHandler.List)
	branchGroup.Post("/", branchHandler.Create)
	branchGroup.Delete("/:id", branchHandler.Delete)

	// Zones
	zoneHandler := zone.NewHandler(db)
	zoneGroup := protected.Group("/zones")
	zoneGroup.Get("/", zoneHandler.List)
	zoneGroup.Post("/", zoneHandler.Create)
	zoneGroup.Delete("/:id", zoneHandler.Delete)

	// Cameras
	cameraHandler := camera.NewHandler(db)
	camGroup := protected.Group("/cameras")
	camGroup.Get("/", cameraHandler.List)
	camGroup.Post("/", cameraHandler.Create)
	camGroup.Patch("/:id/status", cameraHandler.UpdateStatus)
	camGroup.Patch("/:id/config", cameraHandler.UpdateConfig)
	camGroup.Delete("/bulk/all", cameraHandler.DeleteAll)
	camGroup.Delete("/:id", cameraHandler.Delete)

	// Detections
	detectHandler := detection.NewHandler(db, redisClient, notifier)
	detectGroup := protected.Group("/detections")
	detectGroup.Get("/", detectHandler.List)
	detectGroup.Post("/ingest", detectHandler.Ingest)
	detectGroup.Get("/stats", detectHandler.Stats)
	detectGroup.Get("/storage/stats", detectHandler.StorageStats)
	detectGroup.Post("/storage/process-tiers", detectHandler.ProcessTiers)
	detectGroup.Patch("/:id/read", detectHandler.MarkAsRead)
	detectGroup.Patch("/:id/acknowledge", detectHandler.Acknowledge)
	detectGroup.Patch("/:id/pin", detectHandler.Pin)
	detectGroup.Post("/:id/feedback", detectHandler.SubmitFeedback)
	detectGroup.Get("/training/stats", detectHandler.TrainingStats)
	detectGroup.Post("/training/export", detectHandler.ExportDataset)
	detectGroup.Delete("/all", detectHandler.DeleteAll)
	detectGroup.Delete("/:id", detectHandler.Delete)

	// Real-time Event Stream (SSE)
	eventsHandler := events.NewHandler(redisClient)
	protected.Get("/events/stream", eventsHandler.Stream)

	// Tasks
	taskHandler := task.NewHandler(db)
	taskGroup := protected.Group("/tasks")
	taskGroup.Get("/", taskHandler.List)
	taskGroup.Post("/", taskHandler.Create)
	taskGroup.Patch("/:id/status", taskHandler.UpdateStatus)
	taskGroup.Delete("/:id", taskHandler.Delete)

	// AI Services
	aiHandler := ai_service.NewHandler(db)
	aiGroup := protected.Group("/ai-services")
	aiGroup.Get("/", aiHandler.List)
	aiGroup.Patch("/:id/status", aiHandler.ToggleStatus)
}
