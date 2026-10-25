package connector

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const SchemaVersion = "ace.gateway.v1"
const DefaultMaxBodyBytes int64 = 4 * 1024 * 1024

type Request struct {
	RequestID       string
	AttemptGroupID  string
	AgentSessionID  string
	WorkspaceID     string
	DataClass       string
	Protocol        string
	Provider        string
	Model           string
	Query           string
	ProjectionMode  string
	DeadlineEpochMs int64
	Body            []byte
	Attestation     json.RawMessage
}

type Receipt struct {
	SchemaVersion         string   `json:"schemaVersion"`
	RequestID             string   `json:"requestId"`
	AttemptGroupID        string   `json:"attemptGroupId"`
	AttemptIndex          int      `json:"attemptIndex"`
	ProjectionID          string   `json:"projectionId,omitempty"`
	ReceiptID             string   `json:"receiptId"`
	Decision              string   `json:"decision"`
	ReasonCode            string   `json:"reasonCode,omitempty"`
	BaseBodySHA256        string   `json:"baseBodySha256"`
	ProjectedBodySHA256   string   `json:"projectedBodySha256,omitempty"`
	HostCompactionEpoch   any      `json:"hostCompactionEpoch"`
	ActiveEngineID        string   `json:"activeEngineId"`
	PermittedWireRewrites []string `json:"permittedWireRewrites"`
}

type Decision struct {
	Kind       string  `json:"kind"`
	BodyBase64 string  `json:"bodyBase64,omitempty"`
	Receipt    Receipt `json:"receipt"`
}

type Client struct {
	Endpoint     string
	HTTPClient   *http.Client
	MaxBodyBytes int64
}

func (c Client) Project(ctx context.Context, request Request) (Decision, error) {
	if c.Endpoint == "" {
		return Decision{}, errors.New("ACE projection endpoint is required")
	}
	maxBodyBytes := c.MaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = DefaultMaxBodyBytes
	}
	if int64(len(request.Body)) > maxBodyBytes {
		return Decision{}, fmt.Errorf("request body exceeds %d-byte bound", maxBodyBytes)
	}
	if request.RequestID == "" || request.AttemptGroupID == "" || request.AgentSessionID == "" || request.WorkspaceID == "" {
		return Decision{}, errors.New("request identity is incomplete")
	}
	if len(request.Attestation) == 0 {
		return Decision{}, errors.New("host attestation is required")
	}
	bodyDigest := sha256.Sum256(request.Body)
	payload := map[string]any{
		"schemaVersion":   SchemaVersion,
		"requestId":       request.RequestID,
		"attemptGroupId":  request.AttemptGroupID,
		"agentSessionId":  request.AgentSessionID,
		"workspaceId":     request.WorkspaceID,
		"dataClass":       request.DataClass,
		"protocol":        request.Protocol,
		"provider":        request.Provider,
		"model":           request.Model,
		"bodyBase64":      base64.StdEncoding.EncodeToString(request.Body),
		"bodySha256":      hex.EncodeToString(bodyDigest[:]),
		"query":           request.Query,
		"projectionMode":  request.ProjectionMode,
		"deadlineEpochMs": request.DeadlineEpochMs,
		"attestation":     json.RawMessage(request.Attestation),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Decision{}, fmt.Errorf("encode projection request: %w", err)
	}
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(encoded))
	if err != nil {
		return Decision{}, fmt.Errorf("create projection request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(httpRequest)
	if err != nil {
		return Decision{}, fmt.Errorf("ACE projection request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Decision{}, fmt.Errorf("ACE projection returned HTTP %d", response.StatusCode)
	}
	var decision Decision
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(&decision); err != nil {
		return Decision{}, fmt.Errorf("decode ACE projection response: %w", err)
	}
	if decision.Receipt.SchemaVersion != SchemaVersion || decision.Receipt.RequestID != request.RequestID || decision.Receipt.BaseBodySHA256 != hex.EncodeToString(bodyDigest[:]) {
		return Decision{}, errors.New("ACE projection receipt does not bind the original request")
	}
	return decision, nil
}

func Apply(requestBody []byte, decision Decision) ([]byte, error) {
	digest := sha256.Sum256(requestBody)
	if decision.Receipt.BaseBodySHA256 != hex.EncodeToString(digest[:]) {
		return nil, errors.New("projection base digest mismatch")
	}
	switch decision.Kind {
	case "UNCHANGED_AUTHORIZED":
		return append([]byte(nil), requestBody...), nil
	case "APPLY", "DEGRADED_AUTHORIZED":
		if decision.BodyBase64 == "" {
			return nil, errors.New("projection decision has no body")
		}
		body, err := base64.StdEncoding.DecodeString(decision.BodyBase64)
		if err != nil {
			return nil, fmt.Errorf("decode projected body: %w", err)
		}
		projectedDigest := sha256.Sum256(body)
		if decision.Receipt.ProjectedBodySHA256 != hex.EncodeToString(projectedDigest[:]) {
			return nil, errors.New("projection output digest mismatch")
		}
		return body, nil
	case "BLOCK":
		return nil, fmt.Errorf("ACE projection blocked: %s", decision.Receipt.ReasonCode)
	default:
		return nil, fmt.Errorf("unsupported ACE projection decision: %s", decision.Kind)
	}
}
