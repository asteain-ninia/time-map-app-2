// src/presentation/views/map/MapViewRendererHelper.js

import { Point as DomainPoint } from '../../../domain/entities/Point.js';
import { Line as DomainLine } from '../../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js';
import { editingStyles } from '../../../infrastructure/rendering/RenderStyleProvider.js';

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
  }

  /**
   * 全ての一時描画をクリア
   */
  clearAllTemporaryDrawings() {
      this.clearSelectionHighlights();
      this.clearDragPreviews();
      this.clearAddingFeaturePreview();
      this.clearMeasureElements();
      this.clearGenericTemporaryElements();
  }

  /** 選択ハイライトを描画 */
  renderSelection() {
    this.clearSelectionHighlights();
    const selectedFeatureId = this._viewModel.getSelectedFeatureId();
    const selectedVertexIds = this._viewModel.getSelectedVertexIds(); // Set<string>
    const highlightedFeatureId = this._viewModel.getHighlightedFeatureId();
    const viewport = this._viewportManager.getViewport();
    const world = this._viewModel.getWorld();
    const currentTime = this._viewModel.getCurrentTime();
    if (!world || !world.vertices) return;
    const draggingVerticesInfo = this._editingViewModel.getDraggingVerticesInfo(); // Map<string, {originalPosition, currentPosition}>
    const verticesMap = new Map(world.vertices.map(v => [v.id, v])); // {id, x, y} のマップ

    const worldWidth = this._renderer.getWorldWidth();
    const finalOffsets = [0, -worldWidth, worldWidth];

    // 通常頂点マーカーのスタイル
    const normalVertexStyle = editingStyles.normalVertex;

    // ドラッグ中でない頂点の元の位置を取得する関数
    const getOriginalVertexPosIfNeitherSelectedNorDragged = (vertexId) => {
        if (selectedVertexIds.has(vertexId)) return null; // 主選択頂点ならここでは描画しない
        if (draggingVerticesInfo.has(vertexId)) return null; // ドラッグ中頂点もここでは描画しない
        return verticesMap.get(vertexId); // {id, x, y}
    };

    // 主選択地物
    if (selectedFeatureId) {
        const feature = this._viewModel.getFeatures().find(f => f.id === selectedFeatureId);
        if (feature && feature.existsAt(currentTime)) {
            const style = editingStyles.selectedOutline;
            for (const offsetX of finalOffsets) {
                if (feature instanceof DomainPoint) {
                    const vData = verticesMap.get(feature.vertexId); // Points always have original data for this
                    if (vData && !selectedVertexIds.has(vData.id) && !draggingVerticesInfo.has(vData.id)) { // Only draw if not specially handled
                        const elem = this._renderer.drawPoint(vData.x + offsetX, vData.y, editingStyles.selectedPointOutline, viewport);
                        if (elem) this._selectionElements.push(elem);
                    }
                } else if (feature instanceof DomainLine) {
                    const linePoints = feature.vertexIds.map(id => {
                        const v = verticesMap.get(id); // Always use current data for path
                        return v ? { x: v.x + offsetX, y: v.y } : null;
                    }).filter(Boolean);
                    if (linePoints.length >= 2) {
                        const elem = this._renderer.drawLine(linePoints, style, viewport);
                        if (elem) this._selectionElements.push(elem);
                    }
                    // 通常頂点マーカー
                    feature.vertexIds.forEach(id => {
                        const vData = getOriginalVertexPosIfNeitherSelectedNorDragged(id);
                        if (vData) {
                            const marker = this._renderer.drawPoint(vData.x + offsetX, vData.y, normalVertexStyle, viewport);
                            if (marker) this._selectionElements.push(marker);
                        }
                    });
                } else if (feature instanceof DomainPolygon) {
                    if (feature.rings && Array.isArray(feature.rings)) {
                        feature.rings.forEach(ring => {
                             const ringPoints = ring.vertexIds.map(id => {
                                 const v = verticesMap.get(id); // Always use current data for path
                                 return v ? { x: v.x + offsetX, y: v.y } : null;
                             }).filter(Boolean);
                             if (ringPoints.length >= 3) {
                                 const elem = this._renderer.drawLine([...ringPoints, ringPoints[0]], style, viewport);
                                 if (elem) this._selectionElements.push(elem);
                             }
                             // 通常頂点マーカー
                             ring.vertexIds.forEach(id => {
                                 const vData = getOriginalVertexPosIfNeitherSelectedNorDragged(id);
                                 if (vData) {
                                     const marker = this._renderer.drawPoint(vData.x + offsetX, vData.y, normalVertexStyle, viewport);
                                     if (marker) this._selectionElements.push(marker);
                                 }
                             });
                        });
                    }
                }
            }
        }
    }
    // 暗黙ハイライト地物
    if (highlightedFeatureId && highlightedFeatureId !== selectedFeatureId) {
        const feature = this._viewModel.getFeatures().find(f => f.id === highlightedFeatureId);
        if (feature && feature.existsAt(currentTime)) {
            const style = editingStyles.highlightOutline;
            for (const offsetX of finalOffsets) {
                if (feature instanceof DomainLine) {
                     const linePoints = feature.vertexIds.map(id => {
                        const v = verticesMap.get(id);
                        return v ? { x: v.x + offsetX, y: v.y } : null;
                    }).filter(Boolean);
                    if (linePoints.length >= 2) {
                        const elem = this._renderer.drawLine(linePoints, style, viewport);
                        if (elem) this._selectionElements.push(elem);
                    }
                } else if (feature instanceof DomainPolygon) {
                     if (feature.rings && Array.isArray(feature.rings)) {
                        feature.rings.forEach(ring => {
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
            }
        }
    }
    // 主選択頂点 (これは他のマーカーより手前に描画されるべきなので、最後に描画する)
    selectedVertexIds.forEach(vertexId => {
        const vData = verticesMap.get(vertexId); // 主選択頂点の現在の位置
        if (vData) {
            for (const offsetX of finalOffsets) { // オフセットループ
                // オフセットを適用したワールド座標で描画
                const elem = this._renderer.drawPoint(vData.x + offsetX, vData.y, editingStyles.selectedVertex, viewport);
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
    if (draggingVerticesInfo.size === 0) return;

    const world = this._viewModel.getWorld();
    const viewport = this._viewportManager.getViewport();
    if (!world || !world.vertices) return; // verticesの存在チェック追加
    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));

    const worldWidth = this._renderer.getWorldWidth(); // ワールド幅を取得
    const finalOffsets = [0, -worldWidth, worldWidth]; // 常に3つのオフセットで描画

    // ドラッグ中の頂点マーカー (各オフセットで描画)
    for (const [vertexId, info] of draggingVerticesInfo.entries()) {
        for (const offsetX of finalOffsets) { // オフセットループ
            // オフセットを適用したワールド座標で描画
            const marker = this._renderer.drawPoint(info.currentPosition.x + offsetX, info.currentPosition.y, editingStyles.dragVertex, viewport);
            if (marker) this._dragPreviewElements.push(marker);
        }
    }

    // 影響を受ける地物の仮形状 (各オフセットで描画)
    const draggedVertexIds = new Set(draggingVerticesInfo.keys());
    // world.features 全体を対象に影響を受ける地物を探す
    const affectedFeatures = world.features.filter(f => Array.from(draggedVertexIds).some(draggedId => {
        const isPolygon = f instanceof DomainPolygon; // インスタンスで判定
        // リングベースで判定
        return (f.vertexIds && f.vertexIds.includes(draggedId)) || // Point, Line
               (isPolygon && f.rings?.some(ring => ring.vertexIds.includes(draggedId))); // Polygon
    }));

    const getVertexPosWithOffset = (vertexId, offsetX) => { // offsetX を引数に追加
        const dragInfo = draggingVerticesInfo.get(vertexId);
        // ドラッグ中の頂点はドラッグ先の currentPosition を使用、それ以外は元の位置
        if (dragInfo) return { x: dragInfo.currentPosition.x + offsetX, y: dragInfo.currentPosition.y };
        const v = verticesMap.get(vertexId);
        return v ? { x: v.x + offsetX, y: v.y } : null;
    };

    affectedFeatures.forEach(feature => {
        const style = editingStyles.dragOutline;
        for (const offsetX of finalOffsets) { // オフセットループ
            if (feature instanceof DomainLine) {
                const lineVertices = feature.vertexIds.map(id => getVertexPosWithOffset(id, offsetX)).filter(Boolean);
                if (lineVertices.length >= 2) {
                    const elem = this._renderer.drawLine(lineVertices, style, viewport);
                    if (elem) this._dragPreviewElements.push(elem);
                }
            } else if (feature instanceof DomainPolygon) {
                // リングベースで仮形状を描画
                if (feature.rings && Array.isArray(feature.rings)) {
                    feature.rings.forEach(ring => {
                        const vertices = ring.vertexIds.map(id => getVertexPosWithOffset(id, offsetX)).filter(Boolean);
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
    if (!((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && this._editingViewModel.getTargetPolygon()))) {
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
    } else if (tool === 'line' || tool === 'polygon' || tool === 'add-hole') {
        // 線または閉じた形状のプレビュー
        if (addingPoints.length >= 2) {
            const isClosedShape = (tool === 'polygon') || (mode === 'edit' && tool === 'add-hole');
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
    if (!isMeasuring || measurePoints.length === 0) return;

    const viewport = this._viewportManager.getViewport();
    // 距離測定のプレビューも、通常ワールドの端をまたいで行うことは稀なので、
    // オフセット描画は行わない。

    measurePoints.forEach((point, index) => {
        const pointElem = this._renderer.drawPoint(point.x, point.y, editingStyles.measurePoint, viewport);
        if (pointElem) this._measureElements.push(pointElem);
        const labelElem = this._renderer.drawText(point.x, point.y + 10 / viewport.zoom, String.fromCharCode(65 + index), editingStyles.measureLabel, viewport);
        if(labelElem) this._measureElements.push(labelElem);
    });

    if (measurePoints.length >= 2) {
        const lineElem = this._renderer.drawLine(measurePoints, editingStyles.measureLine, viewport);
        if (lineElem) this._measureElements.push(lineElem);

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
}