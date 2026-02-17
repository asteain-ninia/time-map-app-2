// src/presentation/views/map/MapViewRendererHelper.js

import { Point as DomainPoint } from '../../../domain/entities/Point.js';
import { Line as DomainLine } from '../../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js';
import { editingStyles } from '../../../infrastructure/rendering/RenderStyleProvider.js';
import { buildPolygonFillLoopSets } from './polygonFillUtils.js';

/**
 * MapView における描画補助（選択、プレビュー、測定など）を担当
 */
export class MapViewRendererHelper {
  /**
   * @param {SVGRenderer} renderer
   * @param {MapViewModel} viewModel
   * @param {EditingViewModel} editingViewModel
   * @param {ViewportManager} viewportManager
   * @param {ConfigManager} configManager
   */
  constructor(renderer, viewModel, editingViewModel, viewportManager, configManager) {
    this._renderer = renderer;
    this._viewModel = viewModel;
    this._editingViewModel = editingViewModel;
    this._viewportManager = viewportManager;
    this._configManager = configManager; // configManager は赤道長以外の設定でまだ使われる可能性があるため残す

    this._selectionElements = []; // 選択要素の描画物
    this._dragPreviewElements = []; // ドラッグプレビュー描画物
    this._addingElements = []; // 追加中プレビュー描画物
    this._measureElements = []; // 測定描画物
    this._temporaryElements = []; // 汎用一時要素描画物
    this._persistentVertexElements = []; // 常時表示する頂点マーカー
    this._splitOverlayElements = []; // 分割ツール用のオーバーレイ
    this._dragPreviewCache = null; // ドラッグプレビューの事前計算キャッシュ
  }

  /**
   * 全ての一時描画をクリア
   */
  clearAllTemporaryDrawings() {
      this.clearSplitOverlay();
      this.clearPersistentVertexMarkers();
      this.clearSelectionHighlights();
      this.clearDragPreviews();
      this.clearAddingFeaturePreview();
      this.clearMeasureElements();
      this.clearGenericTemporaryElements();
  }

  /** 分割ツール用オーバーレイをクリア */
  clearSplitOverlay() {
    this._splitOverlayElements.forEach(el => this._renderer.removeElement(el));
    this._splitOverlayElements = [];
  }

  /** 分割ツール用オーバーレイのみ更新 */
  renderSplitOverlayOnly() {
    this.clearSplitOverlay();
    const viewport = this._viewportManager.getViewport();
    if (!viewport) return;
    const world = this._viewModel.getWorld();
    if (!world || !world.vertices) return;
    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const splitTargetPolygon = this._editingViewModel.getTargetPolygon();
    if (mode !== 'edit' || tool !== 'split' || !splitTargetPolygon) {
      return;
    }
    const viewBoxWidth = viewport.width / viewport.zoom;
    const viewBoxHeight = viewport.height / viewport.zoom;
    const left = viewport.x - viewBoxWidth / 2;
    const right = viewport.x + viewBoxWidth / 2;
    const bottom = viewport.y - viewBoxHeight / 2;
    const top = viewport.y + viewBoxHeight / 2;
    const overlayLoop = [
      { x: left, y: bottom },
      { x: right, y: bottom },
      { x: right, y: top },
      { x: left, y: top }
    ];
    const overlayElem = this._renderer.drawPolygonLoops([overlayLoop], editingStyles.splitOverlay, viewport);
    if (overlayElem) {
      overlayElem.classList.add('temp-drawing', 'selection-highlight');
      this._splitOverlayElements.push(overlayElem);
    }
  }

