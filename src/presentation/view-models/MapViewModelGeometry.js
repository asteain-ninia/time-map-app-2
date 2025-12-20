import { Vertex } from '../../domain/entities/Vertex.js';

export function calculateDistance(viewModel, point1, point2, equatorLength) {
  const linearDistance = viewModel._geometryService.calculateLinearDistanceInKm(
    point1.x, point1.y, point2.x, point2.y, equatorLength
  );

  const greatCircleDistance = viewModel._geometryService.calculateGreatCircleDistance(
    point1.x, point1.y, point2.x, point2.y
  );

  return {
    linear: linearDistance,
    greatCircle: greatCircleDistance
  };
}

export function calculateGreatCirclePath(viewModel, point1, point2, segments = 32) {
  return viewModel._geometryService.calculateGreatCirclePath(
    point1.x,
    point1.y,
    point2.x,
    point2.y,
    segments
  );
}

export function calculatePolygonArea(viewModel, vertexIds, equatorLength) {
  if (!viewModel._world || !viewModel._world.vertices || !vertexIds || vertexIds.length < 3) return 0;

  const vertices = vertexIds
    .map(id => {
      const vData = viewModel._world.vertices.find(v => v.id === id);
      return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
    })
    .filter(v => v);

  if (vertices.length < 3) return 0;

  return viewModel._geometryService.calculatePolygonAreaInKm2(vertices, equatorLength);
}
