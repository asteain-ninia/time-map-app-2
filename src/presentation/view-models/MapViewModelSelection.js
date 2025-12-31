import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';

export function selectFeature(viewModel, featureId, addToSelection = false) {
  if (!viewModel._world) return;

  const feature = viewModel._features.find(f => f.id === featureId);
  if (!feature) {
    if (!addToSelection && (viewModel._selectedFeatureIds.size > 0 || viewModel._selectedVertexIds.size > 0 || viewModel._vertexContextFeatureId !== null)) {
      clearSelection(viewModel);
    }
    return;
  }

  let selectionChanged = false;
  const nextSelected = addToSelection ? new Set(viewModel._selectedFeatureIds) : new Set();

  if (addToSelection) {
    if (nextSelected.has(feature.id)) {
      nextSelected.delete(feature.id);
      selectionChanged = true;
    } else {
      nextSelected.add(feature.id);
      selectionChanged = true;
    }
  } else {
    if (nextSelected.size !== 1 || !nextSelected.has(feature.id) || viewModel._primaryFeatureId !== feature.id) {
      nextSelected.clear();
      nextSelected.add(feature.id);
      selectionChanged = true;
    }
  }

  if (!selectionChanged && viewModel._selectedVertexIds.size === 0 && viewModel._vertexContextFeatureId === null) {
    return;
  }

  const previousPrimary = viewModel._primaryFeatureId;
  viewModel._selectedFeatureIds = nextSelected;
  if (viewModel._selectedFeatureIds.size > 0) {
    viewModel._primaryFeatureId = nextSelected.has(feature.id) ? feature.id : Array.from(nextSelected).pop();
  } else {
    viewModel._primaryFeatureId = null;
  }

  const hadVertices = viewModel._selectedVertexIds.size > 0;
  viewModel._selectedVertexIds.clear();
  viewModel._vertexContextFeatureId = null;
  viewModel._selectedVertexOwnerIds.clear();

  if (selectionChanged || hadVertices || previousPrimary !== viewModel._primaryFeatureId) {
    viewModel._notifyObservers('activeFeature');
    if (hadVertices) {
      viewModel._notifyObservers('selectedVertices');
    }
    viewModel._notifyObservers('vertexContextFeature');
  }
}

export function selectVertex(viewModel, vertexId, addToSelection = false) {
  if (!viewModel._world || !viewModel._world.vertices) return;

  const vertex = viewModel._world.vertices.find(v => v.id === vertexId);
  if (!vertex) {
    if (!addToSelection) {
      if (viewModel._selectedVertexIds.size > 0 || viewModel._selectedFeatureIds.size > 0 || viewModel._vertexContextFeatureId !== null) {
        clearSelection(viewModel);
      }
    }
    return;
  }

  const isVertexVisible = viewModel._features.some(f => {
    if (f instanceof DomainPolygon) {
      return f.rings?.some(ring => ring.vertexIds.includes(vertexId));
    } else if (f instanceof DomainLine || f instanceof DomainPoint) {
      return f.vertexIds?.includes(vertexId);
    }
    return false;
  });
  if (!isVertexVisible) {
    console.warn(`Vertex ${vertexId} is not part of any currently visible feature. Selection denied.`);
    if (!addToSelection) {
      clearSelection(viewModel);
    }
    return;
  }

  let vertexSelectionChanged = false;
  const newSelectedVertexIds = addToSelection ? new Set(viewModel._selectedVertexIds) : new Set();

  if (addToSelection) {
    if (newSelectedVertexIds.has(vertexId)) {
      newSelectedVertexIds.delete(vertexId);
      vertexSelectionChanged = true;
    } else {
      newSelectedVertexIds.add(vertexId);
      vertexSelectionChanged = true;
    }
  } else {
    if (!newSelectedVertexIds.has(vertexId) || newSelectedVertexIds.size !== 1) {
      newSelectedVertexIds.clear();
      newSelectedVertexIds.add(vertexId);
      vertexSelectionChanged = true;
    }
  }

  if (vertexSelectionChanged || viewModel._selectedFeatureIds.size > 0 || viewModel._vertexContextFeatureId !== null) {
    const hadFeatures = viewModel._selectedFeatureIds.size > 0;

    viewModel._selectedVertexIds = newSelectedVertexIds;

    if (viewModel._selectedVertexIds.size > 0) {
      viewModel._selectedFeatureIds.clear();
      viewModel._primaryFeatureId = null;
    }

    const contextChanged = applyVertexSelectionContext(viewModel);

    viewModel._notifyObservers('selectedVertices');

    if (hadFeatures) {
      viewModel._notifyObservers('activeFeature');
    }
    if (contextChanged) {
      viewModel._notifyObservers('vertexContextFeature');
    }
  }
}