  /** 選択ハイライトを描画 */
  renderSelection() {
    this.clearPersistentVertexMarkers();
    this.clearSelectionHighlights();
    const selectedFeatureIds = typeof this._viewModel.getSelectedFeatureIds === 'function'
      ? this._viewModel.getSelectedFeatureIds()
      : new Set();
    const selectedVertexIds = this._viewModel.getSelectedVertexIds(); // Set<string>
    const vertexContextFeatureId = this._viewModel.getVertexSelectionContextId();
    const vertexOwnerIds = this._viewModel.getVertexSelectionOwnerIds();
    const visibleFeatures = this._viewModel.getFeatures();
    const viewport = this._viewportManager.getViewport();
    const world = this._viewModel.getWorld();
    const currentTime = this._getCurrentTime();
    if (!world || !world.vertices || !viewport) return;
    const draggingVerticesInfo = this._editingViewModel.getDraggingVerticesInfo(); // Map<string, {originalPosition, currentPosition}>
    const visibleVertexIds = this._collectVisibleVertexIds(visibleFeatures, currentTime);

    this.renderSplitOverlayOnly();

    const shouldRenderPersistentMarkers = this._shouldRenderPersistentVertexMarkers(visibleVertexIds);
    const hasSelection = selectedFeatureIds.size > 0
      || selectedVertexIds.size > 0
      || draggingVerticesInfo.size > 0
      || Boolean(vertexContextFeatureId)
      || (vertexOwnerIds && vertexOwnerIds.size > 0);

    if (!shouldRenderPersistentMarkers && !hasSelection) {
      return;
    }

    const sharedVertexIds = this._collectSharedVertexIds(visibleFeatures, currentTime);
    const verticesMap = new Map(world.vertices.map(v => [v.id, v])); // {id, x, y} のマップ

    const worldWidth = this._renderer.getWorldWidth();
    const finalOffsets = typeof this._renderer.getRenderOffsets === 'function'
      ? this._renderer.getRenderOffsets(viewport)
      : [0, -worldWidth, worldWidth];

    if (shouldRenderPersistentMarkers) {
      this._renderPersistentVertexMarkers(verticesMap, visibleVertexIds, selectedVertexIds, draggingVerticesInfo, sharedVertexIds, viewport, finalOffsets);
    }

    // 通常頂点マーカーのスタイル
    const normalVertexStyle = editingStyles.normalVertex;
    const sharedVertexStyle = editingStyles.sharedVertex || normalVertexStyle;
    const getVertexMarkerStyle = (vertexId) => sharedVertexIds.has(vertexId) ? sharedVertexStyle : normalVertexStyle;

    // ドラッグ中でない頂点の元の位置を取得する関数
    const getOriginalVertexPosIfNeitherSelectedNorDragged = (vertexId) => {
        if (selectedVertexIds.has(vertexId)) return null; // 主選択頂点ならここでは描画しない
        if (draggingVerticesInfo.has(vertexId)) return null; // ドラッグ中頂点もここでは描画しない
        return verticesMap.get(vertexId); // {id, x, y}
    };

    const renderFeatureSelection = (feature) => {
        const style = editingStyles.selectedOutline;
        const featureVertexIds = this._getFeatureVertexIdsAtTime(feature, currentTime);
        const featureRings = this._getFeatureRingsAtTime(feature, currentTime);
        for (const offsetX of finalOffsets) {
            if (feature instanceof DomainPoint) {
                const pointVertexId = featureVertexIds[0] || null;
                const vData = pointVertexId ? verticesMap.get(pointVertexId) : null;
                if (vData && !selectedVertexIds.has(vData.id) && !draggingVerticesInfo.has(vData.id)) {
                    const elem = this._renderer.drawPoint(vData.x + offsetX, vData.y, editingStyles.selectedPointOutline, viewport);
                    if (elem) this._selectionElements.push(elem);
                }
            } else if (feature instanceof DomainLine) {
                const linePoints = featureVertexIds.map(id => {
                    const v = verticesMap.get(id);
                    return v ? { x: v.x + offsetX, y: v.y } : null;
                }).filter(Boolean);
                if (linePoints.length >= 2) {
                    const elem = this._renderer.drawLine(linePoints, style, viewport);
                    if (elem) this._selectionElements.push(elem);
                }
                featureVertexIds.forEach(id => {
                    const vData = getOriginalVertexPosIfNeitherSelectedNorDragged(id);
                    if (vData) {
                        const markerStyle = getVertexMarkerStyle(id);
                        const marker = this._renderer.drawPoint(vData.x + offsetX, vData.y, markerStyle, viewport);
                        if (marker) this._selectionElements.push(marker);
                    }
                });
            } else if (feature instanceof DomainPolygon) {
                if (featureRings && featureRings.length > 0) {
                    if (editingStyles.selectedPolygonFill && editingStyles.selectedPolygonFill.fill !== 'none') {
                        const loopSets = buildPolygonFillLoopSets({ rings: featureRings }, verticesMap, offsetX);
                        for (const loops of loopSets) {
                            const fillElem = this._renderer.drawPolygonLoops(loops, editingStyles.selectedPolygonFill, viewport);
                            if (fillElem) this._selectionElements.push(fillElem);
                        }
                    }
                    featureRings.forEach(ring => {
                         const ringPoints = ring.vertexIds.map(id => {
                             const v = verticesMap.get(id);
                             return v ? { x: v.x + offsetX, y: v.y } : null;
                         }).filter(Boolean);
                         if (ringPoints.length >= 3) {
                             const elem = this._renderer.drawLine([...ringPoints, ringPoints[0]], style, viewport);
                             if (elem) this._selectionElements.push(elem);
                         }
                         ring.vertexIds.forEach(id => {
                             const vData = getOriginalVertexPosIfNeitherSelectedNorDragged(id);
                             if (vData) {
                                 const markerStyle = getVertexMarkerStyle(id);
                                 const marker = this._renderer.drawPoint(vData.x + offsetX, vData.y, markerStyle, viewport);
                                 if (marker) this._selectionElements.push(marker);
                             }
                         });
                    });
                }
            }
        }
    };

    // 選択地物 (複数対応)
    const selectedFeatures = visibleFeatures.filter(f => selectedFeatureIds.has(f.id) && f.existsAt(currentTime));
    selectedFeatures.forEach(feature => renderFeatureSelection(feature));

    const renderContextFeature = (featureId) => {
        if (!featureId || selectedFeatureIds.has(featureId)) return;
        const feature = visibleFeatures.find(f => f.id === featureId);
        if (!feature || !feature.existsAt(currentTime)) return;
        const style = editingStyles.highlightOutline;
        const featureVertexIds = this._getFeatureVertexIdsAtTime(feature, currentTime);
        const featureRings = this._getFeatureRingsAtTime(feature, currentTime);

        for (const offsetX of finalOffsets) {
            if (feature instanceof DomainLine) {
                const linePoints = featureVertexIds.map(id => {
                    const v = verticesMap.get(id);
                    return v ? { x: v.x + offsetX, y: v.y } : null;
                }).filter(Boolean);
                if (linePoints.length >= 2) {
                    const elem = this._renderer.drawLine(linePoints, style, viewport);
                    if (elem) this._selectionElements.push(elem);
                }
            } else if (feature instanceof DomainPolygon) {
                if (featureRings && featureRings.length > 0) {
                    if (editingStyles.highlightPolygonFill && editingStyles.highlightPolygonFill.fill !== 'none') {
                        const loopSets = buildPolygonFillLoopSets({ rings: featureRings }, verticesMap, offsetX);
                        for (const loops of loopSets) {
                            const fillElem = this._renderer.drawPolygonLoops(loops, editingStyles.highlightPolygonFill, viewport);
                            if (fillElem) this._selectionElements.push(fillElem);
                        }
                    }
                    featureRings.forEach(ring => {
                        const ringPoints = ring.vertexIds.map(id => {
                            const v = verticesMap.get(id);
                            return v ? { x: v.x + offsetX, y: v.y } : null;
                        }).filter(Boolean);
                        if (ringPoints.length >= 3) {
                            const elem = this._renderer.drawLine([...ringPoints, ringPoints[0]], style, viewport);
                            if (elem) this._selectionElements.push(elem);
                        }
                    });
                }
            }

            if (selectedVertexIds.size > 0 || draggingVerticesInfo.size > 0) {
                if (feature instanceof DomainLine) {
                    featureVertexIds.forEach(id => {
                        const vData = getOriginalVertexPosIfNeitherSelectedNorDragged(id);
                        if (vData) {
                            const markerStyle = getVertexMarkerStyle(id);
                            const marker = this._renderer.drawPoint(vData.x + offsetX, vData.y, markerStyle, viewport);
                            if (marker) this._selectionElements.push(marker);
                        }
                    });
                } else if (feature instanceof DomainPolygon) {
                    if (featureRings && featureRings.length > 0) {
                        featureRings.forEach(ring => {
                            ring.vertexIds.forEach(id => {
                                const vData = getOriginalVertexPosIfNeitherSelectedNorDragged(id);
                                if (vData) {
                                    const markerStyle = getVertexMarkerStyle(id);
                                    const marker = this._renderer.drawPoint(vData.x + offsetX, vData.y, markerStyle, viewport);
                                    if (marker) this._selectionElements.push(marker);
                                }
                            });
                        });
                    }
                }
            }
        }
    };

    renderContextFeature(vertexContextFeatureId);
    vertexOwnerIds.forEach(ownerId => {
        if (!ownerId || ownerId === vertexContextFeatureId) return;
        renderContextFeature(ownerId);
    });
    // 主選択頂点 (これは他のマーカーより手前に描画されるべきなので、最後に描画する)
    selectedVertexIds.forEach(vertexId => {
        const vData = verticesMap.get(vertexId); // 主選択頂点の現在の位置
        if (vData) {
            for (const offsetX of finalOffsets) { // オフセットループ
                // オフセットを適用したワールド座標で描画
                const selectedStyle = sharedVertexIds.has(vertexId) && editingStyles.selectedSharedVertex
                  ? editingStyles.selectedSharedVertex
                  : editingStyles.selectedVertex;
                const elem = this._renderer.drawPoint(vData.x + offsetX, vData.y, selectedStyle, viewport);
                if (elem) this._selectionElements.push(elem);
            }
        }
    });
    this._selectionElements.forEach(el => el.classList.add('temp-drawing', 'selection-highlight'));
  }

