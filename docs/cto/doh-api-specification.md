# DoH API Specification

**Version**: 1.0
**Status**: Proposed
**Last Updated**: 2026-02-20

## Overview

Ent-DNS implements RFC 8484 DNS Queries over HTTPS. The DoH endpoint provides encrypted DNS resolution over HTTP/2, with optional JWT authentication for enterprise deployments.

## Base URL

```
https://<ent-dns-host>:8443/dns-query
```

Development:
```
http://localhost:8443/dns-query
```

## Authentication

### Mode 1: Public (Default)
No authentication required. Client IP is extracted from:
1. TCP peer IP (direct connection)
2. `X-Forwarded-For` header (behind reverse proxy)

**Configuration**:
```bash
ENT_DNS__DNS__DOH_REQUIRE_AUTH=false
```

### Mode 2: JWT Bearer Token
JWT token required in `Authorization` header.

**Configuration**:
```bash
ENT_DNS__DNS__DOH_REQUIRE_AUTH=true
```

**Request Header**:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Token Claims**:
```json
{
  "sub": "user123",
  "ip": "192.168.1.10",
  "exp": 1735689600
}
```

- `sub`: User ID (for audit logging)
- `ip`: Client IP (for ACL matching, overrides X-Forwarded-For)
- `exp`: Expiration timestamp (Unix epoch)

---

## GET `/dns-query`

**Description**: Submit DNS query via base64url-encoded wire format.

**Parameters**:
- `dns` (required): Base64url-encoded DNS wire format message

**Request Headers**:
```
Accept: application/dns-message
```

**Example Request**:
```bash
# Query for A record of example.com
curl -v "https://localhost:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB" \
  -H "Accept: application/dns-message"
```

**Base64url Encoding Example**:
```python
import base64

# DNS wire format (query for A record of example.com)
wire_format = b"\x00\x00\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01"

# Base64url encode (replace + with -, / with _, remove =)
encoded = base64.urlsafe_b64encode(wire_format).rstrip(b'=').decode()
print(encoded)  # AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB
```

**Response Headers**:
```
Content-Type: application/dns-message
Content-Length: <response size>
Cache-Control: max-age=<TTL>
```

**Response Body**: DNS wire format message (binary)

**Example Response (200 OK)**:
```
Content-Type: application/dns-message
Content-Length: 45
Cache-Control: max-age=300

<binary DNS response>
```

**Error Responses**:

**400 Bad Request**:
```json
{
  "error": "invalid_dns_wire_format",
  "message": "Failed to parse DNS wire format"
}
```

**401 Unauthorized** (JWT required):
```json
{
  "error": "authentication_required",
  "message": "JWT token required in Authorization header"
}
```

**401 Unauthorized** (Invalid JWT):
```json
{
  "error": "invalid_token",
  "message": "JWT token validation failed: expired"
}
```

**500 Internal Server Error**:
```json
{
  "error": "server_error",
  "message": "Internal DNS handler error"
}
```

---

## POST `/dns-query`

**Description**: Submit DNS query via binary wire format in request body.

**Request Headers**:
```
Content-Type: application/dns-message
Accept: application/dns-message
```

**Request Body**: DNS wire format message (binary)

**Example Request**:
```bash
# Create DNS query file
echo -ne "\x00\x00\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01" > query.bin

# Submit via POST
curl -v -X POST "https://localhost:8443/dns-query" \
  -H "Content-Type: application/dns-message" \
  -H "Accept: application/dns-message" \
  --data-binary @query.bin \
  -o response.bin
```

**Response**: Same as GET endpoint

---

## Response Codes

| Code | Meaning |
|------|---------|
| 200 | DNS query successful |
| 400 | Invalid DNS wire format |
| 401 | Authentication required or failed |
| 500 | Internal server error |

## DNS Response Format

**Success Response (200)**:
- Binary DNS wire format message
- Standard DNS response structure (RFC 1035)
- Contains answers, authority, additional sections

**NXDOMAIN Response** (RFC 1035):
```
Response Code: 3 (NXDOMAIN)
```

