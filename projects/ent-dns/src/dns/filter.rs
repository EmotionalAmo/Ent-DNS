use anyhow::Result;
use std::collections::HashMap;
use tokio::sync::RwLock;
use crate::db::DbPool;
use super::rules::RuleSet;

pub struct FilterEngine {
    rules: RwLock<RuleSet>,
    rewrites: RwLock<HashMap<String, String>>,
    db: DbPool,
}

impl FilterEngine {
    pub async fn new(db: DbPool) -> Result<Self> {
        let engine = Self {
            rules: RwLock::new(RuleSet::new()),
            rewrites: RwLock::new(HashMap::new()),
            db,
        };
        engine.reload().await?;
        Ok(engine)
    }

    /// Reload all rules and rewrites from the database.
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

        // Load filter list count
        let list_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM filter_lists WHERE is_enabled = 1"
        )
        .fetch_one(&self.db)
        .await?;

        // Load DNS rewrites
        let mut new_rewrites = HashMap::new();
        let rewrite_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT domain, answer FROM dns_rewrites"
        )
        .fetch_all(&self.db)
        .await?;

        for (domain, answer) in rewrite_rows {
            new_rewrites.insert(domain.to_lowercase(), answer);
        }

        let rewrite_count = new_rewrites.len();

        // Update rules
        {
            let mut rules = self.rules.write().await;
            *rules = new_rules;
        }

        // Update rewrites
        {
            let mut rewrites = self.rewrites.write().await;
            *rewrites = new_rewrites;
        }

        tracing::info!(
            "Filter engine reloaded: {} custom rules, {} filter lists, {} rewrites",
            total,
            list_count,
            rewrite_count,
        );
        Ok(())
    }

    /// Check if a domain should be blocked.
    pub async fn is_blocked(&self, domain: &str) -> bool {
        let rules = self.rules.read().await;
        rules.is_blocked(domain)
    }

    /// Check if a domain has a rewrite rule. Returns the target IP if found.
    pub async fn check_rewrite(&self, domain: &str) -> Option<String> {
        let rewrites = self.rewrites.read().await;
        rewrites.get(&domain.to_lowercase()).cloned()
    }

    /// Add a single rule at runtime (without DB persistence — use API for persistence).
    pub async fn add_rule_live(&self, rule: &str) {
        let mut rules = self.rules.write().await;
        rules.add_rule(rule);
    }

    pub async fn stats(&self) -> (usize, usize, usize) {
        let rules = self.rules.read().await;
        let rewrites = self.rewrites.read().await;
        (
            rules.blocked_count(),
            rules.allowed_count(),
            rewrites.len(),
        )
    }
}
