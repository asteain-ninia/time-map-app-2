// src/presentation/views/map/SpatialIndex.js

export class SpatialIndex {
  constructor(cellSize) {
    this._cellSize = cellSize;
    this._vertexCells = new Map();
    this._edgeCells = new Map();
    this._featureCells = new Map();
  }

  get cellSize() {
    return this._cellSize;
  }

  clear() {
    this._vertexCells.clear();
    this._edgeCells.clear();
    this._featureCells.clear();
  }

  addVertex(entry) {
    this._addPoint(this._vertexCells, entry, entry.x, entry.y);
  }

  addEdge(entry, bounds) {
    this._addBox(this._edgeCells, entry, bounds);
  }

  addFeature(entry, bounds) {
    this._addBox(this._featureCells, entry, bounds);
  }

  queryVertices(point, radius) {
    return this._query(this._vertexCells, point, radius, false);
  }

  queryEdges(point, radius) {
    return this._query(this._edgeCells, point, radius, true);
  }

  queryFeatures(point, radius) {
    return this._query(this._featureCells, point, radius, true);
  }

  _addPoint(cellMap, entry, x, y) {
    const ix = this._toCellIndex(x);
    const iy = this._toCellIndex(y);
    const key = this._cellKey(ix, iy);
    let list = cellMap.get(key);
    if (!list) {
      list = [];
      cellMap.set(key, list);
    }
    list.push(entry);
  }

  _addBox(cellMap, entry, bounds) {
    if (!bounds) return;
    const minX = this._toCellIndex(bounds.minX);
    const maxX = this._toCellIndex(bounds.maxX);
    const minY = this._toCellIndex(bounds.minY);
    const maxY = this._toCellIndex(bounds.maxY);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        const key = this._cellKey(ix, iy);
        let list = cellMap.get(key);
        if (!list) {
          list = [];
          cellMap.set(key, list);
        }
        list.push(entry);
      }
    }
  }

  _query(cellMap, point, radius, dedupe) {
    if (!cellMap || !point) return [];
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
    const minX = point.x - safeRadius;
    const maxX = point.x + safeRadius;
    const minY = point.y - safeRadius;
    const maxY = point.y + safeRadius;
    const minCellX = this._toCellIndex(minX);
    const maxCellX = this._toCellIndex(maxX);
    const minCellY = this._toCellIndex(minY);
    const maxCellY = this._toCellIndex(maxY);
    const results = dedupe ? new Set() : [];

    for (let ix = minCellX; ix <= maxCellX; ix++) {
      for (let iy = minCellY; iy <= maxCellY; iy++) {
        const key = this._cellKey(ix, iy);
        const list = cellMap.get(key);
        if (!list) continue;
        for (const entry of list) {
          if (dedupe) {
            results.add(entry);
          } else {
            results.push(entry);
          }
        }
      }
    }

    return dedupe ? Array.from(results) : results;
  }

  _toCellIndex(value) {
    return Math.floor(value / this._cellSize);
  }

  _cellKey(ix, iy) {
    return `${ix}:${iy}`;
  }
}
