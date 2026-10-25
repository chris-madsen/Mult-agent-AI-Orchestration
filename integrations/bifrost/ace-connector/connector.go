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
	"time"
)

const SchemaVersion = "ace.gateway.v1"
const DefaultMaxBodyBytes int64 = 4 * 1024 * 1024
const maxEnvelopeOverhead int64 = 64 * 1024

func maxEnvelopeBytes(bodyBytes int64) int64 {
	return 4*((bodyBytes+2)/3) + maxEnvelopeOverhead
}

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
	var attestation map[string]json.RawMessage
	if err := json.Unmarshal(request.Attestation, &attestation); err != nil || attestation == nil {
		return Decision{}, errors.New("host attestation must be a JSON object")
	}
	if request.DeadlineEpochMs <= time.Now().UnixMilli() {
		return Decision{}, errors.New("ACE projection deadline has expired")
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
	if int64(len(encoded)) > maxEnvelopeBytes(maxBodyBytes) {
		return Decision{}, errors.New("ACE projection request envelope exceeds bound")
	}
	deadline := time.Now().Add(30 * time.Second)
	if requested := time.UnixMilli(request.DeadlineEpochMs); requested.Before(deadline) {
		deadline = requested
	}
	boundedCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	httpRequest, err := http.NewRequestWithContext(boundedCtx, http.MethodPost, c.Endpoint, bytes.NewReader(encoded))
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
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxEnvelopeBytes(maxBodyBytes)+1))
	var decision Decision
	if err := decoder.Decode(&decision); err != nil {
		return Decision{}, fmt.Errorf("decode ACE projection response: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Decision{}, errors.New("ACE projection response contains trailing data or exceeds the bound")
	}
	if decision.Receipt.SchemaVersion != SchemaVersion ||
		decision.Receipt.RequestID != request.RequestID ||
		decision.Receipt.AttemptGroupID != request.AttemptGroupID ||
		decision.Receipt.AttemptIndex != 0 ||
		decision.Receipt.ReceiptID == "" ||
		decision.Receipt.ActiveEngineID == "" ||
		decision.Receipt.BaseBodySHA256 != hex.EncodeToString(bodyDigest[:]) ||
		decision.Receipt.Decision != decision.Kind {
		return Decision{}, errors.New("ACE projection receipt does not bind the original attempt and decision")
	}
	if int64(len(decision.BodyBase64)) > 4*((maxBodyBytes+2)/3) {
		return Decision{}, errors.New("ACE projected response body exceeds bound")
	}
	if decision.Kind == "APPLY" || decision.Kind == "DEGRADED_AUTHORIZED" {
		decoded, err := base64.StdEncoding.DecodeString(decision.BodyBase64)
		if err != nil || int64(len(decoded)) > maxBodyBytes {
			return Decision{}, errors.New("ACE projected body is invalid or exceeds configured bound")
		}
	}
	if decision.Kind == "BLOCK" && decision.BodyBase64 != "" {
		return Decision{}, errors.New("blocked decision must not include a provider body")
	}
	if _, err := Apply(request.Body, decision); err != nil && decision.Kind != "BLOCK" {
		return Decision{}, fmt.Errorf("invalid ACE projection decision: %w", err)
	}
	return decision, nil
}

func Apply(requestBody []byte, decision Decision) ([]byte, error) {
	digest := sha256.Sum256(requestBody)
	if decision.Receipt.BaseBodySHA256 != hex.EncodeToString(digest[:]) {
		return nil, errors.New("projection base digest mismatch")
	}
	if decision.Receipt.Decision != decision.Kind {
		return nil, errors.New("projection receipt decision mismatch")
	}
	switch decision.Kind {
	case "UNCHANGED_AUTHORIZED":
		if decision.BodyBase64 != "" {
			return nil, errors.New("unchanged decision must not include a projected body")
		}
		return append([]byte(nil), requestBody...), nil
	case "APPLY", "DEGRADED_AUTHORIZED":
		if decision.BodyBase64 == "" {
			return nil, errors.New("projection decision has no body")
		}
		body, err := base64.StdEncoding.DecodeString(decision.BodyBase64)
		if err != nil {
			return nil, fmt.Errorf("decode projected body: %w", err)
		}
		if len(body) > int(DefaultMaxBodyBytes) || base64.StdEncoding.EncodeToString(body) != decision.BodyBase64 {
			return nil, errors.New("projected body exceeds bound or is not canonical Base64")
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
