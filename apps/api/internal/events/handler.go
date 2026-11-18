package events

import (
	"bufio"
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rased/api/pkg/redis"
)

type Handler struct {
	redisClient *redis.Client
}

func NewHandler(rc *redis.Client) *Handler {
	return &Handler{redisClient: rc}
}

// Stream sends Server-Sent Events (SSE) to connected clients
func (h *Handler) Stream(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		channelName := fmt.Sprintf("company:%s:events", companyID)

		// Send initial connected event
		_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\",\"company_id\":\"%s\"}\n\n", companyID)
		_ = w.Flush()

		// If redis is not available, just keep connection alive with ping
		if h.redisClient == nil {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {}\n\n"); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			}
			return
		}

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		pubsub := h.redisClient.Subscribe(ctx, channelName)
		defer pubsub.Close()

		ch := pubsub.Channel()
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case msg, ok := <-ch:
				if !ok {
					return
				}
				if _, err := fmt.Fprintf(w, "event: detection\ndata: %s\n\n", msg.Payload); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}

			case <-ticker.C:
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {}\n\n"); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			}
		}
	})

	return nil
}
