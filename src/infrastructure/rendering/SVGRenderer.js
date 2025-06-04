// src/infrastructure/rendering/SVGRenderer.js

import { Point } from '../../domain/entities/Point.js';
import { Line } from '../../domain/entities/Line.js';
import { Polygon } from '../../domain/entities/Polygon.js';
import { applyFeatureMethods } from './SVGRendererFeatures.js';

/**
 * SVGベースの地図レンダリング
 */
export class SVGRenderer {
  /**
   * レンダラーを作成
   * @param {HTMLElement} container - SVG要素を配置するコンテナ
   * @param {Object} [options={}] - レンダリングオプション (グリッド関連は削除)
   */
  constructor(container, options = {}) {
    this._container = container;
    this._svg = null;
    this._defs = null;
    this._mainGroup = null;
    this._gridGroup = null;
    this._featuresGroup = null;
    this._backgroundGroup = null; // 背景グループの参照を追加
    this._originalBackgroundContent = null; // 元の背景SVG内容を保持
    this._backgroundCopies = [null, null, null]; // [left, center, right]
    this._backgroundTransform = { // 背景の基準変換情報
        scaleX: 1,
        scaleY: 1,
        translateX: 0,
        translateY: 0,
        worldWidth: 360, // ワールド座標系での背景地図の幅 (経度360度分)
        worldHeight: 180, // ワールド座標系での背景地図の高さ (緯度180度分)
    };


    this._options = {
      width: options.width || 800,
      height: options.height || 600,
      padding: options.padding || 10,
      // gridColor, gridOpacity, gridInterval は削除 (プロジェクト設定から渡される)
      showGrid: true, // グリッド表示状態 (これはUIトグル用なので残す)
      ...options
    };

    this._initSVG();
  }

  /**
   * SVG要素の初期化
   * @private
   */
  _initSVG() {
    // SVG要素を作成
    this._svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._svg.setAttribute("width", this._options.width);
    this._svg.setAttribute("height", this._options.height);
    this._svg.setAttribute("viewBox", `0 0 ${this._options.width} ${this._options.height}`);
    this._svg.style.display = "block";
    this._svg.style.position = "absolute";  // 絶対配置に
    this._svg.style.top = "0";              // 上端に配置
    this._svg.style.left = "0";             // 左端に配置
    this._svg.style.zIndex = "5";           // オーバーレイより下に配置

    // グループ要素を作成
    this._defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    this._svg.appendChild(this._defs);

    this._mainGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._mainGroup.setAttribute("class", "main-group");
    this._svg.appendChild(this._mainGroup);

    // 背景グループを最初に作成し、参照を保持
    this._backgroundGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._backgroundGroup.setAttribute("class", "background-map");
    this._backgroundGroup.setAttribute("pointer-events", "none"); // クリックイベントを拾わないように
    this._mainGroup.appendChild(this._backgroundGroup); // メイングループの最初の子として挿入

    // 背景コピー用のプレースホルダーグループを作成
    for (let i = 0; i < 3; i++) {
        const copyGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        copyGroup.setAttribute("class", `background-copy-${i}`);
        this._backgroundGroup.appendChild(copyGroup);
        this._backgroundCopies[i] = copyGroup; // 参照を保持
    }

    this._gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._gridGroup.setAttribute("class", "grid-group");
    this._mainGroup.appendChild(this._gridGroup); // グリッドは背景の上

    this._featuresGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._featuresGroup.setAttribute("class", "features-group");
    this._mainGroup.appendChild(this._featuresGroup); // 地物はグリッドの上

    // コンテナに追加
    this._container.appendChild(this._svg);
  }

  /**
   * SVG要素のサイズを変更
   * @param {number} width - 新しい幅
   * @param {number} height - 新しい高さ
   */
  resize(width, height) {
    this._options.width = width;
    this._options.height = height;

    this._svg.setAttribute("width", width);
    this._svg.setAttribute("height", height);
    // viewBox は render メソッドで更新されるため、ここでは更新しない
  }

