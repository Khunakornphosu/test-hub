const MAX_SNAPSHOT = 20000;

// ตัดค่าที่พิมพ์ไว้ในช่องกรอกออกจาก snapshot ก่อนส่งออกไป (รวมรหัสผ่าน ซึ่ง snapshot แสดงเป็นข้อความธรรมดา)
// ค่าอาจอยู่ท้ายบรรทัด (- textbox "x": ค่า) หรือเป็นบรรทัดลูก (- text: ค่า) เมื่อช่องนั้นมี placeholder
const FIELD = /^(\s*- (textbox|searchbox|spinbutton|combobox)(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*)(:.*)?$/;

export function redactSnapshot(snapshot: string): string {
  const out: string[] = [];
  let fieldIndent = -1; // ระดับย่อหน้าของช่องกรอกที่กำลังอยู่ข้างใน
  for (const line of snapshot.split('\n')) {
    const indent = line.match(/^\s*/)![0].length;
    if (fieldIndent >= 0 && indent > fieldIndent) {
      if (!/^\s*- text:/.test(line)) out.push(line); // เก็บ placeholder และตัวเลือกของ dropdown
      continue;
    }
    fieldIndent = -1;
    const m = line.match(FIELD);
    if (!m) {
      out.push(line);
      continue;
    }
    const hasChildren = m[3] === ':';
    if (hasChildren) fieldIndent = indent;
    out.push(m[1]! + (hasChildren ? ':' : ''));
  }
  return out.join('\n').slice(0, MAX_SNAPSHOT);
}