  /** 選択ハイライトをクリア */
  clearSelectionHighlights() {
    this._selectionElements.forEach(el => this._renderer.removeElement(el));
    this._selectionElements = [];
  }

  /** ドラッグ中のプレビューを描画 */
  renderDragPreview() {
    this.clearDragPreviews();
    const draggingVerticesInfo = this._editingViewModel.getDraggingVerticesInfo();
    const pendingVertexAdditionInfo = this._editingViewModel.getPendingVertexAdditionInfo();
    if (draggingVerticesInfo.size === 0) {
      this._dragPreviewCache = null;
      return;
    }

    const world = this._viewModel.getWorld();
    const viewport = this._viewportManager.getViewport();
    const currentTime = this._getCurrentTime();
    if (!world || !world.vertices) return; // verticesの存在チェック追加
    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
    const worldWidth = this._renderer.getWorldWidth();

    const finalOffsets = typeof this._renderer.getRenderOffsets === 'function'
      ? this._renderer.getRenderOffsets(viewport)
      : [0, -worldWidth, worldWidth];
    const snapWorldDistance = this._getSharedVertexSnapDistanceWorld(viewport);
    const sharePreviewVertexIds = typeof this._editingViewModel.getSharePreviewVertexIds === 'function'
      ? this._editingViewModel.getSharePreviewVertexIds({
          world,
          visibleFeatures: typeof this._viewModel.getFeatures === 'function' ? this._viewModel.getFeatures() : [],
          worldWidth,
          snapWorldDistance
        })
      : new Set();
    const sharePreviewStyle = editingStyles.dragShareVertex || editingStyles.dragVertex;

    // ドラッグ中の頂点マーカー (各オフセットで描画)
    for (const [vertexId, info] of draggingVerticesInfo.entries()) {
        for (const offsetX of finalOffsets) { // オフセットループ
            // オフセットを適用したワールド座標で描画
            const markerStyle = sharePreviewVertexIds.has(vertexId) ? sharePreviewStyle : editingStyles.dragVertex;
            const marker = this._renderer.drawPoint(info.currentPosition.x + offsetX, info.currentPosition.y, markerStyle, viewport);
            if (marker) this._dragPreviewElements.push(marker);
        }
    }

    // 影響を受ける地物の仮形状 (各オフセットで描画)
    const draggedVertexIds = new Set(draggingVerticesInfo.keys());
    const draggedVertexIdsArray = Array.from(draggedVertexIds);
    const dragKey = draggedVertexIdsArray.slice().sort().join('|');
    const pendingKey = pendingVertexAdditionInfo
      ? `${pendingVertexAdditionInfo.featureId}:${pendingVertexAdditionInfo.ringId || ''}:${pendingVertexAdditionInfo.segmentStartVertexId}:${pendingVertexAdditionInfo.segmentEndVertexId}:${pendingVertexAdditionInfo.newVertexId}`
      : '';

    let affectedFeatures = null;
    if (
      this._dragPreviewCache &&
      this._dragPreviewCache.world === world &&
      this._dragPreviewCache.features === world.features &&
      this._dragPreviewCache.dragKey === dragKey &&
      this._dragPreviewCache.pendingKey === pendingKey
    ) {
      affectedFeatures = this._dragPreviewCache.affectedFeatures;
    } else {
      affectedFeatures = new Map(); // 重複を避けるためにMapを使用
      // 1. 通常のドラッグ対象の地物を探す
      world.features.forEach(f => {
        const featureVertexIds = this._getFeatureVertexIdsAtTime(f, currentTime);
        const isAffected = draggedVertexIdsArray.some(draggedId => {
          return featureVertexIds.includes(draggedId);
        });
        if (isAffected) {
          affectedFeatures.set(f.id, f);
        }
      });

      // 2. 保留中の線上点追加がある場合、その地物も対象に加える
      if (pendingVertexAdditionInfo) {
        const feature = world.features.find(f => f.id === pendingVertexAdditionInfo.featureId);
        if (feature && !affectedFeatures.has(feature.id)) {
          affectedFeatures.set(feature.id, feature);
        }
      }

      this._dragPreviewCache = {
        world,
        features: world.features,
        dragKey,
        pendingKey,
        affectedFeatures
      };
    }

    const getVertexPosWithOffset = (vertexId, offsetX) => {
        const dragInfo = draggingVerticesInfo.get(vertexId);
        if (dragInfo) return { x: dragInfo.currentPosition.x + offsetX, y: dragInfo.currentPosition.y };
        const v = verticesMap.get(vertexId);
        return v ? { x: v.x + offsetX, y: v.y } : null;
    };

    affectedFeatures.forEach(feature => {
        const style = editingStyles.dragOutline;
        const featureVertexIds = this._getFeatureVertexIdsAtTime(feature, currentTime);
        const featureRings = this._getFeatureRingsAtTime(feature, currentTime);
        for (const offsetX of finalOffsets) {
            if (feature instanceof DomainLine) {
                let originalVertexIds = [...featureVertexIds];
                if (pendingVertexAdditionInfo && pendingVertexAdditionInfo.featureId === feature.id) {
                    const { segmentStartVertexId, segmentEndVertexId, newVertexId } = pendingVertexAdditionInfo;
                    const startIndex = originalVertexIds.indexOf(segmentStartVertexId);
                    const endIndex = originalVertexIds.indexOf(segmentEndVertexId);
                    if (startIndex !== -1 && endIndex !== -1 && Math.abs(startIndex - endIndex) === 1) {
                        const insertBeforeIndex = Math.max(startIndex, endIndex);
                        originalVertexIds.splice(insertBeforeIndex, 0, newVertexId);
                    }
                }
                const lineVertices = originalVertexIds.map(id => getVertexPosWithOffset(id, offsetX)).filter(Boolean);
                if (lineVertices.length >= 2) {
                    const elem = this._renderer.drawLine(lineVertices, style, viewport);
                    if (elem) this._dragPreviewElements.push(elem);
                }
            } else if (feature instanceof DomainPolygon) {
                if (featureRings && featureRings.length > 0) {
                    featureRings.forEach(ring => {
                        let originalVertexIds = [...ring.vertexIds];
                        if (pendingVertexAdditionInfo && pendingVertexAdditionInfo.featureId === feature.id && pendingVertexAdditionInfo.ringId === ring.id) {
                            const { segmentStartVertexId, segmentEndVertexId, newVertexId } = pendingVertexAdditionInfo;
                            const startIndex = originalVertexIds.indexOf(segmentStartVertexId);
                            const endIndex = originalVertexIds.indexOf(segmentEndVertexId);

                            let insertBeforeIndex = -1;
                            if ((startIndex + 1) % originalVertexIds.length === endIndex) { // 正順
                                insertBeforeIndex = endIndex;
                            } else if ((endIndex + 1) % originalVertexIds.length === startIndex) { // 逆順
                                insertBeforeIndex = startIndex;
                            }
                            
                            if (insertBeforeIndex !== -1) {
                                originalVertexIds.splice(insertBeforeIndex, 0, newVertexId);
                            }
                        }
                        const vertices = originalVertexIds.map(id => getVertexPosWithOffset(id, offsetX)).filter(Boolean);
                        if (vertices.length >= 3) {
                            // 閉じた線を描画
                            const elem = this._renderer.drawLine([...vertices, vertices[0]], style, viewport);
                            if (elem) this._dragPreviewElements.push(elem);
                        }
                    });
                }
            }
        }
    });
    this._dragPreviewElements.forEach(el => el.classList.add('temp-drawing', 'drag-preview'));
  }

