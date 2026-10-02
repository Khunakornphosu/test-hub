'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// วัดขนาดพื้นที่ แล้วส่ง width/height ให้ลูก (กราฟของ Grafana ต้องรู้ขนาดที่แน่นอน)
export default function Measured({ children }: { children: (w: number, h: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>{size.w > 0 && size.h > 0 ? children(size.w, size.h) : null}</div>;
}
