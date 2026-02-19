use anyhow::Result;
use tokio::net::UdpSocket;
use std::sync::Arc;
use crate::config::Config;
use crate::db::DbPool;
use super::filter::FilterEngine;
use super::handler::DnsHandler;

pub async fn run(cfg: Config, db: DbPool, filter: Arc<FilterEngine>) -> Result<()> {
    let bind_addr = format!("{}:{}", cfg.dns.bind, cfg.dns.port);
    let socket = UdpSocket::bind(&bind_addr).await?;
    tracing::info!("DNS UDP listening on {}", bind_addr);

    let handler = Arc::new(DnsHandler::new(cfg, db, filter).await?);
    let socket = Arc::new(socket);

    loop {
        let mut buf = vec![0u8; 512];
        match socket.recv_from(&mut buf).await {
            Ok((len, peer)) => {
                let data = buf[..len].to_vec();
                let handler = handler.clone();
                let socket = socket.clone();
                let client_ip = peer.ip().to_string();
                tokio::spawn(async move {
                    match handler.handle_udp(data, client_ip).await {
                        Ok(response) => {
                            if let Err(e) = socket.send_to(&response, peer).await {
                                tracing::warn!("Failed to send DNS response: {}", e);
                            }
                        }
                        Err(e) => tracing::warn!("DNS handler error from {}: {}", peer, e),
                    }
                });
            }
            Err(e) => tracing::error!("UDP recv error: {}", e),
        }
    }
}