  /** ドラッグプレビューをクリア */
  clearDragPreviews() {
    this._dragPreviewElements.forEach(el => this._renderer.removeElement(el));
    this._dragPreviewElements = [];
  }

  /** 追加中のプレビューを描画 */
    renderAddingFeaturePreview() {
      this.clearAddingFeaturePreview();
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const subMode = this._editingViewModel.getAddingSubMode();
      const splitLineMode = typeof this._editingViewModel.getSplitLineMode === 'function'
        ? this._editingViewModel.getSplitLineMode()
        : 'open';
      const isSplit = mode === 'edit' && tool === 'split' && this._editingViewModel.getTargetPolygon();
      if (!((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && this._editingViewModel.getTargetPolygon()) || isSplit)) {
          return;
      }
      const addingPoints = this._editingViewModel.getAddingPoints();
      if (addingPoints.length === 0) return;
      const viewport = this._viewportManager.getViewport();

      const pointStyle = editingStyles.addingPointPreview;
    let lineStyle = {};
    if (mode === 'add') {
        lineStyle = tool === 'line' ? editingStyles.linePreviewForLine
                  : tool === 'polygon' ? editingStyles.linePreviewForPolygon
                  : {};
    } else if (mode === 'edit' && tool === 'add-hole') {
        lineStyle = subMode === 'hole' ? editingStyles.linePreviewHole
                  : subMode === 'enclave' ? editingStyles.linePreviewEnclave
                  : editingStyles.linePreviewPending; // サブモード未決定時
      } else if (mode === 'edit' && tool === 'split') {
          lineStyle = editingStyles.linePreviewSplit;
      }
      
      if (isSplit && splitLineMode === 'open' && addingPoints.length >= 1) {
        const radiusPixels = this._getSplitCircleRadiusPixels();
        const circleStyle = { ...editingStyles.splitCircle, radius: radiusPixels };
        const circle = this._renderer.drawPoint(addingPoints[0].x, addingPoints[0].y, circleStyle, viewport);
        if (circle) this._addingElements.push(circle);
      }

      // 追加中のプレビューは、通常ワールドの端をまたいで作成することは想定しづらいため、
      // オフセット描画は行わない (常にオフセット0で描画)
      // もし必要であれば、SVGRenderer と同様のオフセットロジックをここにも追加する
    // 現状はオフセットなしで描画

    if (tool === 'point') {
        if (addingPoints.length === 1) {
            const elem = this._renderer.drawPoint(addingPoints[0].x, addingPoints[0].y, editingStyles.addingToolPoint, viewport);
            if (elem) this._addingElements.push(elem);
        }
    } else if (tool === 'line' || tool === 'polygon' || tool === 'add-hole' || tool === 'split') {
        // 線または閉じた形状のプレビュー
        if (addingPoints.length >= 2) {
          const isClosedShape = (tool === 'polygon')
            || (mode === 'edit' && tool === 'add-hole')
            || (mode === 'edit' && tool === 'split' && splitLineMode === 'circle');
          // 閉じる形状の場合、3点以上で最初の点に戻る線を描画
          const pointsToDraw = isClosedShape && addingPoints.length >= 3
                                   ? [...addingPoints, addingPoints[0]]
                                   : addingPoints;
            if (Object.keys(lineStyle).length > 0) {
                 const elem = this._renderer.drawLine(pointsToDraw, lineStyle, viewport);
                 if (elem) this._addingElements.push(elem);
            }
        }
    }
    // 追加中の各点を描画
    for (const point of addingPoints) {
       const elem = this._renderer.drawPoint(point.x, point.y, pointStyle, viewport);
       if (elem) this._addingElements.push(elem);
    }
    this._addingElements.forEach(el => el.classList.add('temp-drawing', 'adding-feature'));
  }

