# DoT (DNS-over-TLS) Architecture Design

**Version**: 1.0
**Status**: Proposed
**Last Updated**: 2026-02-20

## Overview

Ent-DNS implements RFC 7858 DNS-over-TLS with optional mutual TLS (mTLS) authentication. The DoT service provides encrypted DNS resolution over TCP with TLS 1.3, suitable for enterprise deployments requiring certificate-based client authentication.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Ent-DNS Server                           │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │   DoT Listener   │    │   TLS Acceptor   │                  │
│  │  (TCP 853)       │    │  (rustls)        │                  │
│  └────────┬─────────┘    └────────┬─────────┘                  │
│           │                       │                             │
│           │ TCP Connection        │ TLS Handshake               │
│           │                       │                             │
│           ▼                       ▼                             │
│  ┌─────────────────────────────────────────────────────┐      │
│  │              TLS Stream (Encrypted)                   │      │
│  │  ┌──────────────────────────────────────────────┐   │      │
│  │  │  1. Validate Client Cert (if mTLS)           │   │      │
│  │  │  2. Extract SAN (Subject Alternative Name)   │   │      │
│  │  │  3. Extract Client IP from TCP peer         │   │      │
│  │  └──────────────────────────────────────────────┘   │      │
│  └─────────────────────────────────────────────────────┘      │
│                              │                                    │
│                              │ DNS Query (2-byte length prefix)  │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────┐      │
│  │              DnsHandler (Shared)                    │      │
│  │  - Filter Engine (rules/rewrites/ACL)              │      │
│  │  - Cache (TTL-based)                                │      │
│  │  - Resolver (upstream DoH/UDP/TCP)                   │      │
│  │  - Metrics (QPS, latency, block rate)              │      │
│  └─────────────────────────────────────────────────────┘      │
│                              │                                    │
│                              │ DNS Response (wire format)        │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────┐      │
│  │              TLS Stream (Encrypted)                   │      │
│  │  - Add 2-byte length prefix                          │      │
│  │  - Send binary response                              │      │
│  └─────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Transport Layer

### Connection Flow

```
Client                    Ent-DNS Server
  │                             │
  │  TCP SYN                    │
  ├────────────────────────────>│
  │  TCP SYN+ACK                │
  │<────────────────────────────┤
  │  TCP ACK                    │
  ├────────────────────────────>│
  │  TLS ClientHello           │
  ├────────────────────────────>│
  │  TLS ServerHello + Cert    │
  │<────────────────────────────┤
  │  TLS Certificate (if mTLS) │
  ├────────────────────────────>│
  │  TLS Finished              │
  │<────────────────────────────┤
  │  DNS Query (len + wire)    │
  ├────────────────────────────>│
  │  DNS Response (len + wire)  │
  │<────────────────────────────┤
  │  TLS Close                 │
  ├────────────────────────────>│
  │  TCP FIN                   │
  │<────────────────────────────┤
```

### Message Format

**DNS Query (RFC 7858 Section 3.3)**:
```
+----------------+----------------+
|    Length      |  DNS Message   |
|   (2 bytes)    |  (variable)    |
+----------------+----------------+
```

- **Length**: Big-endian 16-bit unsigned integer (0-65535)
- **DNS Message**: Standard DNS wire format (RFC 1035)

**Example**:
```
Length: 0x002E (46 bytes)
DNS Message: 0x00 0x00 0x01 0x00 ... (46 bytes)
```

### Connection Reuse

**Idle Timeout**: 60 seconds (configurable via `ENT_DNS__DNS__DOT_IDLE_TIMEOUT`)

**Keep-Alive**: Default (client-side should reuse connection)

**Maximum Queries per Connection**: No limit (subject to connection timeout)

## Authentication Modes

### Mode 1: Anonymous DoT (Default)

**Description**: TLS encryption only, no client authentication.

**Configuration**:
```bash
ENT_DNS__DNS__DOT_ENABLED=true
ENT_DNS__DNS__DOT_CERT_PATH=/path/to/server.crt
ENT_DNS__DNS__DOT_KEY_PATH=/path/to/server.key
ENT_DNS__DNS__DOT_REQUIRE_CLIENT_CERT=false
```

**Flow**:
1. Client connects to TCP 853
2. Server presents server certificate
3. TLS handshake completes (server auth only)
4. DNS queries exchanged
5. Client IP extracted from TCP peer address

**Use Case**: Public DoH/DoT service (e.g., Cloudflare, Quad9)

---

### Mode 2: Mutual TLS (mTLS)

**Description**: TLS encryption + client certificate authentication.

