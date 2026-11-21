//go:build bifrost_plugin

package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chris-madsen/Mult-agent-AI-Orchestration/integrations/bifrost/ace-connector"
	providerUtils "github.com/maximhq/bifrost/core/providers/utils"
	"github.com/maximhq/bifrost/core/schemas"
)

const (
	workspaceKey               schemas.BifrostContextKey = "ace.workspace_id"
	physicalRequestIDKey       schemas.BifrostContextKey = "ace.projection.physical_request_id"
	sessionCorrelationKey      schemas.BifrostContextKey = "ace.projection.session_correlation"
	physicalSendMaxHeaderBytes                           = 64 * 1024
	// Bifröst already owns this native subscription route and its OAuth bearer.
	// ACE extends the same provider pipeline; this is NOT a second LLM Gateway.
	chatGPTResponsesIngress = "/chatgpt_passthrough/backend-api/codex/responses"
	chatGPTModelsIngress    = "/chatgpt_passthrough/backend-api/codex/models"
	chatGPTResponsesPath    = "/backend-api/codex/responses"
	chatGPTProviderOrigin   = "https://chatgpt.com"
)

var projectionClient connector.Client
var defaultWorkspaceID string

type projectionBindingKey struct{}

type projectionBinding struct {
	requestID                  string
	attemptGroupID             string
	sessionID                  string
	workspaceID                string
	dataClass                  string
	provider                   string
	model                      string
	preparedBodySHA256         string
	preparedBodySemanticSHA256 string
	projectionReceipt          string
	noContextNeeded            bool
	deadlineEpochMs            int64
	ingressPath                string
}

// Injected by scripts/build-bifrost-ace-plugin.sh after verifying BOTH source trees.
// The Bifröst commit must never be duplicated as a hand-maintained source constant.
var aceSourceCommit = "unknown"
var aceBifrostCommit = "unknown"

func Init(config any) error {
	if len(aceSourceCommit) != 40 || strings.Trim(aceSourceCommit, "0123456789abcdef") != "" {
		return errors.New("ACE plugin source commit provenance is unavailable")
	}
	if len(aceBifrostCommit) != 40 || strings.Trim(aceBifrostCommit, "0123456789abcdef") != "" {
		return errors.New("ACE Bifröst source commit provenance is unavailable")
	}
	endpoint := os.Getenv("ACE_CONTEXT_RPC_URL")
	if values, ok := config.(map[string]any); ok {
		if _, deprecated := values["responses_projection_url"]; deprecated {
			return errors.New("deprecated responses_projection_url is unsupported; configure context_rpc_url for the v3 ACE context contract")
		}
		if configured, present := values["context_rpc_url"]; present {
			value, ok := configured.(string)
			if !ok || strings.TrimSpace(value) == "" {
				return errors.New("context_rpc_url must be a non-empty string")
			}
			endpoint = value
		}
	}
	if endpoint == "" {
		return errors.New("ACE_CONTEXT_RPC_URL is required")
	}
	if err := connector.ValidateContextRPCProjectEndpoint(endpoint); err != nil {
		return fmt.Errorf("invalid ACE context RPC endpoint at plugin initialization: %w", err)
	}
	token := os.Getenv("ACE_CONTEXT_RPC_TOKEN")
	if token == "" {
		return errors.New("ACE_CONTEXT_RPC_TOKEN is required")
	}
	projectionClient = connector.Client{Endpoint: endpoint, AuthToken: token, MaxBodyBytes: connector.DefaultMaxBodyBytes}
	// The Bifröst transport hook authenticates its connector, not a per-user
	// workspace principal. Permit only an explicitly isolated one-workspace
	// deployment until an authenticated tenant binding is available.
	if os.Getenv("ACE_BIFROST_TENANCY_MODE") != "single-workspace" {
		return errors.New("ACE Bifröst requires ACE_BIFROST_TENANCY_MODE=single-workspace")
	}
	defaultWorkspaceID = strings.TrimSpace(os.Getenv("ACE_BIFROST_WORKSPACE_ID"))
	if defaultWorkspaceID == "" {
		return errors.New("ACE_BIFROST_WORKSPACE_ID is required for single-workspace mode")
	}
	return nil
}

func GetName() string { return "ace-bifrost-context" }

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func newPhysicalRequestID() (string, error) {
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", fmt.Errorf("mint ACE physical request identity: %w", err)
	}
	return "ace-" + hex.EncodeToString(entropy[:]), nil
}