**SERVFAIL Response** (RFC 1035):
```
Response Code: 2 (SERVFAIL)
```

---

## Examples

### Example 1: A Record Query (GET)
```bash
# Query for A record of example.com
curl -v "https://localhost:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB" \
  -H "Accept: application/dns-message" \
  --output - | hexdump -C
```

**Output**:
```
00000000  00 00 81 80 00 01 00 01  00 00 00 00 07 65 78 61  |............exa|
00000010  6d 70 6c 65 03 63 6f 6d  00 00 01 00 01 c0 0c 00  |mple.com.......|
00000020  01 00 01 00 00 01 2c 00  04 5d b8 d8 22           |.......,..]."."|
```

### Example 2: AAAA Record Query (GET)
```bash
# Query for AAAA record of example.com
curl -v "https://localhost:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAA" \
  -H "Accept: application/dns-message" \
  --output - | hexdump -C
```

### Example 3: With JWT Authentication
```bash
# Login to get token
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r '.token')

# Query with JWT token
curl -v "https://localhost:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/dns-message"
```

### Example 4: With Reverse Proxy
```bash
# Behind Nginx reverse proxy (client IP in X-Forwarded-For)
curl -v "https://ent-dns.example.com/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB" \
  -H "Accept: application/dns-message" \
  -H "X-Forwarded-For: 192.168.1.10"
```

### Example 5: Blocked Domain (NXDOMAIN)
```bash
# Query for blocked domain (if ads.example.com is blocked)
curl -v "https://localhost:8443/dns-query?dns=AAABAAABAAAAAABAAdnZkcy5leGFtcGxlA2NvbQAAAQAB" \
  -H "Accept: application/dns-message" \
  --output - | hexdump -C
```

**Output** (NXDOMAIN):
```
00000000  00 00 81 83 00 01 00 00  00 00 00 00 07 61 64 73  |............ads|
00000010  03 76 64 73 03 65 78 61  6d 70 6c 65 03 63 6f 6d  |.vds.example.com|
00000020  00 00 01 00 01                                    |.....|
```

---

## Performance Considerations

### HTTP/2 Multiplexing
- **Recommended**: Use HTTP/2 for concurrent queries
- **Avoid**: Multiple HTTP/1.1 connections
- **Benefit**: Single TCP connection for multiple queries

### Connection Reuse
- **Keep-Alive**: Default (ent-dns supports persistent connections)
- **Idle Timeout**: 60 seconds (configurable)

### Caching
- **Client-side**: Respect `Cache-Control` header
- **TTL**: Extracted from DNS response (typically 300-3600s)

### Rate Limiting
- **Default**: 1000 QPS per IP (configurable)
- **Burst**: 100 queries per 10 seconds

---

## Client Configuration Examples

### Chrome
```bash
# Enable DoH
chrome://net-internals/#dns

# Set DoH server:
https://ent-dns.example.com:8443/dns-query

# With authentication (if required):
# Chrome does not support custom DoH authentication
# Use system DNS or proxy instead
```

### Firefox
```bash
# Preferences
network.trr.mode = 3
network.trr.uri = https://ent-dns.example.com:8443/dns-query
network.trr.custom_uri = https://ent-dns.example.com:8443/dns-query

# With authentication (unsupported):
# Use system proxy with custom header injection
```

### Windows
```powershell
# Set DoH server for all network adapters
Set-DnsClientDohServerAddress -ServerAddress 192.168.1.100 -DohSetting https://ent-dns.example.com:8443/dns-query -AutoUpgrade $true -AllowFallbackToUdp $true
```

### Linux (systemd-resolved)
```bash
# Create drop-in file
sudo mkdir -p /etc/systemd/resolved.conf.d
sudo tee /etc/systemd/resolved.conf.d/doh.conf > /dev/null <<EOF
[Resolve]
DNSOverTLS=yes
DNS=192.168.1.100
FallbackDNS=1.1.1.1
EOF

# Restart systemd-resolved
sudo systemctl restart systemd-resolved
```

