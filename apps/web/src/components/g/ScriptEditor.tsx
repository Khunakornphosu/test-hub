'use client';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Drawer, Stack, useStyles2 } from '@grafana/ui';
import { CodeMirrorEditor, type CodeMirrorCompletionSource } from '@grafana/ui/unstable';

export interface ScriptRunResult { ok: boolean; value?: string; error?: string; ms: number }

const EXAMPLES: { label: string; code: string }[] = [
  { label: 'ตรวจว่ามีข้อความ', code: "// ตรวจว่าหน้าเว็บมีข้อความ \"ยินดีต้อนรับ\"\nreturn document.body.innerText.includes('ยินดีต้อนรับ');" },
  { label: 'นับแถวในตาราง', code: "// ตารางต้องมีอย่างน้อย 1 แถว\nreturn document.querySelectorAll('table tbody tr').length > 0;" },
  { label: 'รอ element', code: "// รอ .toast สูงสุด 5 วินาที\nfor (let i = 0; i < 50; i++) {\n  if (document.querySelector('.toast')) return true;\n  await new Promise((r) => setTimeout(r, 100));\n}\nthrow new Error('ไม่พบ .toast');" },
  { label: 'ล้างข้อมูลในเบราว์เซอร์', code: '// ล้าง localStorage และ sessionStorage\nlocalStorage.clear();\nsessionStorage.clear();' },
  { label: 'อ่านค่าไว้ดู', code: "// คืนค่าเพื่อดูผลตอนกดลองรัน\nreturn document.querySelector('h1')?.textContent;" },
];

const COMPLETIONS = [
  { label: 'document.querySelector', apply: "document.querySelector('')", detail: 'หา element แรก' },
  { label: 'document.querySelectorAll', apply: "document.querySelectorAll('')", detail: 'หา element ทั้งหมด' },
  { label: 'document.body.innerText', detail: 'ข้อความทั้งหน้า' },
  { label: 'window.location.href', detail: 'URL ปัจจุบัน' },
  { label: 'localStorage.getItem', apply: "localStorage.getItem('')", detail: 'อ่านค่าที่เก็บไว้' },
  { label: 'sessionStorage.getItem', apply: "sessionStorage.getItem('')", detail: 'อ่านค่าที่เก็บไว้' },
  { label: 'await new Promise', apply: 'await new Promise((r) => setTimeout(r, 500));', detail: 'รอ (มิลลิวินาที)' },
  { label: 'throw new Error', apply: "throw new Error('');", detail: 'ให้ step ไม่ผ่านพร้อมข้อความ' },
  { label: 'return', detail: 'false = ไม่ผ่าน' },
].map((c) => ({ ...c, type: 'function' }));

const completeDom: CodeMirrorCompletionSource = (ctx) => {
  const word = ctx.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: COMPLETIONS };
};

interface Props {
  initial: string;
  result: ScriptRunResult | null;
  running: boolean;
  disabled?: boolean;
  onRun: (script: string) => void;
  onSave: (script: string) => void;
  onClose: () => void;
}

export default function ScriptEditor({ initial, result, running, disabled, onRun, onSave, onClose }: Props) {
  const s = useStyles2(styles);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const dirty = draft !== initial;
  const insert = (code: string) => setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n\n${code}` : code));
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'Enter') { e.preventDefault(); if (draft.trim() && !disabled) onRun(draft); }
    if (e.key === 's') { e.preventDefault(); onSave(draft); }
  };
  return <Drawer title="แก้โค้ด JavaScript" subtitle="โค้ดรันในหน้าเว็บที่กำลังทดสอบ ใช้ document, window และ await ได้" size="md" onClose={onClose}>
    <div className={s.body} onKeyDown={onKeyDown}>
      <ul className={s.rules}>
        <li><code>return false</code> หรือ <code>throw new Error(&apos;…&apos;)</code> = step ไม่ผ่าน</li>
        <li>ค่าอื่นที่ <code>return</code> จะแสดงตอนกดลองรัน · จำกัดเวลา 10 วินาที</li>
      </ul>
      <div className={s.examples} aria-label="ตัวอย่างโค้ด">
        <span>ตัวอย่าง:</span>
        {EXAMPLES.map((ex) => <Button key={ex.label} size="sm" variant="secondary" fill="outline" onClick={() => insert(ex.code)}>{ex.label}</Button>)}
      </div>
      <div className={s.editor}>
        <CodeMirrorEditor aria-label="โค้ด JavaScript" language="typescript" height="min(52vh, 460px)" value={draft} onChange={setDraft} completionSources={[completeDom]} completionMode="merge" />
      </div>
      <Stack gap={1} alignItems="center" wrap="wrap">
        <Button icon="play" variant="secondary" disabled={!draft.trim() || running || disabled} onClick={() => onRun(draft)}>{running ? 'กำลังรัน…' : 'ลองรันกับหน้าเว็บตอนนี้'}</Button>
        <small className={s.muted}>⌘/Ctrl + Enter</small>
      </Stack>
      {disabled && <Alert severity="info" title="รอให้เบราว์เซอร์พร้อมก่อนจึงจะลองรันได้" />}
      {result && <div role="status" data-testid="script-result" className={result.ok ? s.ok : s.fail}>
        <b>{result.ok ? 'ทำงานสำเร็จ' : 'ไม่ผ่าน'}</b> <span className={s.muted}>{result.ms} ms</span>
        {result.ok ? result.value !== undefined && <pre>{result.value}</pre> : <pre>{result.error}</pre>}
      </div>}
      <div className={s.footer}>
        {dirty ? <Badge color="orange" text="ยังไม่ได้บันทึก" /> : <span />}
        <Stack gap={1}>
          <Button variant="secondary" onClick={onClose}>ปิด</Button>
          <Button icon="save" disabled={!dirty} onClick={() => onSave(draft)}>บันทึกโค้ด</Button>
        </Stack>
      </div>
    </div>
  </Drawer>;
}

const styles = (t: GrafanaTheme2) => ({
  body: css({ display: 'flex', flexDirection: 'column', gap: t.spacing(1.5) }),
  rules: css({ margin: 0, paddingLeft: t.spacing(2.5), color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize, code: { fontSize: 'inherit' } }),
  examples: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing(0.75), '> span': { color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize } }),
  editor: css({ border: `1px solid ${t.colors.border.medium}`, borderRadius: t.shape.radius.default, overflow: 'hidden' }),
  muted: css({ color: t.colors.text.secondary }),
  ok: css({ padding: t.spacing(1, 1.5), borderRadius: t.shape.radius.default, borderLeft: `3px solid ${t.colors.success.main}`, background: t.colors.success.transparent, pre: { margin: t.spacing(0.75, 0, 0), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }),
  fail: css({ padding: t.spacing(1, 1.5), borderRadius: t.shape.radius.default, borderLeft: `3px solid ${t.colors.error.main}`, background: t.colors.error.transparent, pre: { margin: t.spacing(0.75, 0, 0), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: t.colors.error.text } }),
  footer: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing(1), paddingTop: t.spacing(1), borderTop: `1px solid ${t.colors.border.weak}` }),
});