// sessionCorrelationFromRequest mirrors Bifröst's HTTP session-header precedence,
// but runs in HTTPTransportPreHook, before ConvertToBifrostContext has populated
// BifrostContextKeySessionID. These values are caller-asserted correlation only;
// they are never treated as authenticated identity.
func sessionCorrelationFromRequest(req *schemas.HTTPRequest) (string, bool) {
	if req == nil {
		return "", false
	}
	if raw := req.CaseInsensitiveHeaderLookup("x-bf-session-id"); strings.TrimSpace(raw) != "" {
		return schemas.NormalizeSessionID(raw)
	}
	for _, name := range schemas.HarnessSessionHeaders {
		raw := req.CaseInsensitiveHeaderLookup(name)
		if strings.TrimSpace(raw) == "" {
			continue
		}
		if sessionID, ok := schemas.NormalizeSessionID(raw); ok {
			return sessionID, true
		}
	}
	return "", false
}

// A caller-supplied workspace header cannot select another tenant; the only
// authorized workspace is the one isolated at plugin startup. This is a
// single-workspace safety boundary, NOT multi-tenant identity authentication.
func singleWorkspaceAllowed(req *schemas.HTTPRequest) bool {
	if req == nil || defaultWorkspaceID == "" {
		return false
	}
	for _, name := range []string{"x-ace-workspace-id", "x-workspace-id", "x-bf-workspace-id"} {
		if candidate := strings.TrimSpace(req.CaseInsensitiveHeaderLookup(name)); candidate != "" && candidate != defaultWorkspaceID {
			return false
		}
	}
	return true
}

func requestBoundIdentity(req *schemas.HTTPRequest, body []byte, rawModel string) (string, string, string, string, json.RawMessage, error) {
	return requestBoundIdentityForProvider(req, body, rawModel, "")
}

// The ChatGPT passthrough has an upstream-defined OpenAI provider and a *bare*
// Codex model name. It must not require a provider/model prefix or translate
// the subscription call to a different provider API.
func requestBoundIdentityForProvider(req *schemas.HTTPRequest, body []byte, rawModel string, expectedProvider schemas.ModelProvider) (string, string, string, string, json.RawMessage, error) {
	requestID, err := newPhysicalRequestID()
	if err != nil {
		return "", "", "", "", nil, err
	}
	sessionID, okSession := sessionCorrelationFromRequest(req)
	if !okSession {
		// Session headers are optional correlation, never identity/authentication.
		// Do not block a real Codex subscriber that does not emit a session header.
		// Mark it request-scoped so no durable conversation identity is invented.
		sessionID = "unattested-" + requestID
	}
	if rawModel != strings.TrimSpace(rawModel) {
		return "", "", "", "", nil, errors.New("native Responses model must not contain surrounding whitespace")
	}
	if expectedProvider == schemas.OpenAI && strings.Contains(rawModel, "/") {
		return "", "", "", "", nil, errors.New("ChatGPT subscription passthrough requires the original bare Codex model")
	}
	provider, normalizedModel := schemas.ParseModelString(rawModel, expectedProvider)
	if provider == "" || normalizedModel == "" || (expectedProvider != "" && provider != expectedProvider) {
		return "", "", "", "", nil, errors.New("ACE context extension requires an explicit Bifröst provider/model route")
	}
	if queryProvider := strings.TrimSpace(req.CaseInsensitiveQueryLookup("provider")); queryProvider != "" && !strings.EqualFold(queryProvider, string(provider)) {
		return "", "", "", "", nil, errors.New("native Responses provider query conflicts with the explicit model route")
	}
	providerIdentity := string(provider)
	// Bifröst can attest the exact HTTP request it observes, but it cannot
	// truthfully attest whether the coding agent compacted its own durable
	// transcript before sending those bytes. The ACE request ID is minted here,
	// inside the authenticated post-auth transport hook, because Bifröst's own
	// request/session context is populated only later by ConvertToBifrostContext.
	// The coding-harness session value remains correlation, not authentication.
	attestationValue := map[string]any{
		"hostBuildDigest":                    sha256Hex([]byte("ace-bifrost-plugin:" + aceSourceCommit + ":" + aceBifrostCommit)),
		"sessionId":                          sessionID,
		"activeEngineId":                     "bifrost-visible-request-only",
		"effectiveCompressionControlsDigest": sha256Hex([]byte("host-compression-controls:unattested")),
		"durableActiveTranscriptRevision":    "unattested:" + requestID,
		"durableActiveTranscriptDigest":      sha256Hex(body),
		"hostCompactionEpoch":                "unknown",
		"attestorId":                         "ace-bifrost-plugin@" + aceSourceCommit,
		"providerManagedHistoryCapability":   "unknown",
		"hostTranscriptAttested":             false,
		"compactionEnabled":                  false, // uninterpretable while hostTranscriptAttested=false; never assert host is uncompacted
	}
	attestation, err := json.Marshal(attestationValue)
	if err != nil {
		return "", "", "", "", nil, err
	}
	return requestID, sessionID, providerIdentity, normalizedModel, attestation, nil
}

