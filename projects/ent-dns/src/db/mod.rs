use anyhow::Result;
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;
use crate::config::Config;

pub mod models;
pub mod audit;

pub type DbPool = SqlitePool;

pub async fn init(cfg: &Config) -> Result<DbPool> {
    let db_url = format!("sqlite://{}?mode=rwc", cfg.database.path);
    let pool = SqlitePool::connect(&db_url).await?;

    sqlx::migrate!("./src/db/migrations").run(&pool).await?;

    // Enable WAL mode for better concurrent write performance
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;

    tracing::info!("Database connected: {}", cfg.database.path);
    Ok(pool)
}

/// Create default admin user if no users exist yet.
pub async fn seed_admin(pool: &DbPool, _cfg: &Config) -> Result<()> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    if count.0 == 0 {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let password = crate::auth::password::hash("admin")?;

        sqlx::query(
            "INSERT INTO users (id, username, password, role, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 'super_admin', 1, ?, ?)"
        )
        .bind(&id)
        .bind("admin")
        .bind(&password)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        tracing::warn!(
            "Created default admin user (username: admin, password: admin). \
             Change immediately in production!"
        );
    }

    Ok(())
}