  /** 追加中プレビューをクリア */
  clearAddingFeaturePreview() {
    this._addingElements.forEach(el => this._renderer.removeElement(el));
    this._addingElements = [];
  }

  /** 距離測定を描画 */
  renderDistanceMeasurement(measurePoints, isMeasuring) {
    this.clearMeasureElements();
    if (measurePoints.length === 0) return;

    const viewport = this._viewportManager.getViewport();
    const finalOffsets = typeof this._renderer.getRenderOffsets === 'function'
      ? this._renderer.getRenderOffsets(viewport)
      : [0, -this._renderer.getWorldWidth(), this._renderer.getWorldWidth()];

    measurePoints.forEach((point, index) => {
        for (const offsetX of finalOffsets) {
            const pointElem = this._renderer.drawPoint(point.x + offsetX, point.y, editingStyles.measurePoint, viewport);
            if (pointElem) this._measureElements.push(pointElem);
        }
        const labelElem = this._renderer.drawText(point.x, point.y + 10 / viewport.zoom, String.fromCharCode(65 + index), editingStyles.measureLabel, viewport);
        if(labelElem) this._measureElements.push(labelElem);
    });

    if (measurePoints.length >= 2) {
        for (const offsetX of finalOffsets) {
            const offsetPoints = measurePoints.map(p => ({ x: p.x + offsetX, y: p.y }));
            const lineElem = this._renderer.drawLine(offsetPoints, editingStyles.measureLine, viewport);
            if (lineElem) this._measureElements.push(lineElem);
        }

        // 大圏コースを追加描画
        const gcPoints = [];
        for (let i = 1; i < measurePoints.length; i++) {
            const segment = this._viewModel.calculateGreatCirclePath(measurePoints[i - 1], measurePoints[i]);
            if (gcPoints.length > 0) segment.shift();
            gcPoints.push(...segment);
        }
        if (gcPoints.length >= 2) {
            const unwrappedGcPoints = this._unwrapLongitudeSequence(gcPoints);
            for (const offsetX of finalOffsets) {
                const offsetGcPoints = unwrappedGcPoints.map(p => ({ x: p.x + offsetX, y: p.y }));
                const gcElem = this._renderer.drawLine(offsetGcPoints, editingStyles.greatCircleLine, viewport);
                if (gcElem) this._measureElements.push(gcElem);
            }
        }

        // 赤道長を MapViewModel から取得
        const equatorLength = this._viewModel.getEquatorLength(); 
        let totalLinear = 0;
        let totalGreatCircle = 0;

        for (let i = 1; i < measurePoints.length; i++) {
            const p1 = measurePoints[i - 1];
            const p2 = measurePoints[i];
            const distance = this._viewModel.calculateDistance(p1, p2, equatorLength);
            totalLinear += distance.linear;
            totalGreatCircle += distance.greatCircle;
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const segmentLabelElem = this._renderer.drawText(midX, midY - 10 / viewport.zoom, `${distance.linear.toFixed(1)}km`, editingStyles.measureSegmentLabel, viewport);
            if(segmentLabelElem) this._measureElements.push(segmentLabelElem);
        }

        const lastPoint = measurePoints[measurePoints.length - 1];
        const textYOffset = 15 / viewport.zoom;
        const totalLinearElem = this._renderer.drawText(lastPoint.x + 10 / viewport.zoom, lastPoint.y + textYOffset * 2, `直線計: ${totalLinear.toFixed(1)} km`, editingStyles.totalLabel, viewport);
        if(totalLinearElem) this._measureElements.push(totalLinearElem);
        const totalGreatCircleElem = this._renderer.drawText(lastPoint.x + 10 / viewport.zoom, lastPoint.y + textYOffset, `大円計: ${totalGreatCircle.toFixed(1)} km`, editingStyles.totalLabel, viewport);
        if(totalGreatCircleElem) this._measureElements.push(totalGreatCircleElem);
    }
    this._measureElements.forEach(el => el.classList.add('temp-drawing', 'measure-element'));
  }