### curl
```bash
# Simple query
curl -v "https://ent-dns.example.com:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB"

# With JWT authentication
TOKEN="your-jwt-token"
curl -v "https://ent-dns.example.com:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB" \
  -H "Authorization: Bearer $TOKEN"

# With HTTP/2 multiplexing
curl -v --http2-prior-knowledge "https://ent-dns.example.com:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB"
```

---

## Security Considerations

### TLS Configuration
- **Protocol**: TLS 1.3 only
- **Cipher Suites**: Modern, secure defaults (rustls)
- **Certificate Validation**: Required (no self-signed in production)

### JWT Security
- **Algorithm**: RS256 or ES256 (not HS256)
- **Expiration**: 1 hour (recommended)
- **Refresh Token**: Use standard `/api/v1/auth/login` endpoint
- **Secret**: 32+ characters (ENT_DNS__AUTH__JWT_SECRET)

### IP Spoofing Prevention
- **Direct Connection**: Use TCP peer IP
- **Reverse Proxy**: Require `X-Forwarded-For` from trusted proxy IP
- **JWT Token**: Override X-Forwarded-For with token claim (if present)

### CORS (Optional)
```bash
# Allow cross-origin requests from specific domains
ENT_DNS__DNS__DOH_CORS_ALLOWED_ORIGINS=https://internal.example.com
```

---

## Troubleshooting

### Issue: "401 Unauthorized"
**Cause**: JWT token required but missing or invalid
**Solution**:
1. Check `ENT_DNS__DNS__DOH_REQUIRE_AUTH` config
2. Verify JWT token is valid and not expired
3. Check `Authorization: Bearer <token>` header

### Issue: "400 Bad Request - Invalid DNS wire format"
**Cause**: Base64url encoding error or malformed DNS message
**Solution**:
1. Verify base64url encoding (replace + with -, / with _)
2. Check DNS wire format structure (RFC 1035)
3. Use hexdump to inspect binary data

### Issue: "Connection Refused"
**Cause**: DoH server not running or port blocked
**Solution**:
1. Check `ENT_DNS__DNS__DOH_ENABLED=true`
2. Verify port 8443 is not in use
3. Check firewall rules

### Issue: "TLS Handshake Failed"
**Cause**: Certificate validation error
**Solution**:
1. Verify server certificate is valid
2. Check certificate chain is complete
3. Ensure DNS resolution for server hostname works

---

## RFC Compliance

### RFC 8484 Compliance
- ✅ GET method with `dns` parameter
- ✅ POST method with binary body
- ✅ `application/dns-message` media type
- ✅ `Cache-Control` header
- ✅ HTTP status codes (200, 400, 401, 500)
- ✅ TLS required (HTTPS)
- ✅ URI Template support (future enhancement)

### RFC 1035 DNS Protocol
- ✅ DNS message format (header, question, answer, authority, additional)
- ✅ Standard response codes (NOERROR, NXDOMAIN, SERVFAIL)
- ✅ EDNS0 support (for large responses)

---

## Future Enhancements

### Planned Features
- [ ] URI Template support (RFC 6570)
- [ ] DNSSEC validation (EDNS0 DO bit)
- [ ] QTYPE=ANY support (with cache)
- [ ] Batch queries (multi-question messages)

### Optional Features
- [ ] Custom DoH subdomain (e.g., `dns.example.com/dns-query`)
- [ ] DoH with HTTP/3 (QUIC)
- [ ] Compression (Brotli/Gzip)
- [ ] Prometheus metrics for DoH endpoint

---

## References
- RFC 8484: DNS Queries over HTTPS
- RFC 1035: Domain Names - Implementation and Specification
- RFC 6125: Representation and Verification of Domain-Based Application Service Identity
- Cloudflare 1.1.1.1 DoH API: https://developers.cloudflare.com/1.1.1.1/infrastructure/ddd-dns-over-https/make-api-requests/

---

**Version History**:
- 1.0 (2026-02-20): Initial specification
