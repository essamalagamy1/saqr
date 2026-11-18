package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type TelegramNotifier struct {
	db       *pgxpool.Pool
	token    string
	chatID   string
	client   *http.Client
	isActive bool
}

func NewTelegramNotifier(db *pgxpool.Pool, token, chatID string) *TelegramNotifier {
	active := token != "" && chatID != ""
	if active {
		log.Printf("Telegram Notifier initialized (ChatID: %s)", chatID)
	} else {
		log.Println("Telegram Notifier unconfigured or disabled.")
	}

	return &TelegramNotifier{
		db:       db,
		token:    token,
		chatID:   chatID,
		client:   &http.Client{Timeout: 10 * time.Second},
		isActive: active,
	}
}

type AlertPayload struct {
	DetectionID string
	CompanyID   string
	BranchName  string
	CameraName  string
	ZoneName    string
	Type        string
	Severity    string
	Confidence  float64
	SnapshotURL string
	DetectedAt  time.Time
}

func (tn *TelegramNotifier) SendAlert(ctx context.Context, alert AlertPayload) error {
	if !tn.isActive {
		return nil
	}

	severityEmoji := "⚠️"
	if alert.Severity == "critical" || alert.Severity == "high" {
		severityEmoji = "🚨"
	}

	messageText := fmt.Sprintf(
		"%s *صَقْر — تنبيه رصد مخالفة*\n\n"+
			"🏢 *الفرع:* %s\n"+
			"📹 *الكاميرا:* %s\n"+
			"📍 *المنطقة:* %s\n"+
			"🔍 *نوع الحدث:* %s\n"+
			"📊 *نسبة الثقة:* %.0f%%\n"+
			"⚡ *مستوى الخطورة:* %s\n"+
			"⏰ *التوقيت:* %s",
		severityEmoji,
		alert.BranchName,
		alert.CameraName,
		alert.ZoneName,
		alert.Type,
		alert.Confidence*100,
		alert.Severity,
		alert.DetectedAt.Format("2006-01-02 15:04:05"),
	)

	if alert.SnapshotURL != "" {
		messageText += fmt.Sprintf("\n\n📸 [عرض لقطة الرصد](%s)", alert.SnapshotURL)
	}

	// Prepare Telegram API request
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", tn.token)
	bodyData := map[string]interface{}{
		"chat_id":    tn.chatID,
		"text":       messageText,
		"parse_mode": "Markdown",
	}

	jsonBytes, err := json.Marshal(bodyData)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := tn.client.Do(req)
	status := "sent"
	var errMsg *string
	if err != nil {
		status = "failed"
		msg := err.Error()
		errMsg = &msg
		log.Printf("Failed to dispatch Telegram alert: %v", err)
	} else {
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			status = "failed"
			msg := fmt.Sprintf("Telegram HTTP %d", resp.StatusCode)
			errMsg = &msg
		}
	}

	// Log to database
	if tn.db != nil {
		_, _ = tn.db.Exec(context.Background(), `
			INSERT INTO notification_logs (company_id, detection_id, channel, recipient, status, payload, error_message)
			VALUES ($1, $2, 'telegram', $3, $4, $5, $6)
		`, alert.CompanyID, alert.DetectionID, tn.chatID, status, jsonBytes, errMsg)
	}

	return nil
}
