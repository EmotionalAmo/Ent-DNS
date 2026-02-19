use anyhow::Result;
use tokio::sync::RwLock;
use crate::db::DbPool;
use super::rules::RuleSet;

pub struct FilterEngine {
    rules: RwLock<RuleSet>,
    db: DbPool,
}

impl FilterEngine {
    pub async fn new(db: DbPool) -> Result<Self> {
        let engine = Self {
            rules: RwLock::new(RuleSet::new()),
            db,
        };
        engine.reload().await?;
        Ok(engine)
    }

    /// Reload all rules from the database.
    pub async fn reload(&self) -> Result<()> {
        let mut new_rules = RuleSet::new();
        let mut total = 0usize;

        // Load custom rules (AdGuard syntax stored in DB)
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT rule FROM custom_rules WHERE is_enabled = 1"
        )
        .fetch_all(&self.db)
        .await?;

        for (rule,) in rows {
            if new_rules.add_rule(&rule) {
                total += 1;
            }
        }

        // Load filter list content (bulk rules stored as text blobs)
        // For now, filter list rules are stored inline — future: download & cache
        let list_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT url FROM filter_lists WHERE is_enabled = 1 AND url IS NOT NULL"
        )
        .fetch_all(&self.db)
        .await?;

        // TODO: In a future iteration, fetch and cache remote filter lists.
        // For now, count them so we know they exist.
        let list_count = list_rows.len();

        let mut rules = self.rules.write().await;
        *rules = new_rules;

        tracing::info!(
            "Filter engine reloaded: {} custom rules, {} filter lists pending download",
            total,
            list_count,
        );
        Ok(())
    }

    /// Check if a domain should be blocked.
    pub async fn is_blocked(&self, domain: &str) -> bool {
        let rules = self.rules.read().await;
        rules.is_blocked(domain)
    }

    /// Add a single rule at runtime (without DB persistence — use API for persistence).
    pub async fn add_rule_live(&self, rule: &str) {
        let mut rules = self.rules.write().await;
        rules.add_rule(rule);
    }

    pub async fn stats(&self) -> (usize, usize) {
        let rules = self.rules.read().await;
        (rules.blocked_count(), rules.allowed_count())
    }
}