func stringValue(ctx *schemas.BifrostContext, key schemas.BifrostContextKey) (string, bool) {
	value, ok := ctx.Value(key).(string)
	if !ok || value == "" {
		switch key {
		case workspaceKey:
			value = defaultWorkspaceID
		}
	}
	ok = value != ""
	return value, ok && value != ""
}

func errorResponse(status int, message string) *schemas.HTTPResponse {
	body, _ := json.Marshal(map[string]string{"error": message})
	return &schemas.HTTPResponse{StatusCode: status, Headers: map[string]string{"Content-Type": "application/json"}, Body: body}
}

// Only native Responses ingress is admitted to local projection. Every
// physical provider attempt requires a verified request-bound authorization
// guard; a PREPARED projection by itself never authorizes dispatch.
func HTTPTransportPreHook(ctx *schemas.BifrostContext, req *schemas.HTTPRequest) (*schemas.HTTPResponse, error) {
	if req == nil {
		return errorResponse(400, "Bifröst native request is missing"), nil
	}
	path := req.Path
	switch path {
	case "/v1/models", "/health", "/healthz", "/readyz", chatGPTModelsIngress:
		if req.Method != http.MethodGet && req.Method != http.MethodHead {
			return errorResponse(405, "ACE non-generation endpoint requires GET or HEAD"), nil
		}
		return nil, nil // model catalog/health: no LLM generation
	case "/v1/responses", chatGPTResponsesIngress:
		if req.Method != http.MethodPost {
			return errorResponse(405, "native Responses generation requires POST"), nil
		}
		return prepareNativeResponses(ctx, req)
	default:
		return errorResponse(404, "Bifröst native Responses route is unsupported by the ACE context extension"), nil
	}
}

