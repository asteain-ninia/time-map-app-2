// src/infrastructure/rendering/SVGRenderer.js

import { Point } from '../../domain/entities/Point.js';
import { Line } from '../../domain/entities/Line.js';
import { Polygon } from '../../domain/entities/Polygon.js';

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

  /**
   * 点情報を描画
   * @param {Point} point - 点情報
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement | null} SVG要素
   * @private
   */
  _renderPoint(point, vertices, currentTime, viewport) {
    const property = point.getPropertyAt(currentTime); // 修正: getPropertyAt を使用
    if (!property) return null; // 修正: property が null なら描画しない

    // 頂点を取得
    const vertexId = point.vertexId;
    const vertex = vertices.find(v => v.id === vertexId);
    if (!vertex) return null;

    // カテゴリに基づいたスタイルを取得
    const style = this._getPointStyle(property);

    // グループ要素を作成 (これは地物ごとに1つ)
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `point-${point.id}`);
    group.setAttribute("data-id", point.id);

    const worldWidth = this.getWorldWidth();
    const finalOffsets = [0, -worldWidth, worldWidth]; // 常に3つのオフセットで描画

    for (const offsetX of finalOffsets) {
        const currentX = vertex.x + offsetX;
        // カリングは行わない (SVGエンジンに任せる)

        const svgX = this._toScreenX(currentX, viewport); // オフセット適用済みX
        const svgY = -this._toScreenY(vertex.y, viewport); // Y座標反転

        // 点を描画
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", svgX);
        circle.setAttribute("cy", svgY);
        // 半径を 1/zoom でスケール
        circle.setAttribute("r", style.radius / viewport.zoom);
        circle.setAttribute("fill", style.fill);
        circle.setAttribute("stroke", style.stroke);
        circle.setAttribute("stroke-width", style.strokeWidth / viewport.zoom); // ズームに応じて線幅調整

        group.appendChild(circle);

        // ラベルを描画（オプション）
        if (property.name && style.showLabel) {
           const baseFontSize = style.fontSize || 10;
           // フォントサイズを 1/zoom でスケール
           const fontSize = Math.max(5 / viewport.zoom, Math.min(16 / viewport.zoom, baseFontSize / viewport.zoom));
           // 半径も 1/zoom でスケール
           const radius = style.radius / viewport.zoom;
           // ラベルをポイントの「上」(SVG座標でYが小さい方)に表示
           const textOffsetY = radius + 2 / viewport.zoom;// ポイントからのオフセット

          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", svgX);
          text.setAttribute("y", svgY - textOffsetY); // SVG Y座標からオフセットを引く
          text.setAttribute("text-anchor", "middle");
          // ベースラインを下に(alphabetic) -> これで上に表示されるはず
          text.setAttribute("dominant-baseline", "alphabetic");
          text.setAttribute("font-size", fontSize); // ズームに応じたフォントサイズ
          text.setAttribute("fill", style.textColor);
           text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff";
          text.textContent = property.name;
           // クリックイベントを透過させる
           text.setAttribute("pointer-events", "none");

           group.appendChild(text);
        }
    }
    // グループに実際に何かが追加されたか確認 (オフセット描画なので常に子はいるはず)
    if (group.childNodes.length === 0) return null;
    return group;
  }

  /**
   * 線情報を描画
   * @param {Line} line - 線情報
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement | null} SVG要素
   * @private
   */
  _renderLine(line, vertices, currentTime, viewport) {
    const property = line.getPropertyAt(currentTime); // 修正: getPropertyAt を使用
    if (!property) return null; // 修正: property が null なら描画しない

    // 頂点を取得 (元座標)
    const lineVerticesOriginal = line.vertexIds.map(id => vertices.find(v => v.id === id));
    if (lineVerticesOriginal.some(v => !v) || lineVerticesOriginal.length < 2) return null;

    // カテゴリに基づいたスタイルを取得
    const style = this._getLineStyle(property);

    // グループ要素を作成 (地物ごとに1つ)
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `line-${line.id}`);
    group.setAttribute("data-id", line.id);

    const worldWidth = this.getWorldWidth();
    const finalOffsets = [0, -worldWidth, worldWidth]; // 常に3つのオフセットで描画

    for (const offsetX of finalOffsets) {
        // オフセット適用後の頂点リスト
        const lineVerticesWithOffset = lineVerticesOriginal.map(v => ({ x: v.x + offsetX, y: v.y }));

        // パスを作成
        const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");

        // パスデータのY座標を反転
        let pathData = `M ${this._toScreenX(lineVerticesWithOffset[0].x, viewport)} ${-this._toScreenY(lineVerticesWithOffset[0].y, viewport)}`;
        for (let i = 1; i < lineVerticesWithOffset.length; i++) {
          pathData += ` L ${this._toScreenX(lineVerticesWithOffset[i].x, viewport)} ${-this._toScreenY(lineVerticesWithOffset[i].y, viewport)}`; // Y座標反転
        }

        pathElement.setAttribute("d", pathData);
        pathElement.setAttribute("fill", "none");
        pathElement.setAttribute("stroke", style.stroke);
        pathElement.setAttribute("stroke-width", style.strokeWidth / viewport.zoom);
        pathElement.setAttribute("stroke-dasharray", style.strokeDasharray || "");
        // 破線の場合、パターンもズームに合わせて調整（オプション）
        if (style.strokeDasharray) {
            const pattern = style.strokeDasharray.split(',').map(v => parseFloat(v.trim()) / viewport.zoom).join(',');
            pathElement.setAttribute("stroke-dasharray", pattern);
        }
        group.appendChild(pathElement);

        // ラベルを描画（オプション）
        if (property.name && style.showLabel) {
          let midXOriginal, midYOriginal; // オフセットなしの座標
          const midIndex = Math.floor(lineVerticesOriginal.length / 2);
          if(lineVerticesOriginal.length % 2 === 1 || lineVerticesOriginal.length === 2) {
             midXOriginal = lineVerticesOriginal[midIndex].x;
             midYOriginal = lineVerticesOriginal[midIndex].y;
          } else {
             midXOriginal = (lineVerticesOriginal[midIndex-1].x + lineVerticesOriginal[midIndex].x) / 2;
             midYOriginal = (lineVerticesOriginal[midIndex-1].y + lineVerticesOriginal[midIndex].y) / 2;
          }
           const svgX = this._toScreenX(midXOriginal + offsetX, viewport); // オフセット適用
           const svgY = -this._toScreenY(midYOriginal, viewport); // Y座標反転

           const baseFontSize = style.fontSize || 10;
           // フォントサイズを 1/zoom でスケール
           const fontSize = Math.max(5 / viewport.zoom, Math.min(16 / viewport.zoom, baseFontSize / viewport.zoom));
           // 線の上に表示するためのオフセット(SVG座標ではYを減らす)
           const textOffsetY = 5 / viewport.zoom;

          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", svgX);
          text.setAttribute("y", svgY - textOffsetY);
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("dominant-baseline", "alphabetic");
          text.setAttribute("font-size", fontSize); // ズームに応じたフォントサイズ
          text.setAttribute("fill", style.textColor);
           text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff";
          text.textContent = property.name;
           // クリックイベントを透過させる
           text.setAttribute("pointer-events", "none");
          group.appendChild(text);
        }
    }
    if (group.childNodes.length === 0) return null;
    return group;
  }

  /**
   * 面情報を描画 (リングベース対応)
   * @param {Polygon} polygon - 面情報 (リングベース構造を持つ)
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement | null} SVG要素、または描画できない場合はnull
   * @private
   */
  _renderPolygon(polygon, vertices, currentTime, viewport) {
    const property = polygon.getPropertyAt(currentTime); // 修正: getPropertyAt を使用
    if (!property) return null; // 修正: property が null なら描画しない

    // リングが存在しない場合は描画しない (子ポリゴンのみの場合は描画しないルール)
    if (!polygon.rings || polygon.rings.length === 0) {
        // console.log(`Polygon ${polygon.id} has no rings, skipping render.`);
        return null;
    }

    // グループ要素を作成 (地物ごとに1つ)
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `polygon-${polygon.id}`);
    group.setAttribute("data-id", polygon.id);

    // カテゴリに基づいたスタイルを取得
    const style = this._getPolygonStyle(property);

    // 共通スタイル
    const fill = style.fill;
    const stroke = style.stroke;
    const strokeWidth = style.strokeWidth / viewport.zoom;
    const fillOpacity = style.fillOpacity;

    const invertY = true; // Y座標を反転させるフラグ

    const verticesMap = new Map(vertices.map(v => [v.id, v])); // 高速参照用
    const worldWidth = this.getWorldWidth();
    const finalOffsets = [0, -worldWidth, worldWidth]; // 常に3つのオフセットで描画

    for (const offsetX of finalOffsets) {
        // パスデータを生成 (このオフセット用)
        let pathDataForOffset = "";
        // polygon.rings をループしてパスデータを構築
        for (const ring of polygon.rings) {
            const ringVerticesOriginal = ring.vertexIds.map(id => verticesMap.get(id)).filter(v => v); // 元の頂点オブジェクトを取得

            if (ringVerticesOriginal.length < 3) {
                console.warn(`Ring ${ring.id} in polygon ${polygon.id} has less than 3 valid vertices. Skipping ring.`);
                continue; // 3点未満のリングは描画しない
            }

            // オフセット適用後の頂点リスト
            const ringVerticesWithOffset = ringVerticesOriginal.map(v => ({ x: v.x + offsetX, y: v.y }));

            // パスデータの開始点 (Move To)
            pathDataForOffset += ` M ${this._toScreenX(ringVerticesWithOffset[0].x, viewport)} ${invertY ? -this._toScreenY(ringVerticesWithOffset[0].y, viewport) : this._toScreenY(ringVerticesWithOffset[0].y, viewport)}`;

            // 残りの点を結ぶ (Line To)
            for (let i = 1; i < ringVerticesWithOffset.length; i++) {
                pathDataForOffset += ` L ${this._toScreenX(ringVerticesWithOffset[i].x, viewport)} ${invertY ? -this._toScreenY(ringVerticesWithOffset[i].y, viewport) : this._toScreenY(ringVerticesWithOffset[i].y, viewport)}`;
            }

            // パスを閉じる (Close Path)
            pathDataForOffset += " Z";
        }

        if (pathDataForOffset) {
            // パス要素を作成して属性を設定
            const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
            pathElement.setAttribute("d", pathDataForOffset);
            pathElement.setAttribute("fill", fill);
            pathElement.setAttribute("stroke", stroke);
            pathElement.setAttribute("stroke-width", strokeWidth);
            pathElement.setAttribute("fill-opacity", fillOpacity);
            pathElement.setAttribute("fill-rule", "evenodd"); // 穴を正しく描画するためのルール
            group.appendChild(pathElement);
        }

        // ラベルを描画（オプション）(このオフセットの中心に対して)
        if (property.name && style.showLabel) {
          // ポリゴンの中心を計算（簡易的に、最初の最上位外周リングの重心）
          const firstOuterRing = polygon.rings.find(r => r.isOuter && r.parentId === null);
          if (firstOuterRing) {
              const ringVerticesOriginal = firstOuterRing.vertexIds
                  .map(id => verticesMap.get(id))
                  .filter(v => v); // 元の頂点

              if (ringVerticesOriginal.length > 0) {
                  let centroidXOriginal = 0; // オフセットなしの重心X
                  let centroidYOriginal = 0; // オフセットなしの重心Y
                  for (const vertex of ringVerticesOriginal) {
                      centroidXOriginal += vertex.x;
                      centroidYOriginal += vertex.y;
                  }
                  centroidXOriginal /= ringVerticesOriginal.length;
                  centroidYOriginal /= ringVerticesOriginal.length;

                  const svgX = this._toScreenX(centroidXOriginal + offsetX, viewport); // オフセット適用
                  const svgY = invertY ? -this._toScreenY(centroidYOriginal, viewport) : this._toScreenY(centroidYOriginal, viewport);

                  const baseFontSize = style.fontSize || 12;
                  // フォントサイズを 1/zoom でスケール
                  const fontSize = Math.max(6 / viewport.zoom, Math.min(20 / viewport.zoom, baseFontSize / viewport.zoom));

                  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                  text.setAttribute("x", svgX);
                  text.setAttribute("y", svgY);
                  text.setAttribute("text-anchor", "middle");
                  text.setAttribute("dominant-baseline", "middle");
                  text.setAttribute("font-size", fontSize);
                  text.setAttribute("fill", style.textColor);
                  text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff";
                  text.textContent = property.name;
                  // クリックイベントを透過させる
                  text.setAttribute("pointer-events", "none");

                  group.appendChild(text);
              }
          }
        }
    }
    if (group.childNodes.length === 0) return null; // 何も描画されなかった場合
    return group;
  }

  /**
   * 多角形パスを作成 (このメソッドは _renderPolygon に統合されたため不要)
   * @deprecated Use direct path generation within _renderPolygon.
   * @private
   */
  // _createPolygonPath(vertices, holesVertexIds, allVertices, viewport, invertY = false) { ... }

  /**
   * 世界座標からスクリーン座標へのX変換 (SVG座標系)
   * @param {number} worldX - 世界X座標
   * @param {Object} viewport - ビューポート情報
   * @returns {number} SVG X座標
   * @private
   */
  _toScreenX(worldX, viewport) {
    // viewBoxを使用するため、単純にワールド座標をそのまま返す
    return worldX;
  }

  /**
   * 世界座標からスクリーン座標へのY変換 (SVG座標系)
   * @param {number} worldY - 世界Y座標 (上向き正)
   * @param {Object} viewport - ビューポート情報
   * @returns {number} SVG Y座標 (下向き正) - 反転は呼び出し元で行う
   * @private
   */
  _toScreenY(worldY, viewport) {
    // viewBoxを使用するため、単純にワールド座標をそのまま返す (反転は描画時に行う)
    return worldY;
  }

