'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { ClientMessage, Mode } from '@test-studio/core/client';

export interface SelectMenu { x: number; y: number; options: { value: string; label: string; selected: boolean }[] }

interface Props {
  width: number;
  height: number;
  send: (msg: ClientMessage) => boolean;
  mode: Mode;
  /** ใช้ลงทะเบียนตัวรับภาพ (ภาพมาถี่ ไม่ผ่าน React state) */
  registerFrame: (draw: (base64Jpeg: string) => void) => void;
  selectMenu: SelectMenu | null;
  onCloseSelect: () => void;
  disabled?: boolean;
}

const BUTTONS = ['left', 'middle', 'right'] as const;

/** หน้าเว็บจริงจาก runner วาดบน canvas พร้อมส่งเมาส์/คีย์บอร์ด/IME กลับไป */
export default function BrowserView({ width, height, send, mode, registerFrame, selectMenu, onCloseSelect, disabled }: Props) {
  const s = useStyles2(styles);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ime = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const img = new Image();
    img.onload = () => canvas.current?.getContext('2d')?.drawImage(img, 0, 0, width, height);
    registerFrame((data) => { img.src = `data:image/jpeg;base64,${data}`; });
  }, [registerFrame, width, height]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (width / r.width)), y: Math.round((e.clientY - r.top) * (height / r.height)) };
  };

  // รวม mousemove ให้เหลือ 1 ครั้งต่อเฟรม
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const onMouseMove = (e: React.MouseEvent) => {
    if (disabled) return;
    if (!pendingMove.current) {
      requestAnimationFrame(() => {
        if (pendingMove.current) send({ type: 'mousemove', ...pendingMove.current });
        pendingMove.current = null;
      });
    }
    pendingMove.current = toPage(e);
  };

  // wheel ต้อง preventDefault ได้ จึงผูกแบบ non-passive เอง (React ผูก wheel เป็น passive)
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (disabled) return;
      send({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY, ...toPage(e) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, disabled, width, height]);

  // ปิดเมนู dropdown เมื่อคลิกที่อื่น
  useEffect(() => {
    if (!selectMenu) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-select-menu]')) return;
      onCloseSelect();
      send({ type: 'selectCancel' });
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [selectMenu, onCloseSelect, send]);

  // Esc ยกเลิกโหมดเลือก element / ตรวจสอบ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modeRef.current !== 'interact') {
        e.preventDefault();
        send({ type: 'mode', mode: modeRef.current });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [send]);

  // ตัวอักษรทั่วไปให้ textarea รับแล้วส่งเป็นข้อความ (รองรับภาษาไทย/IME/paste) ปุ่มพิเศษและคีย์ลัดส่งเป็น press
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && modeRef.current !== 'interact') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return;
    const special = e.key.length > 1;
    if (!special && !(e.ctrlKey || e.metaKey || e.altKey)) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    e.preventDefault();
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.metaKey) mods.push('Meta');
    if (e.shiftKey && special) mods.push('Shift');
    send({ type: 'press', key: [...mods, e.key].join('+') });
  };
  const flushText = useCallback(() => {
    const el = ime.current;
    if (el?.value) send({ type: 'text', text: el.value });
    if (el) el.value = '';
  }, [send]);

  const r = canvas.current?.getBoundingClientRect();
  const cursor = mode === 'interact' ? 'default' : 'crosshair';

  return (
    <div className={cx(s.wrap, focused && s.focused)} style={{ aspectRatio: `${width} / ${height}` }}>
      <canvas
        ref={canvas}
        width={width}
        height={height}
        className={s.canvas}
        style={{ cursor }}
        data-testid="browser-canvas"
        aria-label="หน้าเว็บที่กำลังทดสอบ"
        onMouseMove={onMouseMove}
        onMouseDown={(e) => {
          e.preventDefault();
          ime.current?.focus({ preventScroll: true });
          if (!disabled) send({ type: 'mousedown', button: BUTTONS[e.button] ?? 'left', ...toPage(e) });
        }}
        onMouseUp={(e) => { if (!disabled) send({ type: 'mouseup', button: BUTTONS[e.button] ?? 'left', ...toPage(e) }); }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <textarea
        ref={ime}
        className={s.ime}
        aria-label="ส่งการพิมพ์ไปยังหน้าเว็บ"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; flushText(); }}
        onInput={() => { if (!composing.current) flushText(); }}
      />
      {selectMenu && r && (
        <div data-select-menu className={s.menu} style={{ left: selectMenu.x * (r.width / width), top: selectMenu.y * (r.height / height) }}>
          {selectMenu.options.map((o) => (
            <div
              key={o.value}
              className={cx(s.option, o.selected && s.optionSel)}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCloseSelect(); send({ type: 'selectChoose', value: o.value }); }}
            >
              {o.label || o.value || '(ว่าง)'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = (t: GrafanaTheme2) => ({
  wrap: css({ position: 'relative', width: '100%', background: '#fff', border: `1px solid ${t.colors.border.medium}`, borderRadius: t.shape.radius.default, overflow: 'hidden' }),
  focused: css({ borderColor: t.colors.primary.border, boxShadow: `0 0 0 1px ${t.colors.primary.border}` }),
  canvas: css({ display: 'block', width: '100%', height: '100%' }),
  ime: css({ position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, resize: 'none', border: 0, padding: 0 }),
  menu: css({ position: 'absolute', zIndex: 5, minWidth: 160, maxHeight: 260, overflowY: 'auto', background: t.colors.background.primary, color: t.colors.text.primary, border: `1px solid ${t.colors.border.medium}`, borderRadius: t.shape.radius.default, boxShadow: t.shadows.z3 }),
  option: css({ padding: t.spacing(0.75, 1.5), cursor: 'pointer', '&:hover': { background: t.colors.action.hover } }),
  optionSel: css({ fontWeight: t.typography.fontWeightBold, background: t.colors.action.selected }),
});