export function applyVertexSelectionContext(viewModel) {
  const analysis = analyzeVertexSelection(viewModel, viewModel._selectedVertexIds);
  const previousContextId = viewModel._vertexContextFeatureId;

  viewModel._vertexContextFeatureId = analysis.uniqueOwnerId;
  viewModel._selectedVertexOwnerIds = new Set(analysis.ownerIds);

  return previousContextId !== viewModel._vertexContextFeatureId;
}

export function analyzeVertexSelection(viewModel, vertexIds) {
  if (!vertexIds || vertexIds.size === 0) {
    return { uniqueOwnerId: null, ownerIds: new Set() };
  }

  const ownerIds = new Set();

  vertexIds.forEach(vertexId => {
    const owners = findOwningFeatureIdsForVertex(viewModel, vertexId);
    owners.forEach(ownerId => ownerIds.add(ownerId));
  });

  let uniqueOwnerId = null;
  if (ownerIds.size === 1) {
    uniqueOwnerId = ownerIds.values().next().value;
  }

  return { uniqueOwnerId, ownerIds };
}

export function findOwningFeatureIdsForVertex(viewModel, vertexId) {
  const ownerIds = [];
  if (!vertexId) return ownerIds;

  for (const feature of viewModel._features) {
    if (!feature) continue;
    if (feature instanceof DomainPolygon) {
      if (feature.rings?.some(ring => ring.vertexIds.includes(vertexId))) {
        ownerIds.push(feature.id);
      }
    } else if (feature instanceof DomainLine || feature instanceof DomainPoint) {
      if (Array.isArray(feature.vertexIds) && feature.vertexIds.includes(vertexId)) {
        ownerIds.push(feature.id);
      }
    }
  }

  return ownerIds;
}

export function clearSelection(viewModel) {
  const changedFeature = viewModel._selectedFeatureIds.size > 0;
  const changedVertices = viewModel._selectedVertexIds.size > 0;
  const changedHighlight = viewModel._vertexContextFeatureId !== null;

  viewModel._selectedFeatureIds.clear();
  viewModel._primaryFeatureId = null;
  viewModel._selectedVertexIds.clear();
  viewModel._vertexContextFeatureId = null;
  viewModel._selectedVertexOwnerIds.clear();

  if (changedFeature) {
    viewModel._notifyObservers('activeFeature');
  }
  if (changedVertices) {
    viewModel._notifyObservers('selectedVertices');
  }
  if (changedHighlight) {
    viewModel._notifyObservers('vertexContextFeature');
  }
}

export function hoverFeature(viewModel, featureId) {
  if (!viewModel._world) return;

  const feature = featureId ? viewModel._features.find(f => f.id === featureId) : null;
  if (viewModel._hoveredFeature !== feature) {
    viewModel._hoveredFeature = feature || null;
    viewModel._notifyObservers('hoveredFeature');
  }
}

export function hoverVertex(viewModel, vertexId) {
  if (!viewModel._world || !viewModel._world.vertices) return;

  const vertex = vertexId ? viewModel._world.vertices.find(v => v.id === vertexId) : null;
  if (viewModel._hoveredVertex !== vertex) {
    viewModel._hoveredVertex = vertex ? { id: vertex.id, x: vertex.x, y: vertex.y } : null;
    viewModel._notifyObservers('hoveredVertex');
  }
}
