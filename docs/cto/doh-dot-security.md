# DoH/DoT Security Considerations

**Version**: 1.0
**Status**: Proposed
**Last Updated**: 2026-02-20

## Executive Summary

This document outlines security considerations for implementing DoH/DoT in Ent-DNS, covering TLS configuration, authentication, certificate management, and threat modeling. Following Werner Vogels' "Everything Fails, All the Time" principle, we design for security failures rather than trying to prevent them entirely.

## Threat Model

### Attack Vectors

| Attack Vector | Description | Impact | Mitigation |
|---------------|-------------|--------|------------|
| **MITM (Man-in-the-Middle)** | Attacker intercepts TLS handshake | DNS query/response tampering | Certificate pinning, strict CA validation |
| **Certificate Spoofing** | Attacker presents fake server certificate | Unauthorized access | Certificate pinning, CRL/OCSP |
| **DoS (Denial of Service)** | Attacker floods DoH/DoT endpoints | Service unavailability | Rate limiting, connection timeout |
| **Replay Attack** | Attacker replays captured DNS query | Cache poisoning | Transaction IDs, timestamps |
| **Token Theft** | JWT token stolen via XSS or network sniffing | Unauthorized access | Short-lived tokens (1 hour), IP binding |
| **Credential Stuffing** | Attacker attempts JWT token combinations | Account takeover | Rate limiting, account lockout |
| **Client Cert Theft** | mTLS client certificate stolen | Unauthorized access | Certificate revocation, hardware tokens |

### Assumptions
- Attacker has network access to DoH/DoT endpoints
- Attacker can capture encrypted traffic (but cannot decrypt TLS 1.3)
- Attacker has knowledge of Ent-DNS implementation details
- Attacker can generate valid TLS handshakes (but lacks valid certificates)

## TLS Configuration Security

### Protocol Version

**Required**: TLS 1.3 only

**Justification**:
- TLS 1.3 removes insecure features (RSA key exchange, MD5, SHA1)
- TLS 1.3 reduces handshake round trips (2 RTT → 1 RTT)
- TLS 1.3 adds forward secrecy by default

**Configuration**:
```rust
let config = ServerConfig::builder()
    .with_protocol_versions(&[&TLS13])
    .with_no_client_auth()
    .with_single_cert(certs, privkey)?;
```

**Fallback**: No TLS 1.2 fallback (violates security best practices)

### Cipher Suites

**Required**: TLS 1.3 cipher suites (rustls defaults)

**Acceptable Cipher Suites**:
1. `TLS_AES_256_GCM_SHA384` - Strongest, slightly slower
2. `TLS_CHACHA20_POLY1305_SHA256` - Fast, mobile-friendly
3. `TLS_AES_128_GCM_SHA256` - Fast, sufficiently strong

**Rejected Cipher Suites**:
- TLS 1.2 suites (e.g., `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`)
- CBC mode (e.g., `TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA`)
- SHA1-based suites (e.g., `TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA`)

**Justification**:
- AES-GCM and ChaCha20-Poly1305 are authenticated encryption modes
- SHA256/384 are secure hash functions
- rustls does not support weak cipher suites (no unsafe defaults)

### Certificate Validation

**Server Certificate Validation**:
- [ ] X.509 v3 certificate
- [ ] TLS server authentication EKU (`id-kp-serverAuth`)
- [ ] Valid certificate chain (intermediate + root CA)
- [ ] Certificate not expired (check `notBefore` and `notAfter`)
- [ ] Subject CN or SAN matches hostname (optional for IP-based)

**Client Certificate Validation** (mTLS):
- [ ] X.509 v3 certificate
- [ ] TLS client authentication EKU (`id-kp-clientAuth`)
- [ ] Valid certificate chain (signed by trusted CA)
- [ ] Certificate not expired
- [ ] SAN present (for ACL matching)

**Certificate Pinning** (Optional):
- Pin server certificate hash in client configuration
- Prevent MITM attacks even if CA is compromised
- Add to `docs/devops/certificate-pinning.md` (future enhancement)

### Session Resumption

**TLS Session Tickets**: Enabled (future enhancement)

**Security Considerations**:
- Session tickets are encrypted with server key (not stored)
- Ticket rotation every 8 hours (prevent replay attacks)
- Session timeout 3600 seconds (1 hour)

**Configuration**:
```rust
ENT_DNS__DNS__DOT_SESSION_TICKET_ENABLED=true
ENT_DNS__DNS__DOT_SESSION_TICKET_ROTATION=28800  # 8 hours
ENT_DNS__DNS__DOT_SESSION_TIMEOUT=3600  # 1 hour
```

