// ข้อมูลจำลองสำหรับ prototype (คงที่ ไม่ใช้ Math.random เพื่อไม่ให้ server กับ client render ไม่ตรงกัน)
export type RunStatus = 'passed' | 'failed' | 'healed';

const wave = (n: number, base: number, amp: number, seed: number) =>
  Array.from({ length: n }, (_, i) => Math.round((base + Math.sin(i * 0.9 + seed) * amp + Math.cos(i * 2.3 + seed * 3) * amp * 0.5) * 10) / 10);

// ป้ายแกน X ต้องไม่ซ้ำกัน ไม่งั้นกราฟแท่งจะรวมแท่งที่ชื่อเหมือนกันเป็นอันเดียว
export const days = ['19 ก.ย.', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '1 ต.ค.', '2'];
export const passedPerDay = [112, 118, 109, 124, 131, 42, 38, 120, 126, 118, 133, 129, 45, 40];
export const failedPerDay = [8, 5, 11, 6, 4, 1, 2, 7, 3, 9, 5, 2, 1, 1];
export const passRate = passedPerDay.map((p, i) => Math.round((p / (p + failedPerDay[i])) * 1000) / 10);
export const avgDuration = wave(14, 4.8, 0.6, 1);
export const healedPerDay = [1, 0, 2, 1, 0, 0, 0, 3, 1, 0, 1, 2, 0, 0];

export const sparkPass = passRate;
export const sparkRuns = passedPerDay.map((p, i) => p + failedPerDay[i]);
export const sparkDur = avgDuration;
export const sparkHealed = healedPerDay;

export const tests = [
  { id: 1, name: 'Login ด้วยอีเมล', project: 'Shop', steps: 5, last: 'passed' as RunStatus, health: 99, avg: 3.2, by: 'สมชาย', ago: '5 นาทีที่แล้ว' },
  { id: 2, name: 'Checkout บัตรเครดิต', project: 'Shop', steps: 14, last: 'failed' as RunStatus, health: 72, avg: 12.4, by: 'มานี', ago: '12 นาทีที่แล้ว' },
  { id: 3, name: 'ค้นหาสินค้า', project: 'Shop', steps: 7, last: 'healed' as RunStatus, health: 88, avg: 4.1, by: 'สมชาย', ago: '1 ชั่วโมงที่แล้ว' },
  { id: 4, name: 'สมัครสมาชิก', project: 'Shop', steps: 9, last: 'passed' as RunStatus, health: 97, avg: 5.6, by: 'วิชัย', ago: '2 ชั่วโมงที่แล้ว' },
  { id: 5, name: 'แก้ไขโปรไฟล์', project: 'Admin', steps: 8, last: 'passed' as RunStatus, health: 100, avg: 4.4, by: 'มานี', ago: '3 ชั่วโมงที่แล้ว' },
  { id: 6, name: 'ออกใบกำกับภาษี', project: 'Admin', steps: 18, last: 'failed' as RunStatus, health: 64, avg: 9.8, by: 'วิชัย', ago: 'เมื่อวาน' },
  { id: 7, name: 'รีเซ็ตรหัสผ่าน', project: 'Admin', steps: 6, last: 'passed' as RunStatus, health: 95, avg: 3.9, by: 'สมชาย', ago: 'เมื่อวาน' },
];

// state timeline: 24 ช่องเวลา (ซ้าย=เก่า ขวา=ใหม่) p=ผ่าน f=พัง h=ซ่อม n=ไม่ได้รัน
export const timeline: Record<string, string> = {
  'Login ด้วยอีเมล': 'pppppppppppphpppppppppp'.padEnd(24, 'p'),
  'Checkout บัตรเครดิต': 'pppppffppppppfffppfpfppf',
  'ค้นหาสินค้า': 'pppphppppphpppphppppphph',
  'สมัครสมาชิก': 'ppppppppppppppppfpppnppp',
  'แก้ไขโปรไฟล์': 'pppppppppppppppppppppppp',
  'ออกใบกำกับภาษี': 'ppfppppffppfppfffpfpfffp',
};

export const failures = [
  { time: '14:02:11', test: 'Checkout บัตรเครดิต', step: 'ขั้นที่ 11', msg: 'ข้อความไม่ตรง: คาดว่ามี "ชำระเงินสำเร็จ" แต่เจอ "บัตรถูกปฏิเสธ"' },
  { time: '13:48:30', test: 'ออกใบกำกับภาษี', step: 'ขั้นที่ 6', msg: 'หา element ไม่เจอ หรือ element ยังไม่พร้อมใช้งานภายใน 5 วินาที' },
  { time: '11:20:05', test: 'Checkout บัตรเครดิต', step: 'ขั้นที่ 11', msg: 'ข้อความไม่ตรง: คาดว่ามี "ชำระเงินสำเร็จ" แต่เจอ "บัตรถูกปฏิเสธ"' },
  { time: '09:15:44', test: 'ออกใบกำกับภาษี', step: 'ขั้นที่ 14', msg: 'URL ไม่ตรง: คาดว่า /invoices/done แต่เป็น /invoices/new' },
];

export const slowest = tests.map((t) => ({ name: t.name, sec: t.avg })).sort((a, b) => b.sec - a.sec).slice(0, 5);

// Workspace: step ของเทส "Login ด้วยอีเมล"
export const steps = [
  { id: 1, icon: 'open', verb: 'เปิด', target: 'https://shop.example.com/login', kind: 'action' },
  { id: 2, icon: 'type', verb: 'พิมพ์', target: 'ช่อง "อีเมล"', value: '"somchai@test.com"', kind: 'action' },
  { id: 3, icon: 'type', verb: 'พิมพ์', target: 'ช่อง "รหัสผ่าน"', value: '•••••• (SHOP_PASSWORD)', kind: 'action' },
  { id: 4, icon: 'select', verb: 'เลือก', target: 'dropdown "บทบาท"', value: '"Developer"', kind: 'action' },
  { id: 5, icon: 'click', verb: 'คลิก', target: 'ปุ่ม "เข้าสู่ระบบ"', kind: 'action', healed: true },
  { id: 6, icon: 'text', verb: 'ตรวจข้อความ', target: 'p.welcome', value: 'มี "ยินดีต้อนรับ"', kind: 'assert' },
  { id: 7, icon: 'url', verb: 'ตรวจ URL', target: 'https://shop.example.com/home', kind: 'assert' },
];
