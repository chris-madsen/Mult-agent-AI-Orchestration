package connector

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const DefaultMaxBodyBytes int64 = 4 * 1024 * 1024
const maxEnvelopeOverhead int64 = 64 * 1024

func maxEnvelopeBytes(bodyBytes int64) int64 {
	return 4*((bodyBytes+2)/3) + bodyBytes + maxEnvelopeOverhead
}

func normalizeHostCompactionEpoch(raw json.RawMessage) (string, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", errors.New("hostCompactionEpoch must be a non-negative safe integer or unknown")
	}
	switch epoch := value.(type) {
	case string:
		if epoch == "unknown" {
			return epoch, nil
		}
	case float64:
		if epoch >= 0 && epoch <= 9007199254740991 && math.Trunc(epoch) == epoch {
			return strconv.FormatFloat(epoch, 'f', -1, 64), nil
		}
	}
	return "", errors.New("hostCompactionEpoch must be a non-negative safe integer or unknown")
}

func requiredAttestationBinding(attestation map[string]json.RawMessage) (string, string, error) {
	epoch, err := normalizeHostCompactionEpoch(attestation["hostCompactionEpoch"])
	if err != nil {
		return "", "", fmt.Errorf("invalid host attestation epoch: %w", err)
	}
	var activeEngineID string
	if err := json.Unmarshal(attestation["activeEngineId"], &activeEngineID); err != nil || activeEngineID == "" {
		return "", "", errors.New("host attestation activeEngineId must be a non-empty string")
	}
	return epoch, activeEngineID, nil
}

type Client struct {
	Endpoint     string
	AuthToken    string
	HTTPClient   *http.Client
	MaxBodyBytes int64
}

func validateLoopbackEndpoint(endpoint string) error {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Opaque != "" || parsed.Host == "" || parsed.User != nil {
		return errors.New("ACE projection endpoint must be a loopback HTTP(S) URL")
	}
	if scheme := strings.ToLower(parsed.Scheme); scheme != "http" && scheme != "https" {
		return errors.New("ACE projection endpoint must be a loopback HTTP(S) URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" {
		return nil
	}
	address := net.ParseIP(host)
	if address == nil || !address.IsLoopback() {
		return errors.New("ACE projection endpoint must be a loopback HTTP(S) URL")
	}
	return nil
}


// ValidateContextRPCProjectEndpoint rejects unsupported versions, aliased
// paths and remote endpoints before a Bifröst plugin is registered. Do not
// discover an incompatible ACE sidecar only after the first agent request.
func ValidateContextRPCProjectEndpoint(endpoint string) error {
	if err := validateLoopbackEndpoint(endpoint); err != nil {
		return err
	}
	target, err := url.Parse(endpoint)
	if err != nil || target.Path != "/internal/ace-context/v3/project" ||
		target.RawPath != "" || target.RawQuery != "" || target.ForceQuery || target.Fragment != "" || target.RawFragment != "" {
		return errors.New("ACE context RPC requires the exact loopback /internal/ace-context/v3/project URL")
	}
	return nil
}

func loopbackHTTPClient(client *http.Client) *http.Client {
	if client == nil {
		client = http.DefaultClient
	}
	safe := *client
	transport := safe.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	if direct, ok := transport.(*http.Transport); ok {
		clone := direct.Clone()
		clone.Proxy = nil
		safe.Transport = clone
	}
	safe.CheckRedirect = func(*http.Request, []*http.Request) error {
		return errors.New("ACE loopback transport redirect refused")
	}
	return &safe
}
