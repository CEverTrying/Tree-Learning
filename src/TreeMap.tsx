import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import { LockKeyhole } from "lucide-react";
import { kindLabel, lineage, subtreeIds, type TreeData } from "./model";
import { nodeIcons } from "./TreePanel";
import "@xyflow/react/dist/style.css";

type MapData = {
  title: string;
  kind: keyof typeof nodeIcons;
  active: boolean;
  onPath: boolean;
  sealed: boolean;
};
function MapNode({ data }: NodeProps<Node<MapData>>) {
  const Icon = nodeIcons[data.kind];
  return (
    <div
      className={`map-node ${data.active ? "active" : ""} ${data.onPath ? "on-path" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className={`map-kind kind-${data.kind}`}>
        <Icon size={15} />
        {kindLabel[data.kind]}
        {data.sealed && <LockKeyhole size={12} />}
      </div>
      <strong>{data.title}</strong>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { topic: MapNode };
export default function TreeMap({
  data,
  projectId,
  selectedId,
  select,
}: {
  data: TreeData;
  projectId: string;
  selectedId: string;
  select: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const ancestors = new Set(lineage(data, selectedId).map((n) => n.id));
    const ids = subtreeIds(data, projectId);
    const projectNodes = data.nodes.filter((node) => ids.has(node.id));
    const children = new Map<string, string[]>();
    projectNodes.forEach((n) => {
      if (n.parentId)
        children.set(n.parentId, [...(children.get(n.parentId) || []), n.id]);
    });
    const positions = new Map<string, { x: number; y: number }>();
    const stack = [{ id: projectId, depth: 0, visited: false }];
    let row = 0;
    while (stack.length) {
      const item = stack.pop()!;
      const ids = children.get(item.id) || [];
      if (!item.visited && ids.length) {
        stack.push({ ...item, visited: true });
        [...ids]
          .reverse()
          .forEach((id) =>
            stack.push({ id, depth: item.depth + 1, visited: false }),
          );
      } else
        positions.set(item.id, {
          x: item.depth * 300,
          y: ids.length
            ? (positions.get(ids[0])!.y + positions.get(ids.at(-1)!)!.y) / 2
            : row++ * 120,
        });
    }
    const nodes: Node<MapData>[] = projectNodes.map((n) => ({
      id: n.id,
      type: "topic",
      position: positions.get(n.id)!,
      data: {
        title: n.title,
        kind: n.kind,
        active: n.id === selectedId,
        onPath: ancestors.has(n.id),
        sealed: !!children.get(n.id)?.length,
      },
    }));
    const edges: Edge[] = projectNodes
      .filter((n) => n.parentId && ids.has(n.parentId))
      .map((n) => ({
        id: n.id,
        source: n.parentId!,
        target: n.id,
        type: "smoothstep",
        style: {
          stroke: ancestors.has(n.id) ? "#398167" : "#d2d8d5",
          strokeWidth: ancestors.has(n.id) ? 2 : 1.4,
        },
      }));
    return { nodes, edges };
  }, [data, selectedId, projectId]);
  return (
    <div className="tree-map">
      <ReactFlow
        key={projectId}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => select(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#d2d9d5" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
