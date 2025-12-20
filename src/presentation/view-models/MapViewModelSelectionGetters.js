import { Vertex } from '../../domain/entities/Vertex.js'; // Vertex をインポート

export function getActiveFeature(viewModel) {
  if (!viewModel._world || !viewModel._primaryFeatureId) return null;
  // _world.features から探す
  return viewModel._world.features.find(f => f.id === viewModel._primaryFeatureId) || null;
}

export function getSelectedFeatures(viewModel) {
  if (!viewModel._world || !Array.isArray(viewModel._world.features)) return [];
  const selectedIds = viewModel._selectedFeatureIds;
  if (selectedIds.size === 0) return [];
  return viewModel._world.features.filter(f => selectedIds.has(f.id));
}

export function getSelectedVertices(viewModel) {
  if (!viewModel._world || !viewModel._world.vertices || viewModel._selectedVertexIds.size === 0) return [];
  const verticesMap = new Map(viewModel._world.vertices.map(v => [v.id, v]));
  return Array.from(viewModel._selectedVertexIds)
    .map(id => {
      const vData = verticesMap.get(id);
      // Vertexインスタンスを生成して返す
      return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
    })
    .filter(Boolean); // 見つからない頂点は除外
}
