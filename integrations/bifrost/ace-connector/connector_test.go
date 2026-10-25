package connector

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func digest(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func TestProjectAndApplyBindOriginalAndProjectedDigests(t *testing.T) {
	original := []byte(`{"model":"test","messages":[{"role":"user","content":"question"}]}`)
	projected := []byte(`{"model":"test","messages":[{"role":"system","content":"ACE"},{"role":"user","content":"question"}]}`)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["schemaVersion"] != SchemaVersion || payload["bodySha256"] != digest(original) {
			t.Fatalf("unexpected request binding: %#v", payload)
		}
		_ = json.NewEncoder(writer).Encode(Decision{
			Kind:       "APPLY",
			BodyBase64: base64.StdEncoding.EncodeToString(projected),
			Receipt: Receipt{
				SchemaVersion: SchemaVersion, RequestID: "req-1", AttemptGroupID: "group-1", AttemptIndex: 0,
				ReceiptID: "receipt-1", Decision: "APPLY", BaseBodySHA256: digest(original),
				ProjectedBodySHA256: digest(projected), HostCompactionEpoch: 3, ActiveEngineID: "ace_context_engine",
			},
		})
	}))
	defer server.Close()

	client := Client{Endpoint: server.URL}
	decision, err := client.Project(context.Background(), Request{
		RequestID: "req-1", AttemptGroupID: "group-1", AgentSessionID: "session-1", WorkspaceID: "workspace-1",
		DataClass: "private", Protocol: "openai.chat.completions", Provider: "mock", Model: "test", Query: "question",
		ProjectionMode: "gateway", DeadlineEpochMs: 4102444800000, Body: original, Attestation: json.RawMessage(`{"hostCompactionEpoch":3}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := Apply(original, decision)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(projected) {
		t.Fatalf("unexpected projected body: %s", actual)
	}
}

func TestBlockedDecisionNeverProducesProviderBody(t *testing.T) {
	body := []byte(`{"messages":[]}`)
	_, err := Apply(body, Decision{Kind: "BLOCK", Receipt: Receipt{BaseBodySHA256: digest(body), ReasonCode: "HOST_COMPACTION_ACTIVE"}})
	if err == nil {
		t.Fatal("expected blocked decision to fail")
	}
}

func TestOversizedRequestIsRejectedBeforeHTTP(t *testing.T) {
	client := Client{Endpoint: "http://127.0.0.1:1", MaxBodyBytes: 1}
	_, err := client.Project(context.Background(), Request{
		RequestID: "req-1", AttemptGroupID: "group-1", AgentSessionID: "session-1", WorkspaceID: "workspace-1", Body: []byte("too large"),
	})
	if err == nil {
		t.Fatal("expected body bound failure")
	}
}