// Native Responses ingress prepares local ACE context and installs a
// request-bound physical-send authorization guard. PreLLMHook denies every
// request missing that guard. Terminal transport invokes the guard on each
// serialized provider attempt; PREPARED alone is never authorization.
func prepareNativeResponses(ctx *schemas.BifrostContext, req *schemas.HTTPRequest) (*schemas.HTTPResponse, error) {
	if req == nil || len(req.Body) == 0 || len(req.Body) > int(connector.DefaultMaxBodyBytes) {
		return errorResponse(400, "native Responses body is missing or too large"), nil
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(req.Body, &body); err != nil || body == nil {
		return errorResponse(400, "native Responses body must be valid JSON"), nil
	}
	var rawModel string
	if err := json.Unmarshal(body["model"], &rawModel); err != nil || rawModel == "" {
		return errorResponse(400, "native Responses model must be explicitly specified"), nil
	}
	query, ok := nativeResponsesQuery(body["input"])
	if !ok {
		return errorResponse(422, "native Responses input contains no visible query"), nil
	}
	if defaultWorkspaceID == "" {
		return errorResponse(503, "ACE workspace identity is unavailable"), nil
	}
	if !singleWorkspaceAllowed(req) {
		return errorResponse(403, "ACE workspace binding differs from the isolated connector workspace"), nil
	}
	var expectedProvider schemas.ModelProvider
	if req.Path == chatGPTResponsesIngress {
		expectedProvider = schemas.OpenAI
	}
	requestID, session, provider, normalizedModel, attestation, err := requestBoundIdentityForProvider(req, req.Body, rawModel, expectedProvider)
	if err != nil {
		return errorResponse(409, "native Responses request identity is unavailable"), nil
	}
	// A caller's cancellation/deadline must reach the local projector.
	// Do not substitute context.Background for missing live request identity.
	if ctx == nil {
		return errorResponse(503, "native Responses request context is unavailable"), nil
	}
	normalizedModelJSON, err := json.Marshal(normalizedModel)
	if err != nil {
		return errorResponse(400, "native Responses model could not be normalized"), nil
	}
	normalizedBody, err := providerUtils.SetRawJSONField(req.Body, "model", normalizedModelJSON)
	if err != nil {
		return errorResponse(400, "native Responses model normalization failed"), nil
	}
	var requestCtx context.Context = ctx
	deadline := time.Now().Add(30 * time.Second).UnixMilli()
	decision, projected, err := projectionClient.ProjectNativeResponsesAndApply(requestCtx, connector.ResponsesV2Request{
		RequestID: requestID, AttemptGroupID: requestID, AgentSessionID: session,
		WorkspaceID: defaultWorkspaceID, DataClass: "private",
		Provider: provider, Model: normalizedModel, Query: query, DeadlineEpochMs: deadline,
		Body: normalizedBody, Attestation: attestation,
	})
	if err != nil {
		var denied *connector.ProjectionDeniedError
		if errors.As(err, &denied) {
			return errorResponse(409, denied.Error()), nil
		}
		return errorResponse(503, "native Responses ACE projection is not ready"), nil
	}
	if decision.Kind != "PREPARED" {
		return errorResponse(409, "native Responses projection is not prepared"), nil
	}
	semanticDigest, err := connector.SemanticBodySHA256(projected)
	if err != nil {
		return errorResponse(409, "native Responses projection could not be bound to provider semantics"), nil
	}
	binding := projectionBinding{
		requestID: requestID, attemptGroupID: requestID, sessionID: session,
		workspaceID: defaultWorkspaceID, dataClass: "private", provider: provider,
		model: normalizedModel, preparedBodySHA256: decision.ProjectedBodySHA256,
		preparedBodySemanticSHA256: semanticDigest, projectionReceipt: decision.ProjectionReceipt,
		noContextNeeded: decision.ReasonCode == "VERIFIED_NO_CONTEXT_NEEDED",
		deadlineEpochMs: deadline, ingressPath: req.Path,
	}
	guard := schemas.PhysicalSendGuard{
		MaxSerializedRequestBytes: int(connector.DefaultMaxBodyBytes) + physicalSendMaxHeaderBytes,
		AuthorizationDeadline:     time.UnixMilli(binding.deadlineEpochMs),
		Authorize: func(attemptCtx context.Context, attempt schemas.PhysicalSendAttempt) error {
			if attempt.Method != http.MethodPost {
				return providerUtils.NewPhysicalSendAuthorizationError(403, "ROUTE_BINDING_MISMATCH", nil)
			}
			if attempt.BodySHA256 != sha256Hex(attempt.Body) {
				return providerUtils.NewPhysicalSendAuthorizationError(403, "WIRE_BODY_DIGEST_MISMATCH", nil)
			}
			physicalDecision, authorizeErr := projectionClient.AuthorizeNativeResponsesAttempt(attemptCtx, connector.PhysicalSendV2Request{
				SchemaVersion: "ace.context.v3", RequestID: binding.requestID,
				AttemptGroupID: binding.attemptGroupID, AgentSessionID: binding.sessionID,
				WorkspaceID: binding.workspaceID, DataClass: binding.dataClass,
				Provider: string(attempt.Provider), Model: attempt.Model,
				ExpectedProvider: binding.provider, ExpectedModel: binding.model,
				AttemptID: attempt.AttemptID,
				Method:    attempt.Method, Destination: attempt.Destination, Body: attempt.Body,
				BodySHA256: attempt.BodySHA256, PreparedBodySHA256: binding.preparedBodySHA256,
				PreparedBodySemanticSHA256: binding.preparedBodySemanticSHA256,
				ProjectionReceipt:          binding.projectionReceipt, DeadlineEpochMs: binding.deadlineEpochMs,
				NoContextNeeded: binding.noContextNeeded,
			})
			if authorizeErr != nil {
				return providerUtils.NewPhysicalSendAuthorizationError(503, "AUTHORIZATION_UNAVAILABLE", authorizeErr)
			}
			if physicalDecision.Kind != "ALLOW" {
				return providerUtils.NewPhysicalSendAuthorizationError(403, physicalDecision.ReasonCode, nil)
			}
			return nil
		},
	}
	if !ctx.SetPhysicalSendGuard(guard) {
		return errorResponse(409, "native Responses physical-send guard could not be installed"), nil
	}
	ctx.SetTrustedValue(projectionBindingKey{}, binding)
	if req.Path == "/v1/responses" {
		// Native Bifröst OpenAI-compatible route uses the provider query selector.
		// The ChatGPT subscription passthrough does NOT: adding ?provider=openai
		// would leak an invented query parameter into the upstream Codex call.
		if req.Query == nil {
			req.Query = make(map[string]string)
		}
		for key := range req.Query {
			if strings.EqualFold(key, "provider") {
				delete(req.Query, key)
			}
		}
		req.Query["provider"] = provider
	}
	req.Body = projected
	return nil, nil
}

func nativeResponsesQuery(raw json.RawMessage) (string, bool) {
	var direct string
	if err := json.Unmarshal(raw, &direct); err == nil {
		return direct, strings.TrimSpace(direct) != ""
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil || len(items) == 0 {
		return "", false
	}
	for i := len(items) - 1; i >= 0; i-- {
		var kind string
		_ = json.Unmarshal(items[i]["type"], &kind)
		if kind == "function_call_output" {
			var output string
			if json.Unmarshal(items[i]["output"], &output) == nil && strings.TrimSpace(output) != "" {
				return output, true
			}
		}
		var role string
		_ = json.Unmarshal(items[i]["role"], &role)
		if role != "user" {
			continue
		}
		var content string
		if json.Unmarshal(items[i]["content"], &content) == nil && strings.TrimSpace(content) != "" {
			return content, true
		}
		var blocks []map[string]json.RawMessage
		if json.Unmarshal(items[i]["content"], &blocks) != nil {
			continue
		}
		var visible []string
		for _, block := range blocks {
			var ty, text string
			_ = json.Unmarshal(block["type"], &ty)
			_ = json.Unmarshal(block["text"], &text)
			if ty == "input_text" {
				visible = append(visible, text)
			}
		}
		if out := strings.Join(visible, "\n"); strings.TrimSpace(out) != "" {
			return out, true
		}
	}
	return "", false
}

func PreRequestHook(_ *schemas.BifrostContext, _ *schemas.BifrostRequest) error { return nil }

// Denials must use a short circuit: PreLLMHook errors alone are non-blocking
// in the pinned Bifrost plugin pipeline. Never allow an uncertified fallback.
func blockProviderAttempt(req *schemas.BifrostRequest, reason string) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	status := 409
	allowFallbacks := false
	return req, &schemas.LLMPluginShortCircuit{
		Error: &schemas.BifrostError{
			IsBifrostError: true,
			StatusCode:     &status,
			Error:          &schemas.ErrorField{Message: reason},
			AllowFallbacks: &allowFallbacks,
		},
	}, nil
}

// PreLLMHook admits only the request carrying the request-scoped physical-send
// guard. The terminal transport invokes that guard for every serialized attempt.
func PreLLMHook(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	if ctx == nil || req == nil {
		return blockProviderAttempt(req, "ACE native Responses binding is unavailable")
	}
	binding, ok := ctx.TrustedValue(projectionBindingKey{}).(projectionBinding)
	if !ok {
		return blockProviderAttempt(req, "ACE native Responses projection receipt is unavailable")
	}
	switch binding.ingressPath {
	case "/v1/responses":
		if req.ResponsesRequest == nil || req.PassthroughRequest != nil {
			return blockProviderAttempt(req, "ACE native Responses route changed after projection")
		}
	case chatGPTResponsesIngress:
		p := req.PassthroughRequest
		if req.ResponsesRequest != nil || p == nil ||
			p.Method != http.MethodPost || p.Path != chatGPTResponsesPath ||
			p.UpstreamURL != chatGPTProviderOrigin ||
			p.Provider != schemas.OpenAI || p.BaseProvider != schemas.OpenAI ||
			p.Model != binding.model {
			return blockProviderAttempt(req, "ACE ChatGPT subscription route changed after projection")
		}
	default:
		return blockProviderAttempt(req, "ACE native Responses ingress route is unsupported")
	}
	guard, ok := ctx.PhysicalSendGuard()
	if !ok || guard.Authorize == nil {
		return blockProviderAttempt(req, "ACE physical-send authorization guard is unavailable")
	}
	// Do not decide a route-changing fallback from normalized request fields here.
	// The terminal transport has the actual provider, model, destination and bytes;
	// it submits those facts to ACE, which audits the receipt-bound denial before write.
	return req, nil, nil
}

// Bifröst owns native Responses SSE parsing, terminal classification, and stream
// cancellation. ACE must preserve each typed event and upstream error unchanged.
func PostLLMHook(ctx *schemas.BifrostContext, response *schemas.BifrostResponse, bifrostErr *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	return response, bifrostErr, nil
}

func Cleanup() error { return nil }
