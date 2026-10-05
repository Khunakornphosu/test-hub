'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addEdge, applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import { Alert, Button, EmptyState, IconButton, Input, LoadingPlaceholder, Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { flowPaths, type ServerMessage } from '@test-studio/core/client';
import { api, type FlowEdge, type FlowNode, type FlowSummary, type TestSummary } from '@/lib/api';
import { useProject } from '@/lib/project';
import { useRunner } from '@/lib/runner';

type RunStatus = 'running' | 'passed' | 'failed' | 'skipped';
type FlowNodeData = { testId: number; name: string; stepCount: number; status?: RunStatus; [key: string]: unknown };
type FlowUiNode = Node<FlowNodeData, 'testCase'>;
type Waiter = { match: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

function CaseNode({ data, selected }: NodeProps<FlowUiNode>) {
  return <div className={`flow-case-node${selected ? ' selected' : ''}${data.status ? ` ${data.status}` : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="flow-case-kicker">TEST CASE</div>
    <strong>{data.name}</strong>
    <small>{data.stepCount} steps</small>
    {data.status && <span className="flow-node-status">{{ running: 'กำลังรัน', passed: 'ผ่าน', failed: 'ไม่ผ่าน', skipped: 'ข้าม' }[data.status]}</span>}
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { testCase: CaseNode };

function FitFlowToViewport() {
  const { fitView } = useReactFlow();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const fit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => requestAnimationFrame(() => { void fitView({ padding: 0.2, duration: 120 }); }), 180);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => { clearTimeout(timer); window.removeEventListener('resize', fit); };
  }, [fitView]);
  return null;
}

function hasCycle(source: string, target: string, edges: Edge[]): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const seen = new Set<string>();
  const visit = (id: string): boolean => { if (id === source) return true; if (seen.has(id)) return false; seen.add(id); return (outgoing.get(id) ?? []).some(visit); };
  return source === target || visit(target);
}

function FlowRunPanel({ paths, nodes, tests, onStatus, onFinish }: { paths: string[][]; nodes: FlowNode[]; tests: TestSummary[]; onStatus: (id: string, status: RunStatus) => void; onFinish: () => void }) {
  const [currentPath, setCurrentPath] = useState(0);
  const [currentNode, setCurrentNode] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [failure, setFailure] = useState('');
  const waiters = useRef<Waiter[]>([]);
  const stopped = useRef(false);
  const clearWaiters = () => { for (const waiter of waiters.current) { clearTimeout(waiter.timer); waiter.reject(new Error('หยุดการรัน')); } waiters.current = []; };
  const waitFor = (match: (message: ServerMessage) => boolean) => new Promise<ServerMessage>((resolve, reject) => {
    const waiter: Waiter = { match, resolve, reject, timer: setTimeout(() => { waiters.current = waiters.current.filter((item) => item !== waiter); reject(new Error('Runner ไม่ตอบสนองภายใน 60 วินาที')); }, 60_000) };
    waiters.current.push(waiter);
  });
  const handleMessage = (message: ServerMessage) => {
    if (message.type === 'error') {
      const pending = waiters.current.splice(0);
      for (const waiter of pending) { clearTimeout(waiter.timer); waiter.reject(new Error(message.message)); }
      return;
    }
    for (const waiter of [...waiters.current]) if (waiter.match(message)) {
      waiters.current = waiters.current.filter((item) => item !== waiter); clearTimeout(waiter.timer); waiter.resolve(message);
    }
  };
  const runner = useRunner({ testId: null, onMessage: handleMessage });
  const runRef = useRef(false);

  useEffect(() => {
    if (runner.conn !== 'connected' || runRef.current) return;
    runRef.current = true;
    const execute = async () => {
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const testNames = new Map(tests.map((test) => [test.id, test.name]));
      const nameFor = (nodeId: string) => { const node = byId.get(nodeId); return node ? testNames.get(node.testId) ?? 'เทสเคสถูกลบแล้ว' : 'เทสเคส'; };
      let hadFailure = false;
      for (let p = 0; p < paths.length && !stopped.current; p++) {
        setCurrentPath(p); setMessages((items) => [...items, `เริ่มเส้นทาง ${p + 1} จากต้น`]);
        for (const nodeId of paths[p]!) {
          const node = byId.get(nodeId);
          if (!node) continue;
          setCurrentNode(nodeId); onStatus(nodeId, 'running');
          try {
            const ready = waitFor((message) => message.type === 'state' && message.testId === node.testId);
            if (!runner.send({ type: 'openTest', id: node.testId })) throw new Error('ส่งคำสั่งไป Runner ไม่สำเร็จ');
            await ready;
            const done = waitFor((message) => message.type === 'runDone');
            if (!runner.send({ type: 'run' })) throw new Error('ส่งคำสั่งรันไป Runner ไม่สำเร็จ');
            const result = await done as Extract<ServerMessage, { type: 'runDone' }>;
            onStatus(nodeId, result.passed ? 'passed' : 'failed');
            setMessages((items) => [...items, `${nameFor(nodeId)}: ${result.passed ? 'ผ่าน' : 'ไม่ผ่าน'} · run #${result.runId}`]);
            if (!result.passed) {
              for (const skipped of paths[p]!.slice(paths[p]!.indexOf(nodeId) + 1)) { onStatus(skipped, 'skipped'); setMessages((items) => [...items, `${nameFor(skipped)}: ข้ามเพราะขั้นก่อนหน้าไม่ผ่าน`]); }
              break;
            }
          } catch (error) {
            if (stopped.current) return;
            onStatus(nodeId, 'failed'); setFailure((error as Error).message); setMessages((items) => [...items, `${nameFor(nodeId)}: ${ (error as Error).message }`]);
            for (const skipped of paths[p]!.slice(paths[p]!.indexOf(nodeId) + 1)) onStatus(skipped, 'skipped');
            hadFailure = true;
            break;
          }
        }
        setCurrentNode('');
        if (hadFailure) break;
      }
      if (stopped.current) return;
      setFinished(true);
      onFinish();
    };
    void execute();
  }, [runner.conn, runner.send, nodes, tests, paths, onStatus, onFinish]);

  useEffect(() => { stopped.current = false; return () => { stopped.current = true; clearWaiters(); }; }, []);
  return <section className="flow-run-panel" aria-live="polite">
    <div className="flow-run-heading"><div><strong>{finished ? 'รัน Flow เสร็จแล้ว' : `กำลังรันเส้นทาง ${Math.min(currentPath + 1, paths.length)} จาก ${paths.length}`}</strong><p>{finished ? 'แต่ละเคสเริ่มจาก browser context ใหม่ และมี run แยกในประวัติ' : currentNode ? 'กำลังทำเคสในเส้นทางนี้…' : runner.conn === 'connected' ? 'กำลังเตรียม runner…' : 'กำลังเชื่อมต่อ runner…'}</p></div><Button size="sm" variant="secondary" onClick={() => { stopped.current = true; clearWaiters(); setFinished(true); onFinish(); }}>ปิด</Button></div>
    {failure && <Alert severity="error" title={failure} />}
    <ol className="flow-run-log">{messages.map((message, index) => <li key={index}>{message}</li>)}</ol>
  </section>;
}

