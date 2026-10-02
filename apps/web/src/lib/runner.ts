'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '@test-studio/core/client';
import { api } from './api';

export type Conn = 'connecting' | 'connected' | 'reconnecting';
type Ready = Extract<ServerMessage, { type: 'ready' }>;
type EditorState = Extract<ServerMessage, { type: 'state' }>;
type RunStepMsg = Extract<ServerMessage, { type: 'runStep' }>;
type RunDoneMsg = Extract<ServerMessage, { type: 'runDone' }>;

export interface RunProgress {
  steps: Record<number, RunStepMsg>;
  done: RunDoneMsg | null;
}

export interface RunnerOptions {
  testId: number | null;
  /** เรียกทุกข้อความที่ runner ส่งมา (ยกเว้น frame) ให้หน้าจอจัดการเหตุการณ์ครั้งเดียว เช่น picked, export, error */
  onMessage?: (msg: ServerMessage) => void;
  /** เรียกทุกครั้งที่ได้ภาพใหม่ (ไม่ผ่าน React state เพราะถี่) */
  onFrame?: (base64Jpeg: string) => void;
  /** เรียกเมื่อต่อใหม่สำเร็จหลังหลุด */
  onReconnected?: () => void;
}

/**
 * การเชื่อมต่อ WebSocket กับ runner
 * - ขอ token อายุสั้นจากเว็บทุกครั้งที่ต่อ (หลุดแล้วต่อใหม่เองแบบ backoff)
 * - runner เปิดเบราว์เซอร์ใหม่ทุกครั้งที่ต่อ จึงส่ง openTest ซ้ำหลัง ready; step อยู่ในฐานข้อมูลจึงไม่หาย
 */
export function useRunner({ testId, onMessage, onFrame, onReconnected }: RunnerOptions) {
  const [conn, setConn] = useState<Conn>('connecting');
  const [ready, setReady] = useState<Ready | null>(null);
  const [url, setUrl] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [run, setRun] = useState<RunProgress>({ steps: {}, done: null });
  const [connectError, setConnectError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const testIdRef = useRef(testId);
  testIdRef.current = testId;
  const handlers = useRef({ onMessage, onFrame, onReconnected });
  handlers.current = { onMessage, onFrame, onReconnected };

  const send = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    let stopped = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let everConnected = false;

    const retry = () => {
      if (stopped) return;
      setConn('reconnecting');
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    };

    async function connect() {
      let target: { url: string; token: string | null };
      try {
        target = await api.runnerToken();
      } catch (e) {
        setConnectError((e as Error).message);
        return retry();
      }
      if (stopped) return;
      const wsUrl = target.token ? `${target.url}?token=${encodeURIComponent(target.token)}` : target.url;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        delay = 1000;
        setConnectError(null);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: ServerMessage;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'frame':
            handlers.current.onFrame?.(msg.data);
            return;
          case 'ready': {
            setReady(msg);
            setConn('connected');
            if (testIdRef.current != null) ws.send(JSON.stringify({ type: 'openTest', id: testIdRef.current } satisfies ClientMessage));
            if (everConnected) handlers.current.onReconnected?.();
            everConnected = true;
            break;
          }
          case 'url': setUrl(msg.url); break;
          case 'state': setEditor(msg); break;
          case 'runStart': setRun({ steps: {}, done: null }); break;
          case 'runStep': setRun((r) => ({ ...r, steps: { ...r.steps, [msg.id]: { ...r.steps[msg.id], ...msg } } })); break;
          case 'runDone': setRun((r) => ({ ...r, done: msg })); break;
        }
        handlers.current.onMessage?.(msg);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setEditor((s) => (s ? { ...s, recording: false, running: false, mode: 'interact' } : s));
        retry();
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, []);

  // เปลี่ยนเทสระหว่างที่เชื่อมต่ออยู่ (ปกติเปลี่ยนเทสคือเปลี่ยนหน้า จึงต่อใหม่ แต่กันไว้)
  useEffect(() => {
    if (testId != null && conn === 'connected') send({ type: 'openTest', id: testId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]);

  return { conn, ready, url, editor, run, connectError, send };
}