## DoH Authentication Security

### JWT Token Security

**Algorithm**: RS256 or ES256 (not HS256)

**Justification**:
- RS256 (RSA Signature with SHA-256): Industry standard, widely supported
- ES256 (ECDSA P-256 with SHA-256): Smaller signatures, faster verification
- HS256 (HMAC with SHA-256): Vulnerable if secret leaked (single point of failure)

**Token Payload**:
```json
{
  "sub": "user123",
  "ip": "192.168.1.10",
  "exp": 1735689600,
  "iat": 1735686000,
  "nbf": 1735686000,
  "aud": "ent-dns-doh"
}
```

**Claims**:
- `sub` (Subject): User ID (required)
- `ip` (IP Address): Client IP (optional, overrides X-Forwarded-For)
- `exp` (Expiration): Token expiration timestamp (required)
- `iat` (Issued At): Token issuance timestamp (required)
- `nbf` (Not Before): Token not valid before (optional)
- `aud` (Audience): Token audience (optional, for multi-tenant)

**Token Expiration**: 1 hour (maximum)

**Justification**:
- Short-lived tokens limit blast radius if leaked
- 1 hour balances security and user experience
- Refresh token flow required for long-lived sessions

### Token Storage (Client-Side)

**Recommended Storage**: Memory (sessionStorage) or HTTP-only cookies

**Discouraged Storage**: localStorage (vulnerable to XSS)

**Example (JavaScript)**:
```javascript
// Good: Memory (sessionStorage)
sessionStorage.setItem('jwt', token);

// Good: HTTP-only cookie (set by server)
// Set-Cookie: jwt=...; HttpOnly; Secure; SameSite=Strict

// Bad: localStorage (XSS vulnerable)
localStorage.setItem('jwt', token);
```

### IP Spoofing Prevention

**Direct Connection**:
- Extract client IP from TCP peer address
- Trust peer IP (no spoofing possible)

**Reverse Proxy**:
- Extract client IP from `X-Forwarded-For` header
- Only trust `X-Forwarded-For` from known proxy IP (configurable)
- JWT token IP claim overrides `X-Forwarded-For` (if present)

**Configuration**:
```bash
# Trusted reverse proxy IPs
ENT_DNS__API__TRUSTED_PROXY_IPS="10.0.0.1,10.0.0.2"
```

## DoT Authentication Security

### Mutual TLS (mTLS) Security

**Client Certificate Issuance**:
- Issue certificates with limited validity (e.g., 30 days)
- Use hardware tokens (YubiKey) for critical clients
- Include SAN for ACL matching (IP address or DNS name)

**Certificate Revocation**:
- Current: No CRL/OCSP (future enhancement)
- Workaround: Remove client certificate from CA trust store and restart server
- Future: Implement CRL (Certificate Revocation List) or OCSP stapling

**SAN Extraction Security**:
- Extract SAN from client certificate (not Subject CN)
- Validate SAN type (IP address, DNS name, email)
- Map SAN to ACL identifiers (exact match, no wildcard)

**Example SAN Values**:
```
SAN (IP Address): 192.168.1.10
SAN (DNS Name): client1.internal.example.com
SAN (Email): user1@example.com
```

**ACL Mapping**:
```sql
-- Match SAN to identifiers
SELECT * FROM clients
WHERE json_extract(identifiers, '$') LIKE '%"192.168.1.10"%'
   OR json_extract(identifiers, '$') LIKE '%"client1.internal.example.com"%';
```

### Certificate Management Security

