use anyhow::Result;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,       // user_id
    pub username: String,
    pub role: String,
    pub exp: usize,        // expiry timestamp
    pub iat: usize,        // issued at
}

pub fn generate(user_id: &str, username: &str, role: &str, secret: &str, expiry_hours: u64) -> Result<String> {
    let now = Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        username: username.to_string(),
        role: role.to_string(),
        exp: now + (expiry_hours as usize * 3600),
        iat: now,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok(token)
}

pub fn verify(token: &str, secret: &str) -> Result<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )?;
    Ok(data.claims)
}
