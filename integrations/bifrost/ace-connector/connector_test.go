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
	_, err := Apply(body, Decision{Kind: "BLOCK", Receipt: Receipt{BaseBodySHA256: digest(body), Decision: "BLOCK", ReasonCode: "HOST_COMPACTION_ACTIVE"}})
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

func TestRejectForgedProjectionReceipts(t *testing.T) {
 original := []byte(`{"model":"test","messages":[{"role":"user","content":"question"}]}`)
 projected := []byte(`{"model":"test","messages":[{"role":"user","content":"question"},{"role":"system","content":"ACE"}]}`)
 scenarios := []struct {
  name string
  change func(*Decision)
 }{
  {"wrong attempt group", func(d *Decision) { d.Receipt.AttemptGroupID = "another-attempt" }},
  {"wrong decision kind", func(d *Decision) { d.Receipt.Decision = "UNCHANGED_AUTHORIZED" }},
  {"wrong attempt index", func(d *Decision) { d.Receipt.AttemptIndex = 1 }},
  {"wrong projected digest", func(d *Decision) { d.Receipt.ProjectedBodySHA256 = digest([]byte("wrong")) }},
  {"malformed base64", func(d *Decision) { d.BodyBase64 = "e30=" + "!" }},
 }
 for _, scenario := range scenarios {
  t.Run(scenario.name, func(t *testing.T) {
   decision := Decision{
    Kind: "APPLY",
    BodyBase64: base64.StdEncoding.EncodeToString(projected),
    Receipt: Receipt{
     SchemaVersion: SchemaVersion, RequestID: "req-1", AttemptGroupID: "group-1",
     AttemptIndex: 0, ReceiptID: "receipt-1", Decision: "APPLY",
     BaseBodySHA256: digest(original), ProjectedBodySHA256: digest(projected),
     HostCompactionEpoch: 1, ActiveEngineID: "ace_context_engine",
    },
   }
   scenario.change(&decision)
   server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
    _ = json.NewEncoder(writer).Encode(decision)
   }))
   defer server.Close()
   client := Client{Endpoint: server.URL}
   _, err := client.Project(context.Background(), Request{
    RequestID: "req-1", AttemptGroupID: "group-1", AgentSessionID: "session-1",
    WorkspaceID: "workspace-1", DataClass: "private", Protocol: "openai.chat.completions",
    Provider: "mock", Model: "test", Query: "question", ProjectionMode: "gateway",
    DeadlineEpochMs: 4102444800000, Body: original,
    Attestation: json.RawMessage(`{"hostCompactionEpoch":1}`),
   })
   if err == nil {
    t.Fatal("expected invalid projection receipt to fail closed")
   }
  })
 }
}

func TestProjectRejectsExpiredDeadline(t *testing.T) {
 client := Client{Endpoint: "http://127.0.0.1:1"}
 _, err := client.Project(context.Background(), Request{
  RequestID: "req-1", AttemptGroupID: "group-1", AgentSessionID: "session-1",
  WorkspaceID: "workspace-1", Body: []byte("{}"), DeadlineEpochMs: 1,
  Attestation: json.RawMessage(`{}`),
 })
 if err == nil {
  t.Fatal("expired deadline must be rejected before HTTP")
 }
}

func TestProjectedResponseHonorsCustomBodyBound(t *testing.T) {
 original := []byte(`{"messages":[]}`)
 projected := make([]byte, 65)
 server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
  _ = json.NewEncoder(writer).Encode(Decision{
   Kind: "APPLY", BodyBase64: base64.StdEncoding.EncodeToString(projected),
   Receipt: Receipt{
    SchemaVersion: SchemaVersion, RequestID: "req-1", AttemptGroupID: "group-1",
    AttemptIndex: 0, ReceiptID: "receipt-1", Decision: "APPLY",
    BaseBodySHA256: digest(original), ProjectedBodySHA256: digest(projected),
    HostCompactionEpoch: 1, ActiveEngineID: "ace_context_engine",
   },
  })
 }))
 defer server.Close()
 _, err := (Client{Endpoint: server.URL, MaxBodyBytes: 64}).Project(context.Background(), Request{
  RequestID: "req-1", AttemptGroupID: "group-1", AgentSessionID: "session-1",
  WorkspaceID: "workspace-1", DataClass: "private", Protocol: "openai.chat.completions",
  Provider: "mock", Model: "test", Query: "question", ProjectionMode: "gateway",
  DeadlineEpochMs: 4102444800000, Body: original,
  Attestation: json.RawMessage(`{"hostCompactionEpoch":1}`),
 })
 if err == nil { t.Fatal("projected response exceeded configured body bound") }
}
