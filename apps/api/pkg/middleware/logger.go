package middleware

import (
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Logger is an alias for RequestLogger
func Logger() fiber.Handler {
	return RequestLogger()
}

// RequestLogger logs HTTP request details.
func RequestLogger() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()

		err := c.Next()

		duration := time.Since(start)
		status := c.Response().StatusCode()

		log.Printf("[%s] %s %s — %d (%s)",
			c.IP(),
			c.Method(),
			c.Path(),
			status,
			duration,
		)

		return err
	}
}