**Configuration**:
```bash
ENT_DNS__DNS__DOT_ENABLED=true
ENT_DNS__DNS__DOT_CERT_PATH=/path/to/server.crt
ENT_DNS__DNS__DOT_KEY_PATH=/path/to/server.key
ENT_DNS__DNS__DOT_REQUIRE_CLIENT_CERT=true
ENT_DNS__DNS__DOT_CA_PATH=/path/to/ca.crt  # Client CA certificate
```

**Flow**:
1. Client connects to TCP 853
2. Server presents server certificate
3. Client presents client certificate
4. Server validates client certificate against CA
5. TLS handshake completes (mutual auth)
6. Client SAN (Subject Alternative Name) extracted
7. DNS queries exchanged (client IP = SAN or TCP peer)

**Use Case**: Enterprise internal DoT service with ACL control

---

## Client Certificate Validation

### Certificate Requirements

**Server Certificate**:
- X.509 v3
- TLS server authentication (EKU: `id-kp-serverAuth`)
- Subject CN or SAN matches hostname (optional for IP-based)
- Valid certificate chain (intermediate + root CA)

**Client Certificate** (mTLS):
- X.509 v3
- TLS client authentication (EKU: `id-kp-clientAuth`)
- SAN (Subject Alternative Name) for ACL matching
- Valid certificate chain (signed by trusted CA)

### SAN Extraction

**Supported SAN Types**:
1. **DNS Name**: `client1.internal.example.com`
2. **IP Address**: `192.168.1.10`
3. **Email Address**: `user1@example.com`
4. **URI**: `spiffe://example.com/ns/default/sa/client1`

**SAN Priority**:
1. SAN (IP Address) → Extract as IPv4/IPv6 string
2. SAN (DNS Name) → Extract as hostname string
3. SAN (Email) → Extract as email string
4. Subject CN → Extract as fallback identifier
5. TCP Peer IP → Extract as last resort

**ACL Matching**:
```sql
-- Example client configuration
INSERT INTO clients (identifiers, filter_enabled, upstreams)
VALUES (
  '["client1.internal.example.com", "192.168.1.10"]',
  1,
  '["https://1.1.1.1/dns-query"]'
);

-- If client cert SAN = "client1.internal.example.com"
-- or SAN = "192.168.1.10"
-- Then use this client configuration
```

### Certificate Revocation

**Current Implementation**: No CRL/OCSP (future enhancement)

**Workaround**: Remove client certificate from CA trust store and restart server

**Future**: CRL (Certificate Revocation List) or OCSP stapling

## TLS Configuration

### Protocol & Cipher Suites

**Protocol**: TLS 1.3 only (no fallback to TLS 1.2)

**Cipher Suites** (rustls defaults):
- TLS_AES_256_GCM_SHA384
- TLS_CHACHA20_POLY1305_SHA256
- TLS_AES_128_GCM_SHA256

**Key Exchange**: ECDHE (Elliptic Curve Diffie-Hellman)

**Signature Algorithms**:
- ECDSA P-256 + SHA256
- ECDSA P-384 + SHA384
- RSA-PSS + SHA256

### Session Resumption

**TLS Session Tickets**: Enabled (future enhancement)

**Session Timeout**: 3600 seconds (1 hour)

**Benefit**: Reduces handshake latency from ~15ms to ~2ms

**Configuration**:
```bash
ENT_DNS__DNS__DOT_SESSION_TICKET_ENABLED=true
ENT_DNS__DNS__DOT_SESSION_TIMEOUT=3600
```

## Error Handling

### TLS Handshake Errors

| Error | Description | Client Action |
|-------|-------------|---------------|
| `alert_certificate_unknown` | Client cert not trusted by CA | Provide valid client cert |
| `alert_bad_certificate` | Client cert malformed or expired | Renew client cert |
| `alert_no_application_protocol` | ALPN mismatch (future) | Ensure ALPN support |
| `alert_handshake_failure` | General handshake error | Check TLS config |

### DNS Protocol Errors

| Error | RFC 7858 Section | Client Action |
|-------|------------------|---------------|
| Invalid length prefix | 3.3 | Retry with correct format |
| Malformed DNS message | 3.4 | Fix DNS query structure |
| SERVFAIL | RFC 1035 | Check upstream DNS |
| NXDOMAIN | RFC 1035 | Domain does not exist |

## Metrics & Monitoring

### DoT Metrics

**Counters**:
```
ent_dns_dot_queries_total - Total DoT queries
ent_dns_dot_handshake_errors_total - TLS handshake errors
ent_dns_dot_connections_total - Total TLS connections
ent_dns_dot_connections_active - Current active connections
```

