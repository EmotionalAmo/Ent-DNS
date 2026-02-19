use anyhow::Result;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UdpSocket, TcpListener};
use tokio::sync::broadcast;
use std::sync::Arc;
use crate::config::Config;
use crate::db::DbPool;
use crate::metrics::DnsMetrics;
use super::filter::FilterEngine;
use super::handler::DnsHandler;

pub async fn run(cfg: Config, db: DbPool, filter: Arc<FilterEngine>, metrics: Arc<DnsMetrics>, query_log_tx: broadcast::Sender<serde_json::Value>) -> Result<()> {
    let bind_addr = format!("{}:{}", cfg.dns.bind, cfg.dns.port);

    let handler = Arc::new(DnsHandler::new(cfg, db, filter, metrics, query_log_tx).await?);

    // ── UDP server ──────────────────────────────────────────────
    let udp_socket = Arc::new(UdpSocket::bind(&bind_addr).await?);
    tracing::info!("DNS UDP listening on {}", bind_addr);

    // ── TCP server (RFC 1035: required for responses > 512 bytes) ──
    let tcp_listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!("DNS TCP listening on {}", bind_addr);

    let handler_tcp = handler.clone();
    tokio::spawn(async move {
        loop {
            match tcp_listener.accept().await {
                Ok((mut stream, peer)) => {
                    let h = handler_tcp.clone();
                    let client_ip = peer.ip().to_string();
                    tokio::spawn(async move {
                        // DNS/TCP: 2-byte big-endian length prefix before each message
                        let mut len_buf = [0u8; 2];
                        if stream.read_exact(&mut len_buf).await.is_err() { return; }
                        let msg_len = u16::from_be_bytes(len_buf) as usize;
                        if msg_len == 0 || msg_len > 65535 { return; }
                        let mut data = vec![0u8; msg_len];
                        if stream.read_exact(&mut data).await.is_err() { return; }

                        match h.handle_udp(data, client_ip).await {
                            Ok(response) => {
                                let len = (response.len() as u16).to_be_bytes();
                                let _ = stream.write_all(&len).await;
                                let _ = stream.write_all(&response).await;
                            }
                            Err(e) => tracing::warn!("DNS TCP handler error: {}", e),
                        }
                    });
                }
                Err(e) => tracing::error!("DNS TCP accept error: {}", e),
            }
        }
    });

    // ── UDP receive loop ────────────────────────────────────────
    loop {
        // EDNS0 supports up to 4096-byte payloads; 512 truncates DNSSEC/large responses
        let mut buf = vec![0u8; 4096];
        match udp_socket.recv_from(&mut buf).await {
            Ok((len, peer)) => {
                let data = buf[..len].to_vec();
                let handler = handler.clone();
                let socket = udp_socket.clone();
                let client_ip = peer.ip().to_string();
                tokio::spawn(async move {
                    match handler.handle_udp(data, client_ip).await {
                        Ok(response) => {
                            if let Err(e) = socket.send_to(&response, peer).await {
                                tracing::warn!("Failed to send DNS response: {}", e);
                            }
                        }
                        Err(e) => tracing::warn!("DNS UDP handler error from {}: {}", peer, e),
                    }
                });
            }
            Err(e) => tracing::error!("UDP recv error: {}", e),
        }
    }
}