  /** 持続的な頂点マーカーをクリア */
  clearPersistentVertexMarkers() {
    this._persistentVertexElements.forEach(el => this._renderer.removeElement(el));
    this._persistentVertexElements = [];
  }

  /** 持続的な頂点マーカーを描画 */
  _renderPersistentVertexMarkers(verticesMap, visibleVertexIds, selectedVertexIds, draggingVerticesInfo, sharedVertexIds, viewport, offsets) {
    const passiveStyle = editingStyles.persistentVertex || editingStyles.normalVertex;
    const sharedVertexStyle = editingStyles.sharedVertex || passiveStyle;
    const selectedSet = selectedVertexIds instanceof Set ? selectedVertexIds : new Set(selectedVertexIds || []);
    const draggingSet = draggingVerticesInfo instanceof Map ? new Set(draggingVerticesInfo.keys()) : new Set();
    if (!visibleVertexIds || visibleVertexIds.size === 0) return;

    const markerLimit = this._getPersistentVertexMarkerLimit();
    if (markerLimit <= 0) return;
    if (Number.isFinite(markerLimit) && visibleVertexIds.size > markerLimit) return;

    const addMarker = (vertexId) => {
      if (!vertexId) return;
      if (selectedSet.has(vertexId) || draggingSet.has(vertexId)) return;
      const vertex = verticesMap.get(vertexId);
      if (!vertex) return;
      const markerStyle = sharedVertexIds && sharedVertexIds.has(vertexId) ? sharedVertexStyle : passiveStyle;
      for (const offsetX of offsets) {
        const elem = this._renderer.drawPoint(vertex.x + offsetX, vertex.y, markerStyle, viewport);
        if (elem) {
          this._selectionElements.push(elem);
          this._persistentVertexElements.push(elem);
        }
      }
    };

    visibleVertexIds.forEach(addMarker);
  }

