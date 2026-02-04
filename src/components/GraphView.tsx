import { useEffect, useMemo, useState } from 'react';
import type { GraphData } from '../types';

const WIDTH = 680;
const HEIGHT = 420;

const GraphView = ({
  open,
  scope,
  activePath,
  onClose,
  onOpenNote
}: {
  open: boolean;
  scope: 'local' | 'global';
  activePath: string | null;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}) => {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (scope === 'local' && !activePath) {
      setGraph(null);
      return;
    }
    setLoading(true);
    const request =
      scope === 'local'
        ? window.vaultApi.getLocalGraph(activePath ?? '')
        : window.vaultApi.getGlobalGraph();
    request
      .then((data) => setGraph(data as GraphData))
      .finally(() => setLoading(false));
  }, [activePath, open, scope]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    if (nodes.length === 0) {
      return positions;
    }
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };
    if (scope === 'local' && activePath) {
      positions.set(activePath, center);
      const neighbors = nodes.filter((node) => node.path !== activePath);
      if (neighbors.length === 0) {
        return positions;
      }
      const radius = Math.min(WIDTH, HEIGHT) * 0.32;
      neighbors.forEach((node, index) => {
        const angle = (index / neighbors.length) * Math.PI * 2;
        positions.set(node.path, {
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius
        });
      });
      return positions;
    }
    const primaryPath = activePath && nodes.some((node) => node.path === activePath) ? activePath : null;
    if (primaryPath) {
      positions.set(primaryPath, center);
    }
    const remaining = nodes.filter((node) => node.path !== primaryPath);
    const ringSize = Math.max(8, Math.floor(Math.sqrt(remaining.length)));
    const baseRadius = Math.min(WIDTH, HEIGHT) * 0.22;
    remaining.forEach((node, index) => {
      const ringIndex = Math.floor(index / ringSize);
      const ringOffset = index % ringSize;
      const angle = (ringOffset / ringSize) * Math.PI * 2;
      const radius = baseRadius + ringIndex * 44;
      positions.set(node.path, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    });
    return positions;
  }, [activePath, nodes, scope]);

  const normalizedQuery = query.trim().toLowerCase();
  const highlightedPaths = useMemo(() => {
    if (!normalizedQuery) {
      return new Set<string>();
    }
    const matches = nodes.filter((node) => node.title.toLowerCase().includes(normalizedQuery));
    return new Set(matches.map((node) => node.path));
  }, [nodes, normalizedQuery]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal graph-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">Graph View</div>
        <div className="modal-subtitle">
          {scope === 'local'
            ? 'Local graph for the current note with 1-hop links.'
            : 'Global graph of linked notes in the vault.'}
        </div>
        {scope === 'local' && !activePath && <div className="empty">Open a note to generate its graph.</div>}
        {(scope === 'global' || activePath) && loading && <div className="empty">Loading graph…</div>}
        {(scope === 'global' || activePath) && !loading && nodes.length <= 1 && (
          <div className="empty">No linked notes yet.</div>
        )}
        {(scope === 'global' || activePath) && !loading && nodes.length > 0 && (
          <div className="graph-canvas">
            <div className="graph-toolbar">
              <input
                className="graph-search"
                placeholder="Search nodes..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%">
              {edges.map((edge) => {
                const source = layout.get(edge.from);
                const target = layout.get(edge.to);
                if (!source || !target) {
                  return null;
                }
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    className="graph-edge"
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                  />
                );
              })}
              {nodes.map((node) => {
                const position = layout.get(node.path);
                if (!position) {
                  return null;
                }
                const isActive = node.path === activePath;
                const isHighlighted = highlightedPaths.has(node.path);
                return (
                  <g
                    key={node.path}
                    className={`graph-node ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                    onClick={() => onOpenNote(node.path)}
                  >
                    <title>{`${node.title}\n${node.path}`}</title>
                    <circle cx={position.x} cy={position.y} r={isActive ? 18 : 14} />
                    {isActive && (
                      <text x={position.x} y={position.y + 34} textAnchor="middle">
                        {node.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="graph-meta">{nodes.length} nodes · {edges.length} edges</div>
          </div>
        )}
        {graph?.truncated && (
          <div className="graph-warning">
            {graph.totalNodes && graph.totalNodes > nodes.length
              ? `Showing ${nodes.length} of ${graph.totalNodes} nodes.`
              : 'Graph truncated for performance.'}
            {graph.totalEdges && graph.totalEdges > edges.length
              ? ` Showing ${edges.length} of ${graph.totalEdges} edges.`
              : ''}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default GraphView;
