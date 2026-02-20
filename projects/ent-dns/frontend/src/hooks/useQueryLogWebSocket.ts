import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface LiveQueryEntry {
  time: string;
  client_ip: string;
  question: string;
  qtype: string;
  status: string;
  reason?: string | null;
  elapsed_ms?: number | null;
  _key: string; // unique display key
}

interface Options {
  maxEntries?: number;
}

/**
 * Fetch a one-time WebSocket ticket from the server.
 * This avoids placing the long-lived JWT in the WebSocket URL
 * (which would expose it in server logs, browser history, and Referer headers).
 */
async function fetchWsTicket(token: string): Promise<string | null> {
  try {
    const resp = await fetch('/api/v1/ws/ticket', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

export function useQueryLogWebSocket({ maxEntries = 100 }: Options = {}) {
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [liveEntries, setLiveEntries] = useState<LiveQueryEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const mountedRef = useRef(true);

  const clearEntries = useCallback(() => setLiveEntries([]), []);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    const token = useAuthStore.getState().token;
    if (!token) return;

    setWsStatus('connecting');

    // Obtain a one-time ticket; the JWT never appears in the WS URL
    const ticket = await fetchWsTicket(token);
    if (!ticket || !mountedRef.current) {
      setWsStatus('error');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/v1/ws/query-log?ticket=${encodeURIComponent(ticket)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setWsStatus('connected');
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        const entry: LiveQueryEntry = {
          ...data,
          _key: `${data.time}-${data.question}-${Math.random()}`,
        };
        setLiveEntries((prev) => {
          const next = [entry, ...prev];
          return next.length > maxEntries ? next.slice(0, maxEntries) : next;
        });
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setWsStatus('error');
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      setWsStatus('disconnected');
      // Exponential backoff: 1s, 2s, 4s, ... max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30000);
      reconnectCountRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
  }, [maxEntries]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return { wsStatus, liveEntries, clearEntries };
}
