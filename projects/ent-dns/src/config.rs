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
    #[allow(dead_code)]
    pub doh_enabled: bool,
    #[allow(dead_code)]
    pub dot_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiConfig {
    #[serde(default = "default_api_port")]
    pub port: u16,
    #[serde(default = "default_bind")]
    pub bind: String,
    /// Allowed CORS origins. Defaults to localhost dev ports.
    /// Set ENT_DNS__API__CORS_ALLOWED_ORIGINS in production.
    #[serde(default = "default_cors_allowed_origins")]
    pub cors_allowed_origins: Vec<String>,
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
fn default_cors_allowed_origins() -> Vec<String> {
    vec![
        "http://localhost:5173".to_string(),
        "http://localhost:5174".to_string(),
        "http://localhost:8080".to_string(),
    ]
}

const DEFAULT_JWT_SECRET: &str = "change-me-in-production";

pub fn validate(cfg: &Config) -> Result<()> {
    // Security: Reject default JWT secret
    if cfg.auth.jwt_secret == DEFAULT_JWT_SECRET {
        anyhow::bail!(
            "SECURITY ERROR: JWT secret must be changed from default value '{}'. \
            Set ENT_DNS__AUTH__JWT_SECRET environment variable with a strong random value.",
            DEFAULT_JWT_SECRET
        );
    }

    // Security: JWT secret must be at least 32 characters
    if cfg.auth.jwt_secret.len() < 32 {
        anyhow::bail!(
            "CONFIG ERROR: JWT secret must be at least 32 characters (current: {})",
            cfg.auth.jwt_secret.len()
        );
    }

    // Validate database path directory exists or can be created
    if let Some(parent) = std::path::Path::new(&cfg.database.path).parent() {
        if !parent.exists() {
            anyhow::bail!(
                "CONFIG ERROR: Database directory does not exist: {}",
                parent.display()
            );
        }
    }

    tracing::info!("Configuration validation passed");
    Ok(())
}

pub fn load() -> Result<Config> {
    let cfg = config::Config::builder()
        .add_source(config::File::with_name("config").required(false))
        .add_source(config::Environment::with_prefix("ENT_DNS").separator("__"))
        .set_default("dns.bind", "0.0.0.0")?
        .set_default("dns.port", 5353)?
        .set_default("dns.upstreams", vec!["1.1.1.1:53", "8.8.8.8:53"])?
        .set_default("dns.doh_enabled", false)?
        .set_default("dns.dot_enabled", false)?
        .set_default("api.bind", "0.0.0.0")?
        .set_default("api.port", 8080)?
        .set_default("database.path", "./ent-dns.db")?
        .set_default("auth.jwt_secret", DEFAULT_JWT_SECRET)?
        .set_default("auth.jwt_expiry_hours", 24)?
        .build()?
        .try_deserialize()?;

    validate(&cfg)?;

    Ok(cfg)
}
