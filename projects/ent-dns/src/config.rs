use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub dns: DnsConfig,
    pub api: ApiConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DnsConfig {
    #[serde(default = "default_dns_port")]
    pub port: u16,
    #[serde(default = "default_bind")]
    pub bind: String,
    #[serde(default)]
    pub upstreams: Vec<String>,
    pub doh_enabled: bool,
    pub dot_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiConfig {
    #[serde(default = "default_api_port")]
    pub port: u16,
    #[serde(default = "default_bind")]
    pub bind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    pub jwt_secret: String,
    #[serde(default = "default_jwt_expiry")]
    pub jwt_expiry_hours: u64,
}

fn default_dns_port() -> u16 { 5353 }  // Use 5353 in dev (53 requires root)
fn default_bind() -> String { "0.0.0.0".to_string() }
fn default_api_port() -> u16 { 8080 }
fn default_db_path() -> String { "./ent-dns.db".to_string() }
fn default_jwt_expiry() -> u64 { 24 }

pub fn load() -> Result<Config> {
    let cfg = config::Config::builder()
        .add_source(config::File::with_name("config").required(false))
        .add_source(config::Environment::with_prefix("ENT_DNS").separator("__"))
        .set_default("dns.bind", "0.0.0.0")?
        .set_default("dns.port", 5353)?
        .set_default("dns.upstreams", vec!["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"])?
        .set_default("dns.doh_enabled", false)?
        .set_default("dns.dot_enabled", false)?
        .set_default("api.bind", "0.0.0.0")?
        .set_default("api.port", 8080)?
        .set_default("database.path", "./ent-dns.db")?
        .set_default("auth.jwt_secret", "change-me-in-production")?
        .set_default("auth.jwt_expiry_hours", 24)?
        .build()?
        .try_deserialize()?;

    Ok(cfg)
}