  /**
 * 地図を描画
 * @param {Object} world - 世界データ
 * @param {Object} viewport - ビューポート情報 { x, y, zoom, width, height }
 * @param {TimePoint} currentTime - 現在の時間点
 * @param {Object} projectSettings - プロジェクト設定 (グリッド設定などを含む)
 */
render(world, viewport, currentTime, projectSettings) {
  // console.log('SVGRenderer.render 開始');
  // console.log('ビューポート情報:', viewport);
  // console.log('プロジェクト設定:', projectSettings);


  // SVG要素の viewBox を更新
  // SVG要素の viewBox を更新して、パン・ズーム機能を実現
  // viewBoxを使うことで、SVG内の要素の座標変換が自動的に行われる
  const viewBoxWidth = viewport.width / viewport.zoom;
  const viewBoxHeight = viewport.height / viewport.zoom;
  const viewBoxX = viewport.x - viewBoxWidth / 2;
  // viewBoxのY座標もY軸下向き正として計算
  const viewBoxY = -viewport.y - viewBoxHeight / 2; // ワールド座標のYを反転

  // viewBox属性を更新
  this._svg.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
  // console.log('SVG viewBox 更新:', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);

  // 背景を描画 (再生成せず、Transformのみ更新)
  this._renderBackground(viewport);

  // グリッドを描画 (projectSettingsからグリッド設定を渡す)
  if (this._options.showGrid && projectSettings && projectSettings.gridInterval) {
      const gridSettings = {
          interval: projectSettings.gridInterval,
          color: projectSettings.gridColor,
          opacity: projectSettings.gridOpacity
      };
      this._renderGrid(viewport, gridSettings);
  } else {
      // グリッド非表示または設定がない場合はクリア
      while (this._gridGroup.firstChild) {
        this._gridGroup.removeChild(this._gridGroup.firstChild);
      }
  }


  // 地物を描画
  this._clearFeatures();

  // レイヤーを順序でソート
  const sortedLayers = [...world.layers].sort((a, b) => a.order - b.order);
  // console.log('レイヤー数:', sortedLayers.length);

  // レイヤーごとに地物を描画
  for (const layer of sortedLayers) {
    if (!layer.visible) continue;

    const layerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layerGroup.setAttribute("class", `layer-${layer.id}`);
    layerGroup.style.opacity = layer.opacity;

    // このレイヤーに属する地物をフィルタリング
    const layerFeatures = world.features.filter(f =>
      f.layerId === layer.id && f.existsAt(currentTime) // 修正: Feature.existsAt を使用
    );

    // console.log(`レイヤー ${layer.name} の地物数:`, layerFeatures.length);

    // 地物を種類別に分けて描画順序を制御
    const polygons = layerFeatures.filter(f => f instanceof Polygon);
    const lines = layerFeatures.filter(f => f instanceof Line);
    const points = layerFeatures.filter(f => f instanceof Point);

    // console.log(`ポリゴン:${polygons.length}, ライン:${lines.length}, ポイント:${points.length}`);

    // 面 → 線 → 点の順で描画
    for (const polygon of polygons) {
      const element = this._renderPolygon(polygon, world.vertices, currentTime, viewport); // currentTime を渡す
      if (element) {
        layerGroup.appendChild(element);
      }
    }

    for (const line of lines) {
      const element = this._renderLine(line, world.vertices, currentTime, viewport); // currentTime を渡す
      if (element) {
        layerGroup.appendChild(element);
      }
    }

    for (const point of points) {
      const element = this._renderPoint(point, world.vertices, currentTime, viewport); // currentTime を渡す
      if (element) {
        layerGroup.appendChild(element);
      }
    }

    this._featuresGroup.appendChild(layerGroup);
  }

  // console.log('SVGRenderer.render 完了');
  }

  /**
   * 地物要素をクリア
   * @private
   */
  _clearFeatures() {
    while (this._featuresGroup.firstChild) {
      this._featuresGroup.removeChild(this._featuresGroup.firstChild);
    }
  }