  /** 測定描画物をクリア */
  clearMeasureElements() {
    this._measureElements.forEach(el => this._renderer.removeElement(el));
    this._measureElements = [];
  }

  /** 汎用一時要素を描画 */
  renderGenericTemporaryElements() {
    this.clearGenericTemporaryElements();
    const elements = this._editingViewModel.getTemporaryElements();
    const viewport = this._viewportManager.getViewport();
    // 汎用一時要素も、現状オフセット描画は不要と判断。

    elements.forEach(element => {
        let elem = null;
        if (element.type === 'point') {
            elem = this._renderer.drawPoint(element.x, element.y, element.style, viewport);
        } else if (element.type === 'line') {
            elem = this._renderer.drawLine(element.points, element.style, viewport);
        } else if (element.type === 'text') {
             elem = this._renderer.drawText(element.x, element.y, element.content, element.style, viewport);
        }
        if (elem) {
             elem.classList.add('temp-drawing', 'temp-element');
             this._temporaryElements.push(elem);
        }
    });
  }

  /** 汎用一時要素をクリア */
  clearGenericTemporaryElements() {
    this._temporaryElements.forEach(el => this._renderer.removeElement(el));
    this._temporaryElements = [];
    // ViewModel側のクリアはViewModelが行う想定
    // this._editingViewModel.clearTemporaryElements();
  }

  _getCurrentTime() {
    if (!this._viewModel || typeof this._viewModel.getCurrentTime !== 'function') {
      return null;
    }
    return this._viewModel.getCurrentTime();
  }

