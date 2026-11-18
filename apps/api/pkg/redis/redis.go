package redis

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type Client struct {
	RDB *redis.Client
}

func Connect(redisURL string) (*Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		// Fallback for simple host:port
		opt = &redis.Options{
			Addr: redisURL,
		}
	}

	rdb := redis.NewClient(opt)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to ping redis at %s: %w", redisURL, err)
	}

	log.Printf("Connected to Redis successfully (%s)", redisURL)
	return &Client{RDB: rdb}, nil
}

func (c *Client) Publish(ctx context.Context, channel string, message interface{}) error {
	if c == nil || c.RDB == nil {
		return nil
	}
	return c.RDB.Publish(ctx, channel, message).Err()
}

func (c *Client) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	if c == nil || c.RDB == nil {
		return nil
	}
	return c.RDB.Subscribe(ctx, channels...)
}

func (c *Client) Close() error {
	if c != nil && c.RDB != nil {
		return c.RDB.Close()
	}
	return nil
}
