'use client';
import { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { CodeMirrorEditor } from '@grafana/ui/unstable';

export default function TestCodeView({ code, fileName }: { code: string | null; fileName: string }) {
  const s = useStyles2(styles);
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(true);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  const download = () => {
    if (!code) return;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/typescript' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  };
  return <div className={s.wrap} data-testid="test-code-view">
    <div className={s.bar}>
      <span className={s.note} title='แก้โค้ดเองได้ใน step "รันโค้ด JavaScript"'>โค้ดทั้งเทส · อ่านอย่างเดียว · อัปเดตตาม step</span>
      <Button size="sm" variant="secondary" fill={wrap ? 'solid' : 'outline'} icon="wrap-text" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>ตัดบรรทัด</Button>
      <Button size="sm" variant="secondary" icon={copied ? 'check' : 'copy'} disabled={!code} onClick={copy}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</Button>
      <Button size="sm" variant="secondary" icon="download-alt" disabled={!code} onClick={download}>ดาวน์โหลด .spec.ts</Button>
    </div>
    <div className={s.editor}>
      {code == null ? <div className={s.wait} role="status">กำลังสร้างโค้ด…</div> : <CodeMirrorEditor aria-label="โค้ดของทั้งเทส" language="typescript" height="100%" value={code} onChange={() => {}} readOnly lineWrapping={wrap} />}
    </div>
  </div>;
}

const styles = (t: GrafanaTheme2) => ({
  wrap: css({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: t.spacing(1) }),
  bar: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing(1) }),
  note: css({ flex: 1, minWidth: 160, color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
  editor: css({ flex: 1, minHeight: 0, border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, overflow: 'hidden', '& > div, .cm-editor': { height: '100%' } }),
  wait: css({ padding: t.spacing(3), color: t.colors.text.secondary }),
});
