import { test, expect } from '@playwright/test';

let projectId;
test.afterEach(async ({ request }) => {
  if (projectId == null) return;
  await request.delete(`/api/projects/${projectId}`);
  projectId = undefined;
});

test('บันทึกกราฟ ตรวจ DAG และรันแต่ละ scenario จากต้นแยกกัน', async ({ page, request, baseURL }) => {
  const created = await request.post('/api/projects', { data: { name: `Flow E2E ${Date.now()}` } });
  expect(created.ok()).toBeTruthy();
  projectId = (await created.json()).id;
  const createdTest = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'เปิดหน้า demo' } });
  expect(createdTest.ok()).toBeTruthy();
  const testId = (await createdTest.json()).id;

  await page.goto(`/workspace?test=${testId}`);
  await expect(page.getByText('เชื่อมต่อแล้ว')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('เลือก action เพื่อเพิ่ม step').click();
  await page.getByRole('option', { name: 'เปิดหน้าเว็บ' }).click();
  await expect(page.getByTestId('step-item')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'URL' }).last().fill(`${baseURL}/demo-login.html`);
  await expect.poll(async () => (await request.get(`/api/tests/${testId}`)).json().then((value) => value.stepCount)).toBe(1);

  const flowResponse = await request.post(`/api/projects/${projectId}/flows`, { data: { name: 'Happy flow branches' } });
  expect(flowResponse.ok(), await flowResponse.text()).toBeTruthy();
  const flowId = (await flowResponse.json()).id;
  const nodes = [
    { id: 'first-run', type: 'testCase', testId, position: { x: 80, y: 120 } },
    { id: 'branch-a', type: 'testCase', testId, position: { x: 360, y: 20 } },
    { id: 'branch-b', type: 'testCase', testId, position: { x: 360, y: 220 } },
  ];
  const cycle = await request.patch(`/api/flows/${flowId}`, { data: { nodes, edges: [
    { id: 'edge-a', source: 'first-run', target: 'branch-a' },
    { id: 'edge-b', source: 'branch-a', target: 'first-run' },
  ] } });
  expect(cycle.status()).toBe(400);
  const saved = await request.patch(`/api/flows/${flowId}`, { data: { nodes, edges: [] } });
  expect(saved.ok()).toBeTruthy();

  await page.addInitScript((id) => localStorage.setItem('ts-project', String(id)), projectId);
  await page.goto('/flows');
  await expect(page.getByRole('heading', { name: 'Test Flow' })).toBeVisible();
  await expect(page.getByTestId('flow-canvas')).toBeVisible();
  await expect(page.locator('.flow-case-node')).toHaveCount(3);
  await expect(page.getByText('3 เส้นทาง')).toBeVisible();
  const firstSource = page.locator('.react-flow__node').nth(0).locator('.react-flow__handle-right');
  await firstSource.dragTo(page.locator('.react-flow__node').nth(1).locator('.react-flow__handle-left'));
  await firstSource.dragTo(page.locator('.react-flow__node').nth(2).locator('.react-flow__handle-left'));
  await expect(page.getByText('2 เส้นทาง')).toBeVisible();
  await expect.poll(async () => (await request.get(`/api/flows/${flowId}`)).json().then((flow) => flow.edges.length)).toBe(2);
  await page.getByRole('button', { name: 'รันทุกเส้นทาง' }).click();
  await expect(page.getByText('รัน Flow เสร็จแล้ว')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.flow-case-node.passed')).toHaveCount(3);
  await page.screenshot({ path: '/private/tmp/test-flow-desktop.png' });
  const runs = await request.get(`/api/tests/${testId}/runs`).then((response) => response.json());
  expect(runs).toHaveLength(4);
  expect(runs.every((run) => run.passed)).toBe(true);

  const failureCase = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'เคสที่ต้องล้มเหลว' } }).then((response) => response.json());
  await page.goto(`/workspace?test=${failureCase.id}`);
  await expect(page.getByText('เชื่อมต่อแล้ว')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('เลือก action เพื่อเพิ่ม step').click();
  await page.getByRole('option', { name: 'ตรวจ URL' }).click();
  await page.getByRole('textbox', { name: 'URL ที่ต้องเป็น' }).fill('https://wrong.example/');
  await expect.poll(async () => (await request.get(`/api/tests/${failureCase.id}`)).json().then((value) => value.stepCount)).toBe(1);
  const failFlowResponse = await request.post(`/api/projects/${projectId}/flows`, { data: { name: 'Skip after failure' } });
  const failFlowId = (await failFlowResponse.json()).id;
  const failNodes = [
    { id: 'failing-case', type: 'testCase', testId: failureCase.id, position: { x: 100, y: 100 } },
    { id: 'dependent-case', type: 'testCase', testId, position: { x: 400, y: 100 } },
  ];
  const failGraph = await request.patch(`/api/flows/${failFlowId}`, { data: { nodes: failNodes, edges: [{ id: 'depends', source: 'failing-case', target: 'dependent-case' }] } });
  expect(failGraph.ok()).toBeTruthy();
  await page.goto('/flows');
  await page.getByLabel('เลือก Flow').click();
  await page.getByRole('option', { name: 'Skip after failure' }).click();
  await expect(page.locator('.flow-case-node')).toHaveCount(2);
  await page.getByRole('button', { name: 'รันทุกเส้นทาง' }).click();
  await expect(page.getByText('รัน Flow เสร็จแล้ว')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.flow-case-node.failed')).toHaveCount(1);
  await expect(page.locator('.flow-case-node.skipped')).toHaveCount(1);
  const failedRuns = await request.get(`/api/tests/${failureCase.id}/runs`).then((response) => response.json());
  expect(failedRuns).toHaveLength(1);
  expect(failedRuns[0].passed).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.getByRole('complementary', { name: 'เมนูหลัก' })).toHaveCSS('width', '56px');
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="flow-canvas"]')?.getBoundingClientRect();
    const node = document.querySelector('.react-flow__node')?.getBoundingClientRect();
    return !!canvas && !!node && node.left >= canvas.left && node.right <= canvas.right;
  })).toBe(true);
  await page.screenshot({ path: '/private/tmp/test-flow-mobile.png', fullPage: true });
});