  _getFeatureRingsAtTime(feature, timePoint = this._getCurrentTime()) {
    if (!(feature instanceof DomainPolygon)) {
      return [];
    }
    if (typeof feature.getRingsAt === 'function') {
      const ringsAtTime = feature.getRingsAt(timePoint);
      return Array.isArray(ringsAtTime) ? ringsAtTime : [];
    }
    return Array.isArray(feature.rings) ? feature.rings : [];
  }

  _getFeatureVertexIdsAtTime(feature, timePoint = this._getCurrentTime()) {
    if (feature instanceof DomainPolygon) {
      const ids = new Set();
      const rings = this._getFeatureRingsAtTime(feature, timePoint);
      rings.forEach(ring => {
        if (Array.isArray(ring.vertexIds)) {
          ring.vertexIds.forEach(id => ids.add(id));
        }
      });
      return Array.from(ids);
    }
    if (feature instanceof DomainLine && typeof feature.getVertexIdsAt === 'function') {
      const lineVertexIds = feature.getVertexIdsAt(timePoint);
      return Array.isArray(lineVertexIds) ? lineVertexIds : [];
    }
    if (feature instanceof DomainPoint && typeof feature.getVertexIdAt === 'function') {
      const pointVertexId = feature.getVertexIdAt(timePoint);
      return typeof pointVertexId === 'string' ? [pointVertexId] : [];
    }
    if (Array.isArray(feature?.vertexIds)) {
      return feature.vertexIds;
    }
    if (typeof feature?.vertexId === 'string') {
      return [feature.vertexId];
    }
    return [];
  }

  _collectVisibleVertexIds(features, timePoint = this._getCurrentTime()) {
    const ids = new Set();
    if (!features || features.length === 0) {
      return ids;
    }
    for (const feature of features) {
      if (!feature) continue;
      this._getFeatureVertexIdsAtTime(feature, timePoint).forEach(id => ids.add(id));
    }
    return ids;
  }

  _shouldRenderPersistentVertexMarkers(visibleVertexIds) {
    if (!visibleVertexIds || visibleVertexIds.size === 0) {
      return false;
    }
    const markerLimit = this._getPersistentVertexMarkerLimit();
    if (markerLimit <= 0) return false;
    if (!Number.isFinite(markerLimit)) return true;
    return visibleVertexIds.size <= markerLimit;
  }

  _getPersistentVertexMarkerLimit() {
    const rawLimit = this._configManager && typeof this._configManager.get === 'function'
      ? this._configManager.get('ui.persistentVertexMarkerLimit', 10000)
      : 10000;
    if (!Number.isFinite(rawLimit)) {
      return 10000;
    }
    return Math.max(0, rawLimit);
  }

  _collectSharedVertexIds(features, timePoint = this._getCurrentTime()) {
    const usage = new Map();
    if (!features || features.length === 0) {
      return new Set();
    }

    features.forEach(feature => {
      if (!feature) return;
      const ids = new Set(this._getFeatureVertexIdsAtTime(feature, timePoint));
      ids.forEach(id => {
        const count = usage.get(id) || 0;
        usage.set(id, count + 1);
      });
    });

    const shared = new Set();
    usage.forEach((count, id) => {
      if (count > 1) shared.add(id);
    });
    return shared;
  }

    _getSharedVertexSnapDistanceWorld(viewport) {
      const snapPixels = this._configManager && typeof this._configManager.get === 'function'
        ? this._configManager.get('ui.sharedVertexSnapPixels', 50)
        : 50;
    if (!Number.isFinite(snapPixels) || snapPixels <= 0) {
      return null;
    }
    if (!viewport || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      return null;
    }
      return snapPixels / viewport.zoom;
    }

    _getSplitCircleRadiusPixels() {
      const radiusPixels = this._configManager && typeof this._configManager.get === 'function'
        ? this._configManager.get('ui.splitCircleRadiusPixels', 40)
        : 40;
      if (!Number.isFinite(radiusPixels) || radiusPixels <= 0) {
        return 40;
      }
      return radiusPixels;
    }

  _unwrapLongitudeSequence(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return [];
    }

    const result = [{ x: points[0].x, y: points[0].y }];
    let previousLongitude = points[0].x;
    let wrapOffset = 0;

    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      if (!point) {
        continue;
      }

      let adjustedLongitude = point.x + wrapOffset;
      const delta = adjustedLongitude - previousLongitude;

      if (delta > 180) {
        wrapOffset -= 360;
        adjustedLongitude = point.x + wrapOffset;
      } else if (delta < -180) {
        wrapOffset += 360;
        adjustedLongitude = point.x + wrapOffset;
      }

      previousLongitude = adjustedLongitude;
      result.push({ x: adjustedLongitude, y: point.y });
    }

    return result;
  }
}