**Server Certificate**:
- Rotate every 90 days (Let's Encrypt or internal CA)
- Auto-reload without restart (future enhancement)
- Backup old certificate for rollback (encrypted storage)
- Monitor certificate expiration (alert 30 days early)

**Client Certificate** (mTLS):
- Issue with limited validity (e.g., 30 days)
- Revoke if compromised (remove from CA trust store)
- Store securely (PKCS#12 with passphrase)
- Use hardware tokens (YubiKey) for critical clients

**CA Trust Store**:
- Separate root and intermediate CAs (best practice)
- Rotate intermediate certificates independently
- Monitor CA compromise alerts (CVE database)
- Document CA hierarchy for disaster recovery

## Denial of Service Protection

### Rate Limiting

**DoH Endpoint**: 1000 QPS per IP (configurable)

**DoT Endpoint**: 500 QPS per connection (configurable)

**Configuration**:
```bash
ENT_DNS__DNS__DOH_RATE_LIMIT=1000
ENT_DNS__DNS__DOT_RATE_LIMIT=500
```

**Implementation**:
- Use `DashMap` for thread-safe rate tracking
- Token bucket algorithm (allow burst, throttle sustained)
- Log rate limit violations for monitoring

### Connection Timeout

**TLS Handshake Timeout**: 10 seconds

**Connection Idle Timeout**: 60 seconds

**Configuration**:
```bash
ENT_DNS__DNS__DOT_HANDSHAKE_TIMEOUT=10
ENT_DNS__DNS__DOT_IDLE_TIMEOUT=60
```

**Justification**:
- Prevent resource exhaustion (open connections)
- Allow legitimate queries to complete
- Timeouts based on observed latency (P95 + margin)

### Max Connections

**DoT Max Connections**: 10,000 concurrent connections (configurable)

**Configuration**:
```bash
ENT_DNS__DNS__DOT_MAX_CONNECTIONS=10000
```

**Implementation**:
- Track active connections in `AtomicU64` counter
- Reject new connections if limit reached (return 503)
- Log "max connections reached" error for monitoring

## Privacy Considerations

### DNS Query Privacy

**Encrypted Transport**:
- DoH: TLS 1.3 encrypts DNS queries and responses
- DoT: TLS 1.3 encrypts DNS queries and responses
- **Note**: DNS over UDP/TCP is unencrypted (privacy risk)

**Query Logging**:
- Log DNS queries to database (required for audit)
- Log client IP (for ACL and troubleshooting)
- **Redaction**: Remove sensitive data (e.g., search queries) from logs

**Log Retention**:
- Retain logs for 90 days (configurable)
- Anonymize logs after retention period (remove IP addresses)
- Export logs for compliance (GDPR, HIPAA)

### IP Address Privacy

**Client IP Extraction**:
- Direct connection: TCP peer address
- Reverse proxy: `X-Forwarded-For` header
- JWT token: IP claim (overrides all)

**IP Address Masking** (Optional):
- Mask last octet of IPv4 (e.g., `192.168.1.10` → `192.168.1.0`)
- Mask last 64 bits of IPv6 (e.g., `2001:db8::1` → `2001:db8::`)
- **Use Case**: Compliance with strict privacy regulations

**Configuration**:
```bash
ENT_DNS__DNS__LOG_IP_MASKING=true
ENT_DNS__DNS__LOG_IP_MASK_V4=24  # /24 subnet
ENT_DNS__DNS__LOG_IP_MASK_V6=64  # /64 subnet
```

## Monitoring & Alerting

### Security Metrics

**TLS Handshake Errors**:
```
ent_dns_dot_handshake_errors_total{error_type="certificate_invalid|unknown_ca|bad_certificate"}
```

**JWT Authentication Failures**:
```
ent_dns_doh_auth_failures_total{reason="invalid_token|expired_token|missing_token"}
```

**Rate Limit Violations**:
```
ent_dns_rate_limit_violations_total{transport="doh|dot"}
```

### Alerting Rules

**Certificate Expiring Soon**:
```promql
ent_dns_tls_cert_expiry_days < 30
```
**Action**: Rotate certificate immediately

**TLS Handshake Error Rate High**:
```promql
rate(ent_dns_dot_handshake_errors_total[5m]) / rate(ent_dns_dot_connections_total[5m]) > 0.1
```
**Action**: Investigate CA trust store or client certificate issues

**JWT Authentication Failure Rate High**:
```promql
rate(ent_dns_doh_auth_failures_total[5m]) > 100
```
**Action**: Investigate credential stuffing or token leakage

**DoH/DoT QPS Spike**:
```promql
rate(ent_dns_doh_queries_total[5m]) > 10000 OR rate(ent_dns_dot_queries_total[5m]) > 10000
```
**Action**: Check for DoS attack

## Testing & Validation

### Security Testing

**TLS Configuration Test**:
```bash
# Test TLS 1.3 only
openssl s_client -connect ent-dns.example.com:853 -tls1_3
openssl s_client -connect ent-dns.example.com:853 -tls1_2  # Should fail

# Test cipher suite strength
nmap --script ssl-enum-ciphers -p 853 ent-dns.example.com
```

**DoH Authentication Test**:
```bash
# Test without token (public mode)
curl -v "https://ent-dns.example.com/dns-query?dns=..."

# Test with invalid token (private mode)
curl -v "https://ent-dns.example.com/dns-query?dns=..." \
  -H "Authorization: Bearer invalid-token"
```

**DoT mTLS Test**:
```bash
# Test with valid client certificate
kdig @ent-dns.example.com -p 853 \
  +tls \
  +tls-ca=/etc/ssl/certs/ca.crt \
  +tls-cert=/etc/ssl/certs/client.crt \
  +tls-key=/etc/ssl/certs/client.key \
  example.com A

# Test with invalid client certificate (should fail)
kdig @ent-dns.example.com -p 853 \
  +tls \
  +tls-ca=/etc/ssl/certs/fake-ca.crt \
  example.com A
```

### Penetration Testing

**Recommended Tools**:
- **Burp Suite**: TLS interception, certificate spoofing
- **OWASP ZAP**: Security testing, vulnerability scanning
- **Metasploit**: Exploitation testing (authorized only)
- **Wireshark**: Traffic analysis, TLS handshake inspection

**Test Cases**:
1. MITM attack (certificate spoofing)
2. Replay attack (captured DNS query)
3. DoS attack (connection flooding)
4. Token theft (JWT token leakage)
5. Credential stuffing (JWT token combinations)

## Compliance Considerations

### GDPR (General Data Protection Regulation)

**Data Minimization**:
- Only log necessary data (IP address, DNS query, timestamp)
- Mask IP addresses (optional, for strict compliance)
- Retain logs for 90 days (minimum required)

**Data Subject Rights**:
- Export user data (IP address, DNS query history)
- Delete user data (log anonymization)
- Respond to data access requests within 30 days

**Data Breach Notification**:
- Notify authorities within 72 hours (if >10,000 users affected)
- Notify users without undue delay
- Document breach and remediation steps

### HIPAA (Health Insurance Portability and Accountability Act)

**Data Encryption**:
- Encrypt data at rest (SQLite database encryption)
- Encrypt data in transit (TLS 1.3)
- Encrypt backups (AES-256)

**Access Control**:
- Role-based access control (RBAC)
- Audit logging (who accessed what data)
- Minimum necessary principle (only access required data)

**Breach Notification**:
- Notify HHS within 60 days (if >500 individuals affected)
- Notify affected individuals without unreasonable delay
- Document breach and remediation steps

## Security Checklist

### TLS Configuration
- [ ] TLS 1.3 only (no TLS 1.2 fallback)
- [ ] Strong cipher suites (AES-GCM, ChaCha20-Poly1305)
- [ ] Server certificate validation (X.509 v3, EKU, chain)
- [ ] Client certificate validation (mTLS, SAN, EKU)
- [ ] Session resumption enabled (future enhancement)

### DoH Authentication
- [ ] JWT token signed with RS256 or ES256
- [ ] JWT token expires within 1 hour
- [ ] JWT token stored in memory or HTTP-only cookie
- [ ] IP spoofing prevention (X-Forwarded-For validation)
- [ ] Rate limiting (1000 QPS per IP)

### DoT Authentication
- [ ] mTLS enabled (client certificate validation)
- [ ] SAN extraction for ACL matching
- [ ] Certificate revocation (future enhancement)
- [ ] Rate limiting (500 QPS per connection)
- [ ] Max connections limit (10,000)

### Privacy & Logging
- [ ] TLS 1.3 encrypts DNS queries and responses
- [ ] DNS query logging (required for audit)
- [ ] IP address masking (optional, for compliance)
- [ ] Log retention 90 days (configurable)
- [ ] Log anonymization after retention

### Monitoring & Alerting
- [ ] TLS handshake error rate alert
- [ ] JWT authentication failure rate alert
- [ ] Certificate expiration alert (30 days early)
- [ ] DoH/DoT QPS spike alert
- [ ] Security metrics exported to Prometheus

### Testing & Validation
- [ ] TLS configuration test (openssl, nmap)
- [ ] DoH authentication test (curl)
- [ ] DoT mTLS test (kdig)
- [ ] Penetration testing (Burp Suite, OWASP ZAP)
- [ ] Load testing (wrk, hey)

## References
- RFC 8484: DNS Queries over HTTPS
- RFC 7858: DNS Queries over TLS
- RFC 8446: TLS 1.3
- RFC 5246: TLS 1.2
- RFC 7519: JSON Web Token (JWT)
- GDPR (EU) 2016/679
- HIPAA 45 CFR 164.312 (Technical Safeguards)
- OWASP Top 10 (2021)
- CIS Benchmarks for TLS Configuration

---

**Version History**:
- 1.0 (2026-02-20): Initial security considerations document
