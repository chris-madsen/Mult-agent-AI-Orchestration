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
	"net/url"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"
)

// ResponsesV2Request represents observed, unmodified native Bifröst ingress.
// It is a local projection request, never a provider-dispatch authorization.
type ResponsesV2Request struct {
	RequestID       string
	AttemptGroupID  string
	AgentSessionID  string
	WorkspaceID     string
	DataClass       string
	Provider        string
	Model           string
	Query           string
	DeadlineEpochMs int64
	Body            []byte
	Attestation     json.RawMessage
}

type ResponsesV2Decision struct {
	Kind                string `json:"kind"`
	BodyBase64          string `json:"bodyBase64,omitempty"`
	BaseBodySHA256      string `json:"baseBodySha256"`
	ProjectedBodySHA256 string `json:"projectedBodySha256,omitempty"`
	ProjectionReceipt   string `json:"projectionReceipt,omitempty"`
	ReasonCode          string `json:"reasonCode"`
}

// ProjectionDeniedError preserves an authenticated, deterministic ACE BLOCK
// rather than treating a policy denial as retryable local transport failure.
type ProjectionDeniedError struct { ReasonCode string }

func (e *ProjectionDeniedError) Error() string {
	return "native Responses ACE projection denied: " + e.ReasonCode
}

// PhysicalSendV2Request binds one actual Bifröst transport attempt to the
// prepared native body and exact provider route. It never carries provider
// credentials or the serialized HTTP headers.
type PhysicalSendV2Request struct {
	SchemaVersion              string `json:"schemaVersion"`
	RequestID                  string `json:"requestId"`
	AttemptGroupID             string `json:"attemptGroupId"`
	AgentSessionID             string `json:"agentSessionId"`
	WorkspaceID                string `json:"workspaceId"`
	DataClass                  string `json:"dataClass"`
	Provider                   string `json:"provider"`
	Model                      string `json:"model"`
	ExpectedProvider           string `json:"-"`
	ExpectedModel              string `json:"-"`
	AttemptID                  string `json:"attemptId"`
	Method                     string `json:"method"`
	Destination                string `json:"destination"`
	Body                       []byte `json:"bodyBase64"`
	BodySHA256                 string `json:"bodySha256"`
	PreparedBodySHA256         string `json:"preparedBodySha256"`
	PreparedBodySemanticSHA256 string `json:"-"`
	ProjectionReceipt          string `json:"projectionReceipt"`
	NoContextNeeded            bool   `json:"-"` // Trusted local projection decision; never supplied by caller on the wire.
	DeadlineEpochMs            int64  `json:"deadlineEpochMs"`
}