export default function FlowsPage() {
  const s = useStyles2(styles);
  const { current, isLoading: projectLoading } = useProject();
  const projectId = current?.id;
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [flowId, setFlowId] = useState<number | null>(null);
  const [flowName, setFlowName] = useState('');
  const [nodes, setNodes] = useState<FlowUiNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [testToAdd, setTestToAdd] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [runActive, setRunActive] = useState(false);
  const [runStatuses, setRunStatuses] = useState<Record<string, RunStatus>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFlow = flows.find((flow) => flow.id === flowId);
  const flowNodes = useMemo(() => nodes.map((node) => ({ id: node.id, type: 'testCase' as const, testId: node.data.testId, position: node.position })), [nodes]);
  const flowEdges = useMemo(() => edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...(typeof edge.label === 'string' && edge.label ? { label: edge.label } : {}) })), [edges]);
  const paths = useMemo(() => flowPaths(flowNodes, flowEdges), [flowNodes, flowEdges]);

  const refreshLists = useCallback(async (id: number) => {
    const [flowList, testList] = await Promise.all([api.flows(id), api.tests(id)]);
    setFlows(flowList); setTests(testList);
    setFlowId((selected) => selected && flowList.some((flow) => flow.id === selected) ? selected : flowList[0]?.id ?? null);
  }, []);
  useEffect(() => {
    if (!projectId) { setFlows([]); setTests([]); setFlowId(null); return; }
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([api.flows(projectId), api.tests(projectId)]).then(([flowList, testList]) => {
      if (cancelled) return;
      setFlows(flowList); setTests(testList); setFlowId((selected) => selected && flowList.some((flow) => flow.id === selected) ? selected : flowList[0]?.id ?? null);
    }).catch((e) => { if (!cancelled) setError((e as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);
  useEffect(() => {
    if (!flowId) { setFlowName(''); setNodes([]); setEdges([]); return; }
    let cancelled = false;
    setLoading(true); setError('');
    api.flow(flowId).then((flow) => {
      if (cancelled) return;
      setFlowName(flow.name);
      const byId = new Map(tests.map((test) => [test.id, test]));
      setNodes(flow.nodes.map((node) => { const test = byId.get(node.testId); return { id: node.id, type: 'testCase' as const, position: node.position, data: { testId: node.testId, name: test?.name ?? 'เทสเคสถูกลบแล้ว', stepCount: test?.stepCount ?? 0, status: runStatuses[node.id] } }; }));
      setEdges(flow.edges.map((edge) => ({ ...edge, type: 'smoothstep', label: edge.label, labelStyle: { fontSize: 12 }, labelBgStyle: { fill: 'var(--background-primary)' } })));
    }).catch((e) => { if (!cancelled) setError((e as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [flowId, tests]);

  const persist = useCallback((nextNodes: FlowUiNode[], nextEdges: Edge[], name = flowName) => {
    if (!flowId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const savedNodes = nextNodes.map((node) => ({ id: node.id, type: 'testCase' as const, testId: node.data.testId, position: node.position }));
    const savedEdges = nextEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...(typeof edge.label === 'string' && edge.label ? { label: edge.label } : {}) }));
    saveTimer.current = setTimeout(() => api.updateFlow(flowId, { name, nodes: savedNodes, edges: savedEdges }).then(() => setError('')).catch((e) => setError((e as Error).message)), 350);
  }, [flowId, flowName]);

  const handleNodesChange = useCallback((changes: NodeChange<FlowUiNode>[]) => {
    setNodes((current) => { const next = applyNodeChanges(changes, current) as FlowUiNode[]; persist(next, edges); return next; });
  }, [edges, persist]);
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => { const next = applyEdgeChanges(changes, current); persist(nodes, next); return next; });
  }, [nodes, persist]);
  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || hasCycle(connection.source, connection.target, edges)) { setError('Flow ต้องไม่มีวงวน'); return; }
    setEdges((current) => { const next = addEdge({ ...connection, id: `edge-${crypto.randomUUID()}`, type: 'smoothstep', label: '' }, current); persist(nodes, next); return next; });
    setError('');
  }, [edges, nodes, persist]);

  const addNode = () => {
    const test = tests.find((item) => item.id === testToAdd);
    if (!test) return;
    const id = `case-${crypto.randomUUID()}`;
    const next = [...nodes, { id, type: 'testCase' as const, position: { x: 120 + (nodes.length % 4) * 280, y: 120 + Math.floor(nodes.length / 4) * 180 }, data: { testId: test.id, name: test.name, stepCount: test.stepCount } }];
    setNodes(next); persist(next, edges); setError('');
  };
  const updateName = (value: string) => { setFlowName(value); persist(nodes, edges, value); };
  const createFlow = async () => {
    if (!projectId) return;
    try { const { id } = await api.createFlow(projectId, `Flow ใหม่ ${flows.length + 1}`); await refreshLists(projectId); setFlowId(id); }
    catch (e) { setError((e as Error).message); }
  };
  const deleteFlow = async () => {
    if (!flowId || !window.confirm(`ลบ Flow “${flowName}” หรือไม่?`)) return;
    try { await api.deleteFlow(flowId); setFlowId(null); if (projectId) await refreshLists(projectId); }
    catch (e) { setError((e as Error).message); }
  };
  const updateStatus = useCallback((id: string, status: RunStatus) => {
    setRunStatuses((current) => {
      const existing = current[id];
      const priority: Record<RunStatus, number> = { running: 0, passed: 1, skipped: 2, failed: 3 };
      const nextStatus = existing && priority[existing] > priority[status] ? existing : status;
      return { ...current, [id]: nextStatus };
    });
    setNodes((current) => current.map((node) => {
      if (node.id !== id) return node;
      const priority: Record<RunStatus, number> = { running: 0, passed: 1, skipped: 2, failed: 3 };
      return node.data.status && priority[node.data.status] > priority[status] ? node : { ...node, data: { ...node.data, status } };
    }));
  }, []);
  const finishRun = useCallback(() => setRunActive(false), []);
  const startRun = () => {
    if (!paths.length || paths.length > 100) return;
    setRunActive(true); setRunStatuses({}); setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: undefined } }))); setRunKey((key) => key + 1);
  };

  return <div className={s.page}>
    <header className={s.header}>
      <div><h1>Test Flow</h1><p>จัดแผนที่เส้นทางจากเทสเคสที่มีอยู่ แต่ละเส้นทางจะเริ่มรันจากต้นแยกกัน</p></div>
      <div className={s.flowControls}>
        <Select className={s.flowSelect} aria-label="เลือก Flow" width={30} options={flows.map((flow) => ({ label: flow.name, value: flow.id }))} value={flowId ?? undefined} onChange={(value) => value.value != null && setFlowId(value.value)} />
        <Button icon="plus" onClick={() => void createFlow()} disabled={!projectId}>สร้าง Flow</Button>
        {flowId && <IconButton name="trash-alt" tooltip="ลบ Flow" aria-label="ลบ Flow" onClick={() => void deleteFlow()} />}
      </div>
    </header>
    {error && <Alert severity="error" title={error} onRemove={() => setError('')} />}
    {projectLoading || loading ? <LoadingPlaceholder text="กำลังโหลด Flow…" /> : !projectId ? <EmptyState variant="not-found" message="ไม่พบโปรเจกต์" /> : !flows.length ? <EmptyState variant="call-to-action" message="ยังไม่มี Flow" button={<Button icon="plus" onClick={() => void createFlow()}>สร้าง Flow แรก</Button>}>เชื่อมเทสเคสเป็นเส้นทาง แล้วเลือกรันทีละ scenario ได้</EmptyState> : activeFlow ? <>
      <div className={s.toolbar}>
        <Input aria-label="ชื่อ Flow" value={flowName} onChange={(event) => updateName(event.currentTarget.value)} />
        <Select aria-label="เพิ่มเทสเคส" width={32} options={tests.map((test) => ({ label: `${test.name} · ${test.stepCount} steps`, value: test.id }))} value={testToAdd} onChange={(value) => setTestToAdd(value.value)} />
        <Button icon="plus" onClick={addNode} disabled={!testToAdd}>เพิ่มเคส</Button>
        <span className={s.spacer} />
        <span className={s.pathCount}>{paths.length > 100 ? 'มากกว่า 100 เส้นทาง' : `${paths.length} เส้นทาง`}</span>
        <Button icon="play" onClick={startRun} disabled={!paths.length || paths.length > 100 || runActive}>รันทุกเส้นทาง</Button>
      </div>
      <div className={s.hint}>ลากเส้นจากจุดด้านขวาของเคสไปยังจุดด้านซ้ายเพื่อเชื่อมลำดับ · แตกแขนงได้ · ระบบไม่อนุญาตวงวน</div>
      {paths.length > 100 && <Alert severity="warning" title="Flow นี้มีเส้นทางมากกว่า 100 เส้น กรุณาแบ่ง Flow ก่อนรัน" />}
      {tests.length === 0 ? <div className={s.empty}>สร้างเทสเคสก่อน แล้วจึงนำมาใส่ใน Flow ได้</div> : <div className={s.canvas} data-testid="flow-canvas"><ReactFlowProvider key={flowId}><FitFlowToViewport /><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={connect} isValidConnection={(connection) => !!connection.source && !!connection.target && !hasCycle(connection.source, connection.target, edges)} fitView fitViewOptions={{ padding: 0.2 }} onInit={(instance) => { requestAnimationFrame(() => { void instance.fitView({ padding: 0.2 }); }); }} deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}><Background /><Controls /><Panel position="top-right"><span className="flow-canvas-tip">กราฟนี้บันทึกอัตโนมัติ</span></Panel></ReactFlow></ReactFlowProvider></div>}
      {runKey > 0 && <FlowRunPanel key={runKey} paths={paths} nodes={flowNodes} tests={tests} onStatus={updateStatus} onFinish={finishRun} />}
      <footer className={s.footer}>แต่ละเส้นทางเริ่มจาก node ต้นทางและรันต่อจนถึงปลายทาง · ถ้าเคสไม่ผ่าน เคสที่เหลือในเส้นทางเดียวกันจะถูกข้าม</footer>
    </> : null}
  </div>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ boxSizing: 'border-box', width: '100%', maxWidth: 1600, minHeight: '100%', padding: t.spacing(3), margin: '0 auto', display: 'flex', flexDirection: 'column', gap: t.spacing(1.5), '@media (max-width: 760px)': { padding: t.spacing(2) } }),
  header: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing(2), flexWrap: 'wrap', h1: { margin: 0 }, p: { margin: `${t.spacing(0.5)} 0 0`, color: t.colors.text.secondary } }),
  flowControls: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1), minWidth: 0, '@media (max-width: 760px)': { width: '100%', '> button': { flexShrink: 0 } } }),
  flowSelect: css({ '@media (max-width: 760px)': { flex: '1 1 0', minWidth: 0, width: 'auto !important' } }),
  toolbar: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1), flexWrap: 'wrap', '> input': { width: 240, flex: '0 1 240px' }, '@media (max-width: 760px)': { alignItems: 'stretch', '> input': { width: '100%', flex: '1 0 100%' } } }),
  spacer: css({ flex: 1 }),
  pathCount: css({ color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize, whiteSpace: 'nowrap' }),
  hint: css({ color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
  canvas: css({ position: 'relative', flex: '1 1 480px', minHeight: 440, minWidth: 0, border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, overflow: 'hidden', background: t.colors.background.canvas, '.flow-case-node': { boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column', gap: 5, width: 230, minWidth: 190, maxWidth: 250, padding: '12px 14px', color: t.colors.text.primary, background: t.colors.background.primary, border: `1px solid ${t.colors.border.medium}`, borderRadius: 8, boxShadow: t.shadows.z1, '.flow-case-kicker': { color: t.colors.text.secondary, fontSize: 10, letterSpacing: '.08em' }, strong: { fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, small: { color: t.colors.text.secondary }, '&.selected': { borderColor: t.colors.primary.border, boxShadow: `0 0 0 2px ${t.colors.primary.transparent}` }, '&.running': { borderColor: t.colors.warning.main }, '&.passed': { borderColor: t.colors.success.main }, '&.failed': { borderColor: t.colors.error.main }, '&.skipped': { opacity: 0.55 }, '.flow-node-status': { fontSize: 11, color: t.colors.text.secondary } }, '.flow-canvas-tip': { padding: '5px 8px', borderRadius: 4, fontSize: 11, color: t.colors.text.secondary, background: t.colors.background.primary, border: `1px solid ${t.colors.border.weak}` }, '.react-flow__edge-text': { fill: t.colors.text.secondary }, '.react-flow__controls': { boxShadow: t.shadows.z1, borderRadius: 4, overflow: 'hidden' }, '.react-flow__controls-button': { background: t.colors.background.primary, color: t.colors.text.primary, borderBottom: `1px solid ${t.colors.border.weak}`, svg: { fill: 'currentColor' }, '&:hover': { background: t.colors.action.hover } } }),
  empty: css({ padding: t.spacing(3), color: t.colors.text.secondary, textAlign: 'center', border: `1px dashed ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
  footer: css({ color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
});
