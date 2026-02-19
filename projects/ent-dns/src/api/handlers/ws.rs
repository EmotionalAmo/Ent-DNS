use axum::{
    extract::{State, Query, WebSocketUpgrade, ws::{WebSocket, Message}},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::broadcast;
use crate::api::AppState;
use crate::auth::jwt;

#[derive(Deserialize)]
pub struct WsParams {
    token: String,
}

/// WebSocket endpoint for real-time query log streaming.
/// JWT is passed as a URL query parameter since WebSocket can't send custom headers.
pub async fn query_log_ws(
    State(state): State<Arc<AppState>>,
    Query(params): Query<WsParams>,
    ws: WebSocketUpgrade,
) -> Response {
    if jwt::verify(&params.token, &state.jwt_secret).is_err() {
        return (StatusCode::UNAUTHORIZED, "Invalid or expired token").into_response();
    }
    let tx = state.query_log_tx.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, tx))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, tx: broadcast::Sender<serde_json::Value>) {
    let mut rx = tx.subscribe();

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        if let Ok(text) = serde_json::to_string(&event) {
                            if socket.send(Message::Text(text.into())).await.is_err() {
                                break; // client disconnected
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue, // skip missed events
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(_)) => {} // ignore client messages (ping/pong handled by axum)
                    _ => break,       // client disconnected or error
                }
            }
        }
    }
}