/**
 * スクリーン座標から世界座標へのX変換
 * @param {number} svgX - SVG要素上のX座標
 * @param {Object} viewport - ビューポート情報
 * @returns {number} 世界X座標
 */
toWorldX(svgX, viewport) {
  // viewBoxを使用しているため、SVG要素上の座標がそのままワールド座標となる
  return svgX;
}

/**
 * スクリーン座標から世界座標へのY変換
 * @param {number} svgY - SVG要素上のY座標 (下向き正)
 * @param {Object} viewport - ビューポート情報
 * @returns {number} 世界Y座標 (上向き正)
 */
toWorldY(svgY, viewport) {
  // viewBoxを使用しているため、SVG要素上のY座標を反転させる
  return -svgY;
}

  /**
   * 点のスタイルを取得
   * @param {Property} property - プロパティ
   * @returns {Object} スタイル情報
   * @private
   */
  _getPointStyle(property) {
    // カテゴリに基づいたスタイルのマッピング
    const categoryStyles = {
      city: {
        radius: 5,
        fill: "#ff0000",
        stroke: "#000000",
        strokeWidth: 1,
        textColor: "#000000",
        fontSize: 12,
        showLabel: true
      },
      town: {
        radius: 3,
        fill: "#ff3333",
        stroke: "#000000",
        strokeWidth: 1,
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      battle: {
        radius: 4,
        fill: "#ff0000",
        stroke: "#000000",
        strokeWidth: 1,
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      ruin: {
        radius: 4,
        fill: "#996633",
        stroke: "#000000",
        strokeWidth: 1,
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      // デフォルトスタイル
      default: {
        radius: 4,
        fill: "#3388ff",
        stroke: "#000000",
        strokeWidth: 1,
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      }
    };

    const category = property.getAttribute("category", "default");
    return categoryStyles[category] || categoryStyles.default;
  }

  /**
   * 線のスタイルを取得
   * @param {Property} property - プロパティ
   * @returns {Object} スタイル情報
   * @private
   */
  _getLineStyle(property) {
    // カテゴリに基づいたスタイルのマッピング
    const categoryStyles = {
      road: {
        stroke: "#996633",
        strokeWidth: 2, // 線幅の基準値 (必要なら調整)
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      railway: {
        stroke: "#333333",
        strokeWidth: 2, // 線幅の基準値
        strokeDasharray: "5,5",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      river: {
        stroke: "#3388ff",
        strokeWidth: 2, // 線幅の基準値
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      trade_route: {
        stroke: "#ff8800",
        strokeWidth: 2, // 線幅の基準値
        strokeDasharray: "10,2",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      border: {
        stroke: "#ff0000",
        strokeWidth: 3, // 国境は少し太めに
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: false
      },
      // デフォルトスタイル
      default: {
        stroke: "#3388ff",
        strokeWidth: 2, // 線幅の基準値
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      }
    };

    const category = property.getAttribute("category", "default");
    return categoryStyles[category] || categoryStyles.default;
  }

  /**
   * 面のスタイルを取得
   * @param {Property} property - プロパティ
   * @returns {Object} スタイル情報
   * @private
   */
  _getPolygonStyle(property) {
    // カテゴリに基づいたスタイルのマッピング
    const categoryStyles = {
      kingdom: {
        fill: "#ff8888",
        stroke: "#ff0000",
        strokeWidth: 2, // 線幅の基準値
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 14,
        showLabel: true
      },
      empire: {
        fill: "#8888ff",
        stroke: "#0000ff",
        strokeWidth: 2, // 線幅の基準値
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 16,
        showLabel: true
      },
      province: {
        fill: "#88ff88",
        stroke: "#008800",
        strokeWidth: 2, // 線幅の基準値
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 12,
        showLabel: true
      },
      ocean: {
        fill: "#3388ff",
        stroke: "#3388ff",
        strokeWidth: 1, // 海洋は細めに
        fillOpacity: 0.4,
        textColor: "#000000",
        fontSize: 14,
        showLabel: true
      },
      lake: {
        fill: "#3388ff",
        stroke: "#3388ff",
        strokeWidth: 1, // 湖も細めに
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 12,
        showLabel: true
      },
      // デフォルトスタイル
      default: {
        fill: "#ffcc88",
        stroke: "#ff8800",
        strokeWidth: 2, // 線幅の基準値
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 12,
        showLabel: true
      }
    };

    const category = property.getAttribute("category", "default");
    return categoryStyles[category] || categoryStyles.default;
  }

  /**
   * 点を描画 (一時要素用)
   * @param {number} x - 世界X座標
   * @param {number} y - 世界Y座標
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  drawPoint(x, y, style, viewport) {
    const svgX = this._toScreenX(x, viewport);
    const svgY = -this._toScreenY(y, viewport); // Y座標反転

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", svgX);
    circle.setAttribute("cy", svgY);
    // 半径を 1/zoom でスケール
    circle.setAttribute("r", (style.radius || 5) / viewport.zoom);
    circle.setAttribute("fill", style.fill || "#ff0000");
    circle.setAttribute("stroke", style.stroke || "#000000");
    circle.setAttribute("stroke-width", (style.strokeWidth || 1) / viewport.zoom);
    // クリックイベントを透過させる
    circle.setAttribute("pointer-events", "none");

    this._mainGroup.appendChild(circle);
    return circle;
  }

  /**
   * 線を描画 (一時要素用)
   * @param {Array<{x: number, y: number}>} points - 点の配列 (ワールド座標)
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  drawLine(points, style, viewport) {
    if (!points || points.length < 2) return null;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");

    // パスデータのY座標を反転
    let pathData = `M ${this._toScreenX(points[0].x, viewport)} ${-this._toScreenY(points[0].y, viewport)}`;
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${this._toScreenX(points[i].x, viewport)} ${-this._toScreenY(points[i].y, viewport)}`;
    }

    line.setAttribute("d", pathData);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", style.stroke || "#000000");
    line.setAttribute("stroke-width", (style.strokeWidth || 2) / viewport.zoom);
    line.setAttribute("stroke-dasharray", style.strokeDasharray || "");
    // 破線の場合、パターンもズームに合わせて調整（オプション）
    if (style.strokeDasharray) {
        const pattern = style.strokeDasharray.split(',').map(v => parseFloat(v.trim()) / viewport.zoom).join(',');
        line.setAttribute("stroke-dasharray", pattern);
    }
    // クリックイベントを透過させる
    line.setAttribute("pointer-events", "none");

    this._mainGroup.appendChild(line);
    return line;
  }

  /**
   * テキストを描画 (一時要素用)
   * @param {number} x - 世界X座標
   * @param {number} y - 世界Y座標
   * @param {string} content - テキスト内容
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  drawText(x, y, content, style, viewport) {
    const svgX = this._toScreenX(x, viewport);
    const svgY = -this._toScreenY(y, viewport); // Y座標反転

    const baseFontSize = style.fontSize || 12;
    // フォントサイズを 1/zoom でスケール
    const fontSize = Math.max(6 / viewport.zoom, Math.min(18 / viewport.zoom, baseFontSize / viewport.zoom));

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", svgX);
    text.setAttribute("y", svgY); // Y座標は反転済み
    text.setAttribute("text-anchor", style.textAnchor || "middle");
    text.setAttribute("dominant-baseline", style.dominantBaseline || "middle"); // スタイルで指定可能に
    text.setAttribute("font-size", fontSize); // ズームに応じたフォントサイズ
    text.setAttribute("fill", style.textColor || "#000000");
    text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff";
    text.textContent = content;
    // クリックイベントを透過させる
    text.setAttribute("pointer-events", "none");

    this._mainGroup.appendChild(text);
    return text;
  }

  /**
   * 要素を削除
   * @param {SVGElement} element - 削除する要素
   */
  removeElement(element) {
    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }
  /**
 * 背景地図を読み込む
 * @param {string} svgContent - SVG形式の地図内容
 */
  loadBackgroundMap(svgContent) {
    // 既存の背景コピーの内容をクリア
    this._backgroundCopies.forEach(copyGroup => {
        while (copyGroup.firstChild) {
            copyGroup.removeChild(copyGroup.firstChild);
        }
    });
    this._originalBackgroundContent = null; // 元の内容もクリア

    // SVG文字列からDOMを解析
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgElement = svgDoc.documentElement;

    if (!svgElement || svgElement.nodeName !== 'svg') {
        console.error('読み込まれたSVGコンテンツが無効です。');
        return;
    }

    // SVGの幅と高さを取得 (viewBox優先、なければwidth/height)
    let svgWidth, svgHeight;
    const viewBox = svgElement.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.split(/\s+|,/);
        if (parts.length === 4) {
            svgWidth = parseFloat(parts[2]);
            svgHeight = parseFloat(parts[3]);
        }
    }
    if (!svgWidth || !svgHeight) {
        svgWidth = parseFloat(svgElement.getAttribute('width'));
        svgHeight = parseFloat(svgElement.getAttribute('height'));
    }

    if (!svgWidth || !svgHeight || svgWidth <= 0 || svgHeight <= 0) {
        console.error('背景地図SVGの幅または高さを特定できませんでした。');
        return;
    }

    // ワールド座標系（経度360度、緯度180度）にマッピング
    const targetWidth = this._backgroundTransform.worldWidth; // 360
    const targetHeight = this._backgroundTransform.worldHeight; // 180

    // スケーリング係数
    const scaleX = targetWidth / svgWidth;
    // Y軸反転をやめ、Y軸下向き正の座標系に合わせる
    const scaleY = targetHeight / svgHeight; // 正の値
    // SVG(0,0)をワールド(-180, 90)ではなく、viewBox座標(-180, -90)にマッピング
    const translateX = -targetWidth / 2; // -180
    const translateY = -targetHeight / 2; // -90

    // 背景の基準変換情報を保存
    this._backgroundTransform = {
        scaleX: scaleX,
        scaleY: scaleY, // 正の値
        translateX: translateX, // -180
        translateY: translateY, // -90
        worldWidth: targetWidth,
        worldHeight: targetHeight,
    };

    // 元のSVGコンテンツをグループ化して保持 (クローンの元データ)
    const originalGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    while (svgElement.firstChild) {
        if (svgElement.firstChild.nodeType === Node.ELEMENT_NODE) {
            // ノードを移動する前にクローンする
            originalGroup.appendChild(svgElement.firstChild.cloneNode(true));
        }
        // 元の要素は不要なので削除
        svgElement.removeChild(svgElement.firstChild);
    }
    this._originalBackgroundContent = originalGroup;

    //  保持している3つのコピーグループにクローンした内容を追加
    this._backgroundCopies.forEach(copyGroup => {
        // 各コピーグループに元のコンテンツをクローンして追加
        const contentClone = this._originalBackgroundContent.cloneNode(true);
        // g要素の中身（実際のパスなど）を追加する
        while (contentClone.firstChild) {
            copyGroup.appendChild(contentClone.firstChild);
        }
    });


    console.log(`背景地図を読み込みました。 元サイズ: ${svgWidth}x${svgHeight}, 基準変換: translate(${translateX},${translateY}) scale(${scaleX.toFixed(4)},${scaleY.toFixed(4)})`);

    // 初回描画をトリガーするために render を呼び出す必要がある
    // 外部から呼ばれるか、ここで render をトリガーする
    // 例: this.render(...)
  }

  /**
   * グリッドの表示/非表示を切り替え
   * @param {boolean} show - 表示する場合はtrue
   */
  toggleGrid(show) {
    this._options.showGrid = show;
    // 再描画をトリガーする必要がある
    // このメソッドは直接 render を呼ばず、状態変更のみ行う
    // 描画は次の render サイクルで行われる
  }
}