**Histograms**:
```
ent_dns_dot_handshake_duration_seconds - TLS handshake duration
ent_dns_dot_query_latency_seconds - DNS query latency (P50/P95/P99)
```

### Prometheus Queries

**TLS Handshake Error Rate**:
```promql
rate(ent_dns_dot_handshake_errors_total[5m]) / rate(ent_dns_dot_connections_total[5m])
```

**DoT QPS**:
```promql
rate(ent_dns_dot_queries_total[1m])
```

**Active Connections**:
```promql
ent_dns_dot_connections_active
```

**Handshake Latency P95**:
```promql
histogram_quantile(0.95, ent_dns_dot_handshake_duration_seconds_bucket)
```

## Security Considerations

### Certificate Management

**Server Certificate**:
- Rotate every 90 days (Let's Encrypt or internal CA)
- Auto-reload without restart (future enhancement)
- Backup old certificate for rollback

**Client Certificate** (mTLS):
- Issue with limited validity (e.g., 30 days)
- Revoke if compromised
- Store securely (e.g., PKCS#12 with passphrase)

### CA Trust Store

**Root CA**:
- Private PKI: Self-signed root CA
- Public PKI: DigiCert, Let's Encrypt (for mTLS)

**Intermediate CA**:
- Separate root and intermediate (best practice)
- Rotate intermediate certificates independently

### Denial of Service Protection

**Rate Limiting**: Per-IP connection rate limit (future enhancement)

**Connection Timeout**: 10 seconds (TLS handshake timeout)

**Max Connections**: 10,000 concurrent connections (configurable)

### Certificate Pinning (Optional)

**Client-Side**: Pin server certificate hash
**Server-Side**: Pin client certificate hash (mTLS)

**Benefit**: Prevent MITM attacks

## Implementation Details

### Rust Modules

```rust
// src/tls/mod.rs
pub fn load_server_config(
    cert_path: &str,
    key_path: &str,
    ca_path: Option<&str>,
) -> Result<ServerConfig>

pub struct ClientInfo {
    pub san: Option<String>,
    pub subject_cn: Option<String>,
    pub peer_ip: IpAddr,
}

// src/dns/dot.rs
pub async fn run_dot_listener(
    handler: Arc<DnsHandler>,
    tls_config: ServerConfig,
    bind_addr: String,
) -> Result<()>

async fn handle_dot_connection(
    mut stream: TlsStream<TcpStream>,
    handler: Arc<DnsHandler>,
    client_info: ClientInfo,
) -> Result<()>
```

### Key Algorithms

**Length Prefix Encoding**:
```rust
fn encode_with_prefix(message: &[u8]) -> Vec<u8> {
    let len = (message.len() as u16).to_be_bytes();
    [len.as_slice(), message].concat()
}

fn decode_with_prefix(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < 2 {
        return Err(anyhow!("Insufficient data for length prefix"));
    }
    let len = u16::from_be_bytes([data[0], data[1]]) as usize;
    if len > 65535 || data.len() < 2 + len {
        return Err(anyhow!("Invalid length prefix or truncated message"));
    }
    Ok(data[2..2+len].to_vec())
}
```

**SAN Extraction**:
```rust
fn extract_san(cert: &Certificate) -> Option<String> {
    use x509_parser::extensions::GeneralName;

    // Parse certificate extensions
    let (_, parsed) = X509Certificate::from_der(&cert.0).ok()?;
    let extension = parsed.extensions()?
        .iter()
        .find(|ext| ext.oid == OID_SUBJECT_ALT_NAME)?;

    // Parse SAN
    let sans = extension.value.general_names()?;
    for san in sans {
        match san {
            GeneralName::DNSName(dns) => return Some(dns.to_string()),
            GeneralName::IPAddress(ip) => return Some(format!("{}", ip)),
            GeneralName::RFC822Name(email) => return Some(email.to_string()),
            _ => {}
        }
    }

    // Fallback to Subject CN
    parsed.subject().iter_common_name()
        .next()
        .map(|cn| cn.as_str().to_string())
}
```

## Configuration Schema

### Environment Variables

```bash
# Enable/Disable DoT
ENT_DNS__DNS__DOT_ENABLED=false

# DoT Bind Address
ENT_DNS__DNS__DOT_BIND=0.0.0.0
ENT_DNS__DNS__DOT_PORT=853

# Server Certificate
ENT_DNS__DNS__DOT_CERT_PATH=/path/to/server.crt
ENT_DNS__DNS__DOT_KEY_PATH=/path/to/server.key

# Client CA (mTLS)
ENT_DNS__DNS__DOT_REQUIRE_CLIENT_CERT=false
ENT_DNS__DNS__DOT_CA_PATH=/path/to/ca.crt

# Connection Timeout
ENT_DNS__DNS__DOT_IDLE_TIMEOUT=60

# Session Resumption
ENT_DNS__DNS__DOT_SESSION_TICKET_ENABLED=true
ENT_DNS__DNS__DOT_SESSION_TIMEOUT=3600
```

### Example `config.toml`

```toml
[dns]
# ...existing config...

# DoT settings
doh_enabled = false
dot_enabled = true
dot_bind = "0.0.0.0"
dot_port = 853
dot_cert_path = "/etc/ent-dns/certs/server.crt"
dot_key_path = "/etc/ent-dns/certs/server.key"
dot_require_client_cert = true
dot_ca_path = "/etc/ent-dns/certs/ca.crt"
```

## Client Configuration Examples

### kdig (Knot DNS)
```bash
# Anonymous DoT
kdig @192.168.1.100 -p 853 +tls example.com A

# mTLS with client certificate
kdig @192.168.1.100 -p 853 \
  +tls \
  +tls-ca=/etc/ssl/certs/ca.crt \
  +tls-cert=/etc/ssl/certs/client.crt \
  +tls-key=/etc/ssl/certs/client.key \
  example.com A
```

### dig (BIND 9.18+)
```bash
# DoT with server authentication
dig @192.168.1.100 -p 853 \
  +tls \
  +tls-cafile=/etc/ssl/certs/ca.crt \
  example.com A
```

### systemd-resolved
```bash
# Configure DoT
sudo mkdir -p /etc/systemd/resolved.conf.d
sudo tee /etc/systemd/resolved.conf.d/dot.conf > /dev/null <<EOF
[Resolve]
DNS=192.168.1.100
DNSOverTLS=yes
FallbackDNS=1.1.1.1
EOF

sudo systemctl restart systemd-resolved
```

### Unbound
```bash
# Configure DoT forwarder
forward-zone:
  name: "."
  forward-tls-upstream: 192.168.1.100@853
  forward-tls-cert-bundle: /etc/ssl/certs/ca.crt
```

## Troubleshooting

### Issue: "TLS Handshake Failed"
**Cause**: Certificate validation error
**Solution**:
1. Check server certificate validity
2. Verify certificate chain is complete
3. Check CA trust store

### Issue: "Client Certificate Rejected"
**Cause**: Client cert not signed by trusted CA or SAN mismatch
**Solution**:
1. Verify client cert is signed by CA
2. Check SAN is present and matches ACL
3. Check `ENT_DNS__DNS__DOT_CA_PATH` config

### Issue: "Connection Timeout"
**Cause**: Network issue or firewall blocking port 853
**Solution**:
1. Check firewall rules (allow TCP 853)
2. Verify server is reachable (telnet 192.168.1.100 853)
3. Check server logs for TLS errors

### Issue: "High Handshake Latency"
**Cause**: No session resumption or weak cipher suite
**Solution**:
1. Enable TLS session tickets
2. Use stronger cipher suites (TLS_AES_256_GCM_SHA384)
3. Monitor `ent_dns_dot_handshake_duration_seconds`

## RFC Compliance

### RFC 7858 Compliance
- ✅ DNS queries over TLS
- ✅ TCP transport (port 853)
- ✅ TLS 1.3 (or TLS 1.2)
- ✅ Certificate-based authentication
- ✅ DNS message format (length prefix + wire)
- ✅ Connection reuse (keep-alive)
- ✅ Error handling (TLS errors, DNS errors)

### RFC 6125 Compliance
- ✅ Server certificate validation
- ✅ Subject Alternative Name (SAN) support
- ✅ Certificate chain validation
- ✅ Certificate revocation (future enhancement)

## Future Enhancements

### Planned Features
- [ ] TLS session resumption (session tickets)
- [ ] Certificate auto-rotation (ACME Let's Encrypt)
- [ ] CRL/OCSP certificate revocation
- [ ] DoT over IPv6
- [ ] ALPN support (for DoH/DoT multiplexing)

### Optional Features
- [ ] QUIC (HTTP/3) for DoT
- [ ] Certificate pinning enforcement
- [ ] Per-client rate limiting
- [ ] TLS 1.2 fallback (for legacy clients)

## References
- RFC 7858: DNS Queries over TLS
- RFC 6125: Representation and Verification of Domain-Based Application Service Identity
- RFC 5246: TLS 1.2
- RFC 8446: TLS 1.3
- Rustls Documentation: https://docs.rs/rustls
- Cloudflare 1.1.1.1 DoT: https://developers.cloudflare.com/1.1.1.1/infrastructure/ddd-dns-over-tls/

---

**Version History**:
- 1.0 (2026-02-20): Initial architecture design
