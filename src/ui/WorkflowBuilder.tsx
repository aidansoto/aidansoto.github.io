/**
 * Workflow Builder.
 *
 * A deliberately simple visual editor: drag nodes on a canvas, connect them by
 * dragging from one node's output dot to another node, and save the result as a
 * reusable template.
 *
 * Implemented with plain SVG and pointer events rather than a graph library —
 * one fewer dependency, and full control over the visual language.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useCampus } from '@/state/store';
import { Button } from './primitives';
import type { CampusDocument } from '@/core/types';
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowNodeKind } from '@/core/mission';

const NODE_W = 150;
const NODE_H = 46;

const PALETTE: Array<{ kind: WorkflowNodeKind; label: string; color: string }> = [
  { kind: 'start', label: 'Start', color: 'var(--green)' },
  { kind: 'task', label: 'Task', color: 'var(--blue)' },
  { kind: 'agent', label: 'Agent', color: 'var(--blue)' },
  { kind: 'manager', label: 'Manager', color: 'var(--gold)' },
  { kind: 'ai', label: 'AI', color: 'var(--blue-glow)' },
  { kind: 'tool', label: 'Tool', color: 'var(--silver)' },
  { kind: 'condition', label: 'Condition', color: 'var(--amber)' },
  { kind: 'wait', label: 'Wait', color: 'var(--silver)' },
  { kind: 'schedule', label: 'Schedule', color: 'var(--silver)' },
  { kind: 'approval', label: 'Approval', color: 'var(--gold)' },
  { kind: 'review', label: 'Review', color: 'var(--gold)' },
  { kind: 'revision', label: 'Revision', color: 'var(--amber)' },
  { kind: 'notification', label: 'Notification', color: 'var(--silver)' },
  { kind: 'save_output', label: 'Save Output', color: 'var(--silver)' },
  { kind: 'complete', label: 'Complete', color: 'var(--green)' },
];

const colorOf = (kind: WorkflowNodeKind): string =>
  PALETTE.find((p) => p.kind === kind)?.color ?? 'var(--silver)';

/** The default template: the review loop described in the brief. */
function starterWorkflow(): Workflow {
  const now = Date.now();
  const n = (id: string, kind: WorkflowNodeKind, label: string, x: number, y: number): WorkflowNode =>
    ({ id, kind, label, x, y, config: {} });
  return {
    id: `wf_${now.toString(36)}`,
    name: 'Create → Review → Deliver',
    description: 'Work is produced, checked by a second agent, revised if rejected, then saved and announced.',
    nodes: [
      n('n1', 'start', 'Start', 60, 40),
      n('n2', 'task', 'Task A', 60, 130),
      n('n3', 'task', 'Task B', 60, 220),
      n('n4', 'review', 'Reviewer checks work', 60, 310),
      n('n5', 'condition', 'Approved?', 60, 400),
      n('n6', 'revision', 'Revise', 280, 400),
      n('n7', 'save_output', 'Save output', 60, 490),
      n('n8', 'notification', 'Notify me', 60, 580),
      n('n9', 'complete', 'Complete', 60, 670),
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', label: null },
      { id: 'e2', from: 'n2', to: 'n3', label: null },
      { id: 'e3', from: 'n3', to: 'n4', label: null },
      { id: 'e4', from: 'n4', to: 'n5', label: null },
      { id: 'e5', from: 'n5', to: 'n7', label: 'yes' },
      { id: 'e6', from: 'n5', to: 'n6', label: 'no' },
      { id: 'e7', from: 'n6', to: 'n4', label: null },
      { id: 'e8', from: 'n7', to: 'n8', label: null },
      { id: 'e9', from: 'n8', to: 'n9', label: null },
    ],
    isTemplate: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function WorkflowBuilder(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const setDoc = useCampus((s) => s.setDoc);
  const setScreen = useCampus((s) => s.setScreen);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const mutate = useCallback(
    (fn: (d: CampusDocument) => void): void => {
      const current = useCampus.getState().doc;
      if (!current) return;
      const next: CampusDocument = { ...current };
      fn(next);
      setDoc(next);
    },
    [setDoc],
  );

  const workflows = doc?.workflows ?? [];
  const active = workflows.find((w) => w.id === activeId) ?? workflows[0] ?? null;

  const bounds = useMemo(() => {
    if (!active || active.nodes.length === 0) return { w: 900, h: 700 };
    const maxX = Math.max(...active.nodes.map((n) => n.x)) + NODE_W + 80;
    const maxY = Math.max(...active.nodes.map((n) => n.y)) + NODE_H + 80;
    return { w: Math.max(900, maxX), h: Math.max(700, maxY) };
  }, [active]);

  if (!doc) {
    return <div className="screen"><div className="screen-body"><div className="empty" style={{ padding: 60 }}>Loading…</div></div></div>;
  }

  const updateActive = (fn: (w: Workflow) => void): void => {
    if (!active) return;
    mutate((d) => {
      const w = d.workflows.find((x) => x.id === active.id);
      if (!w) return;
      fn(w);
      w.updatedAt = Date.now();
      d.workflows = [...d.workflows];
    });
  };

  const addNode = (kind: WorkflowNodeKind): void => {
    updateActive((w) => {
      const id = `n_${Date.now().toString(36)}_${w.nodes.length}`;
      w.nodes = [
        ...w.nodes,
        {
          id,
          kind,
          label: PALETTE.find((p) => p.kind === kind)?.label ?? kind,
          // Drop new nodes in a free column so they never land on top of one another.
          x: 320 + (w.nodes.length % 3) * 30,
          y: 40 + (w.nodes.length % 8) * 70,
          config: {},
        },
      ];
    });
  };

  /** Convert a pointer event to canvas coordinates, accounting for scroll. */
  const pointToCanvas = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onNodePointerDown = (e: React.PointerEvent, node: WorkflowNode): void => {
    e.stopPropagation();
    if (linkFrom) {
      // Second click of a connection: link them, unless it is a self-loop.
      if (linkFrom !== node.id) {
        updateActive((w) => {
          const exists = w.edges.some((edge) => edge.from === linkFrom && edge.to === node.id);
          if (!exists) {
            w.edges = [...w.edges, { id: `e_${Date.now().toString(36)}`, from: linkFrom, to: node.id, label: null }];
          }
        });
      }
      setLinkFrom(null);
      return;
    }
    const p = pointToCanvas(e);
    dragRef.current = { id: node.id, dx: p.x - node.x, dy: p.y - node.y };
    setSelectedNode(node.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = pointToCanvas(e);
    updateActive((w) => {
      const node = w.nodes.find((n) => n.id === drag.id);
      if (!node) return;
      node.x = Math.max(0, p.x - drag.dx);
      node.y = Math.max(0, p.y - drag.dy);
      w.nodes = [...w.nodes];
    });
  };

  const onPointerUp = (): void => {
    dragRef.current = null;
  };

  const selected = active?.nodes.find((n) => n.id === selectedNode) ?? null;

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Workflow Builder</h1>
          <p className="screen-sub">
            {workflows.length} saved · drag to move · Connect, then click two nodes to link them
          </p>
        </div>
        <div className="btn-row">
          <Button
            onClick={() => {
              const wf = starterWorkflow();
              mutate((d) => { d.workflows = [...d.workflows, wf]; });
              setActiveId(wf.id);
            }}
          >
            New Workflow
          </Button>
          <Button onClick={() => setScreen('dashboard')}>Dashboard</Button>
          <Button onClick={() => setScreen('campus')}>Back to Campus</Button>
        </div>
      </header>

      <div className="screen-body workflow-layout">
        <aside className="workflow-side">
          <div className="field-label" style={{ marginBottom: 6 }}>Workflows</div>
          {workflows.length === 0 ? (
            <div className="empty">
              No workflows yet.
              <div style={{ marginTop: 10 }}>
                <Button
                  small
                  onClick={() => {
                    const wf = starterWorkflow();
                    mutate((d) => { d.workflows = [...d.workflows, wf]; });
                    setActiveId(wf.id);
                  }}
                >
                  Create the starter template
                </Button>
              </div>
            </div>
          ) : (
            <div className="list">
              {workflows.map((w) => (
                <div
                  key={w.id}
                  className={`row${active?.id === w.id ? ' is-selected' : ''}`}
                  onClick={() => { setActiveId(w.id); setSelectedNode(null); setLinkFrom(null); }}
                >
                  <div className="row-main">
                    <div className="row-title">{w.name}</div>
                    <div className="row-sub">{w.nodes.length} nodes · {w.isTemplate ? 'template' : 'draft'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {active && (
            <>
              <div className="field-label" style={{ margin: '16px 0 6px' }}>Add node</div>
              <div className="node-palette">
                {PALETTE.map((p) => (
                  <button
                    key={p.kind}
                    type="button"
                    className="node-chip"
                    style={{ borderColor: p.color, color: p.color }}
                    onClick={() => addNode(p.kind)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {selected && (
                <>
                  <div className="field-label" style={{ margin: '16px 0 6px' }}>Selected node</div>
                  <div className="field">
                    <input
                      type="text"
                      value={selected.label}
                      onChange={(e) =>
                        updateActive((w) => {
                          const n = w.nodes.find((x) => x.id === selected.id);
                          if (n) n.label = e.target.value;
                          w.nodes = [...w.nodes];
                        })
                      }
                    />
                  </div>
                  <div className="btn-row">
                    <Button
                      small
                      active={linkFrom === selected.id}
                      onClick={() => setLinkFrom(linkFrom === selected.id ? null : selected.id)}
                    >
                      {linkFrom === selected.id ? 'Click target…' : 'Connect'}
                    </Button>
                    <Button
                      small
                      accent="red"
                      onClick={() => {
                        updateActive((w) => {
                          w.nodes = w.nodes.filter((n) => n.id !== selected.id);
                          w.edges = w.edges.filter((e) => e.from !== selected.id && e.to !== selected.id);
                        });
                        setSelectedNode(null);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}

              <div className="btn-row" style={{ marginTop: 16 }}>
                <Button
                  small
                  onClick={() => updateActive((w) => { w.isTemplate = !w.isTemplate; })}
                >
                  {active.isTemplate ? 'Unmark template' : 'Save as template'}
                </Button>
                <Button
                  small
                  accent="red"
                  onClick={() => {
                    mutate((d) => { d.workflows = d.workflows.filter((w) => w.id !== active.id); });
                    setActiveId(null);
                  }}
                >
                  Delete workflow
                </Button>
              </div>
              <p className="dash-note">
                Workflows are saved templates describing how work should flow. Missions currently
                run the Manager's own plan; wiring a template into mission execution is the next
                step for this feature.
              </p>
            </>
          )}
        </aside>

        <section className="workflow-canvas-wrap">
          {!active ? (
            <div className="empty" style={{ padding: 60 }}>Create a workflow to begin.</div>
          ) : (
            <svg
              ref={svgRef}
              className="workflow-canvas"
              width={bounds.w}
              height={bounds.h}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={() => { if (linkFrom) setLinkFrom(null); }}
            >
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--silver-dim, #5d6874)" />
                </marker>
              </defs>

              {active.edges.map((edge) => (
                <Edge key={edge.id} edge={edge} nodes={active.nodes} />
              ))}

              {active.nodes.map((node) => (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={`wf-node${selectedNode === node.id ? ' is-selected' : ''}${linkFrom === node.id ? ' is-linking' : ''}`}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                >
                  <rect width={NODE_W} height={NODE_H} rx={4} />
                  <rect width={3} height={NODE_H} rx={1.5} fill={colorOf(node.kind)} />
                  <text x={14} y={19} className="wf-node-label">{node.label}</text>
                  <text x={14} y={34} className="wf-node-kind">{node.kind.replace(/_/g, ' ')}</text>
                </g>
              ))}
            </svg>
          )}
        </section>
      </div>
    </div>
  );
}

/** An orthogonal connector between two nodes, with an optional branch label. */
function Edge({ edge, nodes }: { edge: WorkflowEdge; nodes: WorkflowNode[] }): JSX.Element | null {
  const from = nodes.find((n) => n.id === edge.from);
  const to = nodes.find((n) => n.id === edge.to);
  if (!from || !to) return null;

  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y;
  const midY = y1 + (y2 - y1) / 2;

  // A simple elbow reads more clearly than a curve on a dense board.
  const path = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;

  return (
    <g className="wf-edge">
      <path d={path} markerEnd="url(#arrow)" />
      {edge.label && (
        <text x={(x1 + x2) / 2 + 6} y={midY - 6} className="wf-edge-label">
          {edge.label}
        </text>
      )}
    </g>
  );
}