  /**
   * 背景地図を描画（Transform属性のみ更新）
   * @param {Object} viewport - ビューポート情報
   * @private
   */
  _renderBackground(viewport) {
    // 元のコンテンツがない、またはコピーが準備できていない場合は何もしない
    if (!this._originalBackgroundContent || !this._backgroundCopies[0] || this._backgroundCopies[0].childNodes.length === 0) {
        return;
    }

    const worldWidth = this._backgroundTransform.worldWidth; // 360
    const { scaleX, scaleY, translateX, translateY } = this._backgroundTransform;

    // ビューポートの中心に最も近い地図の中心オフセットを計算
    const baseOffset = Math.round(viewport.x / worldWidth) * worldWidth;

    // 描画するオフセットのインデックスと対応するコピー要素
    const copiesToUpdate = [
        { index: -1, element: this._backgroundCopies[0] }, // Left
        { index: 0,  element: this._backgroundCopies[1] }, // Center
        { index: 1,  element: this._backgroundCopies[2] }  // Right
    ];

    // 各コピーのTransform属性を更新
    for (const copyInfo of copiesToUpdate) {
        const offsetX = baseOffset + copyInfo.index * worldWidth;
        // transform属性を計算して設定
        // translate(offsetX + 固定translateX, 固定translateY) scale(固定scaleX, 固定scaleY)
        const transformString = `translate(${offsetX + translateX} ${translateY}) scale(${scaleX} ${scaleY})`;
        copyInfo.element.setAttribute('transform', transformString);
    }
  }

/**
 * グリッドを描画
 * @param {Object} viewport - ビューポート情報
 * @param {Object} gridSettings - グリッド設定 { interval, color, opacity }
 * @private
 */
_renderGrid(viewport, gridSettings) {
  // グリッドをクリア
  while (this._gridGroup.firstChild) {
    this._gridGroup.removeChild(this._gridGroup.firstChild);
  }

  // グリッド非表示設定の場合は描画しない (renderメソッド側で制御済みだが念のため)
  if (!this._options.showGrid) return;
  // gridSettings が不正な場合も描画しない
  if (!gridSettings || typeof gridSettings.interval !== 'number' || gridSettings.interval <= 0) {
      console.warn("SVGRenderer: Invalid gridSettings provided to _renderGrid.", gridSettings);
      return;
  }

  const { x, y, zoom, width, height } = viewport;

  // viewBoxの範囲を計算 (ワールド座標)
  const viewBoxWidth = width / zoom;
  const viewBoxHeight = height / zoom;
  const left = x - viewBoxWidth / 2;
  const right = x + viewBoxWidth / 2;
  const top = y + viewBoxHeight / 2; // ワールド座標の上端 (緯度が高い方)
  const bottom = y - viewBoxHeight / 2; // ワールド座標の下端 (緯度が低い方)

  // グリッド間隔（度単位）- 引数から取得
  const gridInterval = gridSettings.interval;
  const gridColor = gridSettings.color || "#cccccc";
  const gridOpacity = gridSettings.opacity !== undefined ? gridSettings.opacity : 0.5;


  // 緯度・経度の描画範囲を計算 (ワールド座標)
  const latMin = Math.max(-90, Math.floor(bottom / gridInterval) * gridInterval);
  const latMax = Math.min(90, Math.ceil(top / gridInterval) * gridInterval);
  const lonMinGrid = Math.floor(left / gridInterval) * gridInterval;
  const lonMaxGrid = Math.ceil(right / gridInterval) * gridInterval;


  // 線の太さ（ズームに応じて細くする）
  const strokeWidth = 1 / zoom;

  // ラベルのフォントサイズ（画面上でのサイズが一定になるように）
  const baseFontSize = 10; // 基準フォントサイズ
  // fontSize を 1/zoom でスケールし、最小・最大値を設定
  const fontSize = Math.max(5 / zoom, Math.min(16 / zoom, baseFontSize / zoom));

  // 緯線（横線）を描画
  for (let lat = latMin; lat <= latMax; lat += gridInterval) {
    const isEquator = Math.abs(lat) < 0.001;
    const svgY = -lat; // Y座標を反転してSVG座標に

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", left); // 線はビューボックスの左右端まで
    line.setAttribute("y1", svgY);
    line.setAttribute("x2", right);
    line.setAttribute("y2", svgY);
    line.setAttribute("stroke", isEquator ? "#ff0000" : gridColor);
    line.setAttribute("stroke-width", (isEquator ? 2 : 1) * strokeWidth);
    line.setAttribute("opacity", gridOpacity);
    line.setAttribute("pointer-events", "none");
    this._gridGroup.appendChild(line);

    // 緯度ラベル（画面左端に表示）
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", left + 2 * strokeWidth); // 左端からのオフセット
    // ラベルを線の少し「上」(SVG座標ではYが小さい方)に表示
    text.setAttribute("y", svgY - 2 * strokeWidth);
    text.setAttribute("font-size", fontSize); // ズームに応じたフォントサイズ
    text.setAttribute("fill", gridColor);
    text.setAttribute("text-anchor", "start"); // 左揃え
    // ベースラインを文字の上に合わせる (hanging)
    text.setAttribute("dominant-baseline", "alphabetic"); //hanging");
    text.setAttribute("pointer-events", "none");
    text.textContent = `${Math.abs(lat)}°${lat > 0 ? 'N' : (lat < 0 ? 'S' : '')}`;
    this._gridGroup.appendChild(text);
  }

  // 経線（縦線）を描画
  // SVG座標の上下端を計算
  const svgTopY = -top;
  const svgBottomY = -bottom;

  for (let lng = lonMinGrid; lng <= lonMaxGrid; lng += gridInterval) {
      let currentLng = lng;
      // 経度を -180 から 180 の範囲に正規化 (ラベル表示用)
      let normalizedLng = ((currentLng + 180) % 360 + 360) % 360 - 180;


      // 本初子午線（0度）と日付変更線（+/-180度）は強調表示
      const isPrimeMeridian = Math.abs(normalizedLng) < 0.001;
      const isDateLine = Math.abs(Math.abs(normalizedLng) - 180) < 0.001;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", lng);
      line.setAttribute("y1", svgTopY);   // SVG座標の上端
      line.setAttribute("x2", lng);
      line.setAttribute("y2", svgBottomY); // SVG座標の下端
      line.setAttribute("stroke", isPrimeMeridian || isDateLine ? "#ff0000" : gridColor);
      line.setAttribute("stroke-width", (isPrimeMeridian || isDateLine ? 2 : 1) * strokeWidth);
      line.setAttribute("opacity", gridOpacity);
      // クリックイベントを無効化
      line.setAttribute("pointer-events", "none");

      this._gridGroup.appendChild(line);

      // 経度ラベル（画面上端に表示）
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", lng); // オフセット削除、中央揃えのため
      // Y座標を fontSize に応じて調整 (hanging baseline なので、y座標がテキストの上端)
      text.setAttribute("y", svgTopY + 2 * strokeWidth);
      text.setAttribute("font-size", fontSize); //  ズームに応じたフォントサイズ
      text.setAttribute("fill", gridColor);
      text.setAttribute("text-anchor", "middle"); //  中央揃え
      text.setAttribute("dominant-baseline", "hanging"); // 上揃え
      text.setAttribute("pointer-events", "none");

      let labelLng = Math.abs(normalizedLng);
      if (labelLng === 180) labelLng = 180;
      text.textContent = `${labelLng}°${normalizedLng > 0 && normalizedLng !== 180 ? 'E' : (normalizedLng < 0 && normalizedLng !== -180 ? 'W' : '')}`;
      this._gridGroup.appendChild(text);
  }
}

  /**
   * ワールド座標系での地図の幅を取得 (経度360度分など)
   * @returns {number} ワールド幅
   */
  getWorldWidth() {
    return this._backgroundTransform.worldWidth || 360; // フォールバック
  }

  /**
   * ビューポートのviewBoxパラメータを取得するヘルパー
   * @param {Object} viewport - ビューポート情報
   * @returns {Object} { viewBoxX, viewBoxWidth, viewBoxHeight, viewBoxY }
   * @private
   */
  _getViewBoxParams(viewport) {
    const viewBoxWidth = viewport.width / viewport.zoom;
    const viewBoxHeight = viewport.height / viewport.zoom;
    const viewBoxX = viewport.x - viewBoxWidth / 2;
    const viewBoxY = -viewport.y - viewBoxHeight / 2; // ワールド座標のYを反転
    return { viewBoxX, viewBoxWidth, viewBoxHeight, viewBoxY };
  }

}
applyFeatureMethods(SVGRenderer);