type PhysicalSendV2Decision struct {
	Kind        string `json:"kind"`
	AttemptID   string `json:"attemptId"`
	BodySHA256  string `json:"bodySha256"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	Destination string `json:"destination"`
	ReasonCode  string `json:"reasonCode"`
}

func normalizedJSON(body []byte) (map[string]any, error) {
	if !utf8.Valid(body) {
		return nil, errors.New("native Responses body must be valid UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	var v map[string]any
	if err := d.Decode(&v); err != nil || v == nil {
		return nil, errors.New("native Responses body must be a JSON object")
	}
	var tail any
	if err := d.Decode(&tail); err != io.EOF {
		return nil, errors.New("native Responses body contains trailing data")
	}
	return v, nil
}

// Verify the exact native input-item chain and every top-level non-input
// setting (tools/reasoning/stream/store/opaque fields) survived unchanged.
func validateNativeResponsesProjection(original, projected []byte) error {
	before, err := normalizedJSON(original)
	if err != nil {
		return err
	}
	after, err := normalizedJSON(projected)
	if err != nil {
		return err
	}
	if before["store"] != false || after["store"] != false {
		return errors.New("Responses projection requires explicit store:false")
	}
	beforeInput, ok := before["input"]
	if !ok {
		return errors.New("native Responses input missing")
	}
	afterInput, ok := after["input"].([]any)
	if !ok {
		return errors.New("native Responses output must use input array")
	}
	var prior []any
	switch typed := beforeInput.(type) {
	case string:
		prior = []any{map[string]any{"role": "user", "content": typed}}
	case []any:
		prior = typed
	default:
		return errors.New("unsupported native Responses input")
	}
	if len(afterInput) != len(prior)+1 {
		return errors.New("only one developer context item may be added")
	}
	dev, ok := afterInput[0].(map[string]any)
	if !ok || len(dev) != 2 || dev["role"] != "developer" {
		return errors.New("ACE context must be an isolated developer item")
	}
	context, ok := dev["content"].(string)
	if !ok || !strings.Contains(context, "[ACE verified context]\n") ||
		!strings.HasSuffix(context, "\n[/ACE verified context]") {
		return errors.New("ACE context lacks verified evidence markers")
	}
	for i, item := range prior {
		if !reflect.DeepEqual(item, afterInput[i+1]) {
			return errors.New("projection changed protected tool/reasoning/input item")
		}
	}
	delete(before, "input")
	delete(after, "input")
	if !reflect.DeepEqual(before, after) {
		return errors.New("projection changed protected provider parameters")
	}
	return nil
}

// Decode a bounded PREPARED decision and check all original and projected
// bytes. This is not a receipt granting permission to send to a provider.
func ApplyNativeResponses(original []byte, decision ResponsesV2Decision) ([]byte, error) {
	sum := sha256.Sum256(original)
	if decision.BaseBodySHA256 != hex.EncodeToString(sum[:]) {
		return nil, errors.New("native Responses base digest mismatch")
	}
	if decision.Kind != "PREPARED" || (decision.ReasonCode != "VERIFIED_CONTEXT_ADDED" &&
		decision.ReasonCode != "VERIFIED_NO_CONTEXT_NEEDED") {
		return nil, errors.New("native Responses projection is not prepared")
	}
	if strings.TrimSpace(decision.ProjectionReceipt) == "" || len(decision.ProjectionReceipt) > 16*1024 {
		return nil, errors.New("native projection lacks a bounded physical-send receipt")
	}
	if int64(len(decision.BodyBase64)) > 4*((DefaultMaxBodyBytes+2)/3) {
		return nil, errors.New("native projected body exceeds bound")
	}
	body, err := base64.StdEncoding.DecodeString(decision.BodyBase64)
	if err != nil || int64(len(body)) > DefaultMaxBodyBytes || base64.StdEncoding.EncodeToString(body) != decision.BodyBase64 {
		return nil, errors.New("native projected body is non-canonical or oversized")
	}
	out := sha256.Sum256(body)
	if decision.ProjectedBodySHA256 != hex.EncodeToString(out[:]) {
		return nil, errors.New("native projected digest mismatch")
	}
	if decision.ReasonCode == "VERIFIED_NO_CONTEXT_NEEDED" {
		if !bytes.Equal(original, body) {
			return nil, errors.New("no-addition projection changed native body bytes")
		}
		decoded, err := normalizedJSON(body)
		if err != nil || decoded["store"] != false {
			return nil, errors.New("no-addition projection requires explicit store:false")
		}
		return body, nil
	}
	if err := validateNativeResponsesProjection(original, body); err != nil {
		return nil, err
	}
	return body, nil
}

// Keep the additive-only validator as a stable boundary for existing callers
// and tests; no-context is allowed only by the trusted projection decision.
func validatePreparedNativeResponses(projected []byte, model string) error {
	return validatePreparedNativeResponsesForDecision(projected, model, false)
}

func validatePreparedNativeResponsesForDecision(projected []byte, model string, allowNoContext bool) error {
	after, err := normalizedJSON(projected)
	if err != nil {
		return err
	}
	stream, hasStream := after["stream"]
	if after["model"] != model || after["store"] != false {
		return errors.New("physical-send body changed its model or stateless mode")
	}
	if hasStream {
		if _, ok := stream.(bool); !ok {
			return errors.New("physical-send body has an invalid native stream flag")
		}
	}
	for _, field := range []string{"previous_response_id", "conversation", "conversation_id", "thread_id"} {
		if after[field] != nil {
			return errors.New("physical-send body contains uncertified provider state")
		}
	}
	if allowNoContext {
		// The gateway's signed projection receipt and prepared-body semantic
		// digest remain mandatory even when no source evidence was needed.
		// A raw, stateless native input may be either a string or an item array.
		switch input := after["input"].(type) {
		case string:
			if strings.TrimSpace(input) == "" { return errors.New("no-context native input is blank") }
		case []any:
			if len(input) == 0 { return errors.New("no-context native item list is empty") }
		default:
			return errors.New("no-context native input is not supported")
		}
		return nil
	}
	items, ok := after["input"].([]any)
	if !ok || len(items) < 2 {
		return errors.New("physical-send body lacks its additive ACE context item")
	}
	aceItems := 0
	for _, item := range items {
		message, ok := item.(map[string]any)
		if !ok || message["role"] != "developer" {
			continue
		}
		content, _ := message["content"].(string)
		if strings.Contains(content, "[ACE verified context]\n") && strings.Contains(content, "\n[/ACE verified context]") {
			aceItems++
		}
	}
	if aceItems != 1 {
		return errors.New("physical-send body must contain exactly one ACE evidence item")
	}
	original := make(map[string]any, len(after))
	for key, value := range after {
		original[key] = value
	}
	originalItems := make([]any, len(items)-1)
	copy(originalItems, items[1:])
	original["input"] = originalItems
	originalBytes, err := json.Marshal(original)
	if err != nil {
		return errors.New("physical-send body could not be validated")
	}
	return validateNativeResponsesProjection(originalBytes, projected)
}

// SemanticBodySHA256 hashes the provider request's parsed JSON value. Object
// key order and whitespace are ignored; arrays and exact JSON number lexemes
// remain significant. It is used only to compare Bifröst's prepared and wire
// representations; the physical-send receipt still binds the final raw bytes.
func SemanticBodySHA256(body []byte) (string, error) {
	value, err := normalizedJSON(body)
	if err != nil {
		return "", err
	}
	if _, exists := value["stream"]; !exists {
		// In native Responses, an omitted stream flag and explicit false both
		// select the non-streaming request path. No other provider field is
		// normalized here.
		value["stream"] = false
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", errors.New("provider request could not be canonicalized")
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

// ProjectNativeResponsesAndApply validates the exact projected bytes once;
// its caller must still install a per-physical-attempt guard before sending.
func (c Client) ProjectNativeResponsesAndApply(ctx context.Context, req ResponsesV2Request) (ResponsesV2Decision, []byte, error) {
	invalid := ResponsesV2Decision{}
	if c.Endpoint == "" || c.AuthToken == "" {
		return invalid, nil, errors.New("local native Responses projector is not configured")
	}
	if err := ValidateContextRPCProjectEndpoint(c.Endpoint); err != nil {
		return invalid, nil, err
	}
	maxBody := c.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = DefaultMaxBodyBytes
	}
	if len(req.Body) == 0 || int64(len(req.Body)) > maxBody ||
		req.AgentSessionID == "" || req.WorkspaceID == "" || req.RequestID == "" ||
		req.AttemptGroupID == "" || req.Provider == "" || req.Model == "" || req.Query == "" {
		return invalid, nil, errors.New("invalid native Responses projection identity or bounds")
	}
	if req.DeadlineEpochMs <= time.Now().UnixMilli() {
		return invalid, nil, errors.New("native projection deadline elapsed")
	}
	if _, err := normalizedJSON(req.Body); err != nil {
		return invalid, nil, err
	}
	var attestation map[string]json.RawMessage
	if err := json.Unmarshal(req.Attestation, &attestation); err != nil || attestation == nil {
		return invalid, nil, errors.New("native attestation is missing")
	}
	if _, _, err := requiredAttestationBinding(attestation); err != nil {
		return invalid, nil, err
	}
	sum := sha256.Sum256(req.Body)
	envelope := map[string]any{
		"schemaVersion": "ace.context.v3", "protocol": "openai.responses",
		"requestId": req.RequestID, "attemptGroupId": req.AttemptGroupID,
		"agentSessionId": req.AgentSessionID, "workspaceId": req.WorkspaceID,
		"dataClass": req.DataClass, "provider": req.Provider, "model": req.Model,
		"bodyBase64": base64.StdEncoding.EncodeToString(req.Body),
		"bodySha256": hex.EncodeToString(sum[:]), "query": req.Query,
		"projectionMode": "bifrost_hook", "deadlineEpochMs": req.DeadlineEpochMs,
		"attestation": req.Attestation,
	}
	wire, err := json.Marshal(envelope)
	if err != nil {
		return invalid, nil, err
	}
	if int64(len(wire)) > maxEnvelopeBytes(maxBody) {
		return invalid, nil, errors.New("native projection envelope exceeds bound")
	}
	deadline := time.Now().Add(30 * time.Second)
	if d := time.UnixMilli(req.DeadlineEpochMs); d.Before(deadline) {
		deadline = d
	}
	bounded, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	safe := loopbackHTTPClient(c.HTTPClient)
	httpReq, err := http.NewRequestWithContext(bounded, http.MethodPost, c.Endpoint, bytes.NewReader(wire))
	if err != nil {
		return invalid, nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.AuthToken)
	response, err := safe.Do(httpReq)
	if err != nil {
		return invalid, nil, fmt.Errorf("native Responses projector unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return invalid, nil, fmt.Errorf("native Responses projector denied with HTTP %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxEnvelopeBytes(maxBody)+1))
	if err != nil || int64(len(payload)) > maxEnvelopeBytes(maxBody) {
		return invalid, nil, errors.New("native Responses projector response exceeds limit")
	}
	d := json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	var decision ResponsesV2Decision
	if err := d.Decode(&decision); err != nil {
		return invalid, nil, err
	}
	var trailing any
	if err := d.Decode(&trailing); err != io.EOF {
		return invalid, nil, errors.New("native projection has trailing data")
	}
	if decision.Kind == "BLOCK" {
		if decision.BaseBodySHA256 != hex.EncodeToString(sum[:]) {
			return invalid, nil, errors.New("native Responses BLOCK digest mismatch")
		}
		if strings.TrimSpace(decision.ReasonCode) == "" || len(decision.ReasonCode) > 256 {
			return invalid, nil, errors.New("native Responses BLOCK is missing a bounded reason")
		}
		return invalid, nil, &ProjectionDeniedError{ReasonCode: decision.ReasonCode}
	}
	projected, err := ApplyNativeResponses(req.Body, decision)
	if err != nil { return invalid, nil, err }
	return decision, projected, nil
}

// ProjectNativeResponses preserves the existing decision-only API for clients
// that do not need the validated body. The Bifröst hook consumes the single
// validated output from ProjectNativeResponsesAndApply.
func (c Client) ProjectNativeResponses(ctx context.Context, req ResponsesV2Request) (ResponsesV2Decision, error) {
	decision, _, err := c.ProjectNativeResponsesAndApply(ctx, req)
	return decision, err
}

func (c Client) AuthorizeNativeResponsesAttempt(ctx context.Context, req PhysicalSendV2Request) (PhysicalSendV2Decision, error) {
	invalid := PhysicalSendV2Decision{}
	if c.Endpoint == "" || c.AuthToken == "" {
		return invalid, errors.New("local physical-send authorizer is not configured")
	}
	if err := ValidateContextRPCProjectEndpoint(c.Endpoint); err != nil {
		return invalid, err
	}
	target, err := url.Parse(c.Endpoint)
	if err != nil {
		return invalid, errors.New("ACE context RPC URL parsing failed")
	}
	target.Path = "/internal/ace-context/v3/authorize-attempt"
	target.RawPath = ""
	maxBody := c.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = DefaultMaxBodyBytes
	}
	if req.SchemaVersion != "ace.context.v3" || req.RequestID == "" || req.AttemptGroupID != req.RequestID ||
		req.AgentSessionID == "" || req.WorkspaceID == "" || req.Provider == "" || req.Model == "" ||
		req.Method != http.MethodPost || req.AttemptID == "" || req.ProjectionReceipt == "" ||
		len(req.PreparedBodySHA256) != 64 || len(req.PreparedBodySemanticSHA256) != 64 ||
		req.DeadlineEpochMs <= time.Now().UnixMilli() || len(req.Body) == 0 || int64(len(req.Body)) > maxBody {
		return invalid, errors.New("invalid physical-send attempt identity or bounds")
	}
	if err := validatePhysicalSendDestination(req.Destination); err != nil {
		return invalid, err
	}
	expectedProvider := req.ExpectedProvider
	if expectedProvider == "" {
		expectedProvider = req.Provider
	}
	expectedModel := req.ExpectedModel
	if expectedModel == "" {
		expectedModel = req.Model
	}
	routeChanged := expectedProvider != req.Provider || expectedModel != req.Model
	sum := sha256.Sum256(req.Body)
	if req.BodySHA256 != hex.EncodeToString(sum[:]) {
		return invalid, errors.New("physical-send attempt body digest mismatch")
	}
	// A changed provider/model still must carry a valid stateless native
	// Responses body. Only the prepared-body semantic equality is inapplicable
	// to a changed route (which is separately denied and audited). Never send
	// arbitrary JSON, store:true or a mismatched body model for that audit.
	body, err := normalizedJSON(req.Body)
	if err != nil || body["store"] != false || body["model"] != req.Model {
		return invalid, errors.New("physical-send attempt body is not the authorized stateless Responses body")
	}
	if !routeChanged {
		if err := validatePreparedNativeResponsesForDecision(req.Body, req.Model, req.NoContextNeeded); err != nil {
			return invalid, fmt.Errorf("physical-send body validation failed: %w", err)
		}
		semanticDigest, err := SemanticBodySHA256(req.Body)
		if err != nil || semanticDigest != req.PreparedBodySemanticSHA256 {
			return invalid, errors.New("provider wire body differs from ACE-prepared semantics")
		}
	}
	wire, err := json.Marshal(req)
	if err != nil {
		return invalid, err
	}
	if int64(len(wire)) > maxEnvelopeBytes(maxBody) {
		return invalid, errors.New("physical-send authorization envelope exceeds bound")
	}
	deadline := time.Now().Add(30 * time.Second)
	if d := time.UnixMilli(req.DeadlineEpochMs); d.Before(deadline) {
		deadline = d
	}
	bounded, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	safe := loopbackHTTPClient(c.HTTPClient)
	httpReq, err := http.NewRequestWithContext(bounded, http.MethodPost, target.String(), bytes.NewReader(wire))
	if err != nil {
		return invalid, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.AuthToken)
	response, err := safe.Do(httpReq)
	if err != nil {
		return invalid, fmt.Errorf("physical-send authorizer unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return invalid, fmt.Errorf("physical-send authorizer returned HTTP %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(payload) > 64*1024 {
		return invalid, errors.New("physical-send decision exceeds limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var decision PhysicalSendV2Decision
	if err := decoder.Decode(&decision); err != nil {
		return invalid, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return invalid, errors.New("physical-send decision contains trailing data")
	}
	if decision.AttemptID != req.AttemptID || decision.BodySHA256 != req.BodySHA256 {
		return invalid, errors.New("physical-send decision is not bound to this attempt")
	}
	switch decision.Kind {
	case "BLOCK":
		if strings.TrimSpace(decision.ReasonCode) == "" {
			return invalid, errors.New("physical-send denial has no reason code")
		}
		return decision, nil
	case "ALLOW":
		if routeChanged {
			return invalid, errors.New("authorizer allowed a provider/model change bound to another projection receipt")
		}
		if decision.ReasonCode != "AUTHORIZED" || decision.Provider != req.Provider ||
			decision.Model != req.Model || decision.Destination != req.Destination {
			return invalid, errors.New("physical-send allow decision does not match the authorized route")
		}
		return decision, nil
	default:
		return invalid, errors.New("physical-send decision kind is unsupported")
	}
}

func validatePhysicalSendDestination(destination string) error {
	parsed, err := url.Parse(destination)
	if err != nil || parsed == nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path == "" || parsed.String() != destination {
		return errors.New("physical-send destination is not a canonical credential-free HTTPS URL")
	}
	return nil
}
