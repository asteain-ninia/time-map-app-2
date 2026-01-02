// src/application/services/history/commands/SplitPolygonCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';
import { Polygon as DomainPolygon } from '../../../../domain/entities/Polygon.js';

export class SplitPolygonCommand {
  constructor(payload, editFeatureUseCase, worldRepository, serializer) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._worldRepository = worldRepository;
    this._serializer = serializer;
  }

  async execute() {
    const world = await this._worldRepository.getWorld();

    if (this._payload.addedVerticesData && Array.isArray(this._payload.addedVerticesData)) {
      let verticesAdded = false;
      this._payload.addedVerticesData.forEach(vData => {
        const vertexInstance = this._serializer.deserialize(vData);
        if (vertexInstance instanceof Vertex && !world.vertices.some(v => v.id === vertexInstance.id)) {
          world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
          verticesAdded = true;
        }
      });
      if (verticesAdded) {
        await this._worldRepository.saveWorld(world);
      }
    }

    const updatedPolygon = this._serializer.deserialize(this._payload.updatedPolygonData);
    const newPolygon = this._serializer.deserialize(this._payload.newPolygonData);

    if (updatedPolygon) {
      const index = world.features.findIndex(feature => feature.id === updatedPolygon.id);
      if (index !== -1) {
        world.features[index] = updatedPolygon;
      } else {
        world.features.push(updatedPolygon);
      }
    }

    if (newPolygon) {
      const index = world.features.findIndex(feature => feature.id === newPolygon.id);
      if (index !== -1) {
        world.features[index] = newPolygon;
      } else {
        world.features.push(newPolygon);
      }
    }

    await this._worldRepository.saveWorld(world);
    return {
      updatedFeature: updatedPolygon || undefined,
      addedFeature: newPolygon || undefined
    };
  }

  async reverse() {
    const world = await this._worldRepository.getWorld();
    const originalPolygon = this._serializer.deserialize(this._payload.originalPolygonData);
    const newPolygonId = this._payload.newPolygonData?.id;

    if (newPolygonId) {
      world.features = world.features.filter(feature => feature.id !== newPolygonId);
    }

    if (originalPolygon) {
      const index = world.features.findIndex(feature => feature.id === originalPolygon.id);
      if (index !== -1) {
        world.features[index] = originalPolygon;
      } else {
        world.features.push(originalPolygon);
      }
    }

    if (this._payload.addedVerticesData && Array.isArray(this._payload.addedVerticesData)) {
      const addedVertexIds = new Set(this._payload.addedVerticesData.map(v => v.id));
      const usedVertexIds = new Set();
      world.features.forEach(feature => {
        if (!feature) return;
        if (feature instanceof DomainPolygon && Array.isArray(feature.rings)) {
          feature.rings.forEach(ring => {
            if (Array.isArray(ring.vertexIds)) {
              ring.vertexIds.forEach(id => usedVertexIds.add(id));
            }
          });
          return;
        }
        if (Array.isArray(feature.vertexIds)) {
          feature.vertexIds.forEach(id => usedVertexIds.add(id));
        }
      });
      world.vertices = world.vertices.filter(vertex => {
        if (!addedVertexIds.has(vertex.id)) return true;
        return usedVertexIds.has(vertex.id);
      });
    }

    await this._worldRepository.saveWorld(world);
    return {
      updatedFeature: originalPolygon || undefined,
      deletedFeatureId: newPolygonId || undefined
    };
  }
}
