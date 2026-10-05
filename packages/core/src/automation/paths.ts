/** Flow ที่มีเส้นทางมากกว่านี้ต้องแบ่งก่อนรัน */
export const MAX_FLOW_PATHS = 100;

/** ทุกเส้นทางจาก node ต้นทาง (ไม่มีเส้นเข้า) ถึงปลายทาง หยุดหาเมื่อเจอครบ cap เส้น */
export function flowPaths(nodes: readonly { id: string }[], edges: readonly { source: string; target: string }[], cap = MAX_FLOW_PATHS + 1): string[][] {
  if (!nodes.length) return [];
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.add(edge.target);
  }
  const paths: string[][] = [];
  const walk = (id: string, prefix: string[]) => {
    if (paths.length >= cap) return;
    const path = [...prefix, id];
    const next = outgoing.get(id) ?? [];
    if (!next.length) paths.push(path);
    else for (const child of next) walk(child, path);
  };
  for (const node of nodes) if (!incoming.has(node.id)) walk(node.id, []);
  return paths;
}
