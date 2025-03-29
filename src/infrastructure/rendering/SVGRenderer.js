/**
 * SVGベースの地図レンダリング
 */
export class SVGRenderer {
  /**
   * レンダラーを作成
   * @param {HTMLElement} container - SVG要素を配置するコンテナ
   * @param {Object} [options={}] - レンダリングオプション
   */
  constructor(container, options = {}) {
    this._container = container;
    this._svg = null;
    this._defs = null;
    this._mainGroup = null;
    this._gridGroup = null;
    this._featuresGroup = null;

    this._options = {
      width: options.width || 800,
      height: options.height || 600,
      padding: options.padding || 10,
      gridColor: options.gridColor || "#cccccc",
      gridOpacity: options.gridOpacity || 0.5,
      showGrid: true, // グリッド表示状態
      gridInterval: options.gridInterval || 10, // グリッド間隔のデフォルト値
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
    this._svg.style.position = "absolute";  // 追加: 絶対配置に
    this._svg.style.top = "0";              // 追加: 上端に配置
    this._svg.style.left = "0";             // 追加: 左端に配置
    this._svg.style.zIndex = "5";           // 追加: オーバーレイより下に配置

    // グループ要素を作成
    this._defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    this._svg.appendChild(this._defs);

    this._mainGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._mainGroup.setAttribute("class", "main-group");
    this._svg.appendChild(this._mainGroup);

    this._gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._gridGroup.setAttribute("class", "grid-group");
    this._mainGroup.appendChild(this._gridGroup);

    this._featuresGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._featuresGroup.setAttribute("class", "features-group");
    this._mainGroup.appendChild(this._featuresGroup);

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
 */
render(world, viewport, currentTime) {
  // console.log('SVGRenderer.render 開始');
  // console.log('ビューポート情報:', viewport);

  // SVG要素の viewBox を更新
  // SVG要素の viewBox を更新して、パン・ズーム機能を実現
  // viewBoxを使うことで、SVG内の要素の座標変換が自動的に行われる
  const viewBoxWidth = viewport.width / viewport.zoom;
  const viewBoxHeight = viewport.height / viewport.zoom;
  const viewBoxX = viewport.x - viewBoxWidth / 2;
  const viewBoxY = viewport.y - viewBoxHeight / 2;

  // viewBox属性を更新
  this._svg.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
  // console.log('SVG viewBox 更新:', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);

  // グリッドを描画
  this._renderGrid(viewport);

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
      f.layerId === layer.id && f.existsAt(currentTime)
    );

    // console.log(`レイヤー ${layer.name} の地物数:`, layerFeatures.length);

    // 地物を種類別に分けて描画順序を制御
    const polygons = layerFeatures.filter(f => f instanceof Polygon);
    const lines = layerFeatures.filter(f => f instanceof Line);
    const points = layerFeatures.filter(f => f instanceof Point);

    // console.log(`ポリゴン:${polygons.length}, ライン:${lines.length}, ポイント:${points.length}`);

    // 面 → 線 → 点の順で描画
    for (const polygon of polygons) {
      const element = this._renderPolygon(polygon, world.vertices, currentTime, viewport);
      if (element) {
        layerGroup.appendChild(element);
      }
    }

    for (const line of lines) {
      const element = this._renderLine(line, world.vertices, currentTime, viewport);
      if (element) {
        layerGroup.appendChild(element);
      }
    }

    for (const point of points) {
      const element = this._renderPoint(point, world.vertices, currentTime, viewport);
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
 * グリッドを描画
 * @param {Object} viewport - ビューポート情報
 * @private
 */
_renderGrid(viewport) {
  // グリッドをクリア
  while (this._gridGroup.firstChild) {
    this._gridGroup.removeChild(this._gridGroup.firstChild);
  }

  // グリッド非表示設定の場合は描画しない
  if (!this._options.showGrid) return;

  const { x, y, zoom, width, height } = viewport;

  // viewBoxの範囲を計算
  const viewBoxWidth = width / zoom;
  const viewBoxHeight = height / zoom;
  const left = x - viewBoxWidth / 2;
  const right = x + viewBoxWidth / 2;
  const top = y - viewBoxHeight / 2;
  const bottom = y + viewBoxHeight / 2;

  // グリッド間隔（度単位）
  const gridInterval = this._options.gridInterval || 10;

  // 緯度・経度の描画範囲を計算（-90～90, -180～180 の範囲に限定しつつ、ループを考慮）
  const latMin = Math.max(-90, Math.floor(top / gridInterval) * gridInterval);
  const latMax = Math.min(90, Math.ceil(bottom / gridInterval) * gridInterval);
  const lonMin = Math.floor(left / gridInterval) * gridInterval;
  const lonMax = Math.ceil(right / gridInterval) * gridInterval;

  // 線の太さ（ズームに応じて細くする）
  const strokeWidth = 1 / zoom;

  // ラベルのフォントサイズ（ズームに応じて調整、ただし最小・最大値を設ける）
  const baseFontSize = 10;
  const fontSize = Math.max(5, Math.min(16, baseFontSize / Math.sqrt(zoom)));

  // 緯線（横線）を描画
  for (let lat = latMin; lat <= latMax; lat += gridInterval) {
    // 赤道（0度）は強調表示
    const isEquator = Math.abs(lat) < 0.001;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", left); // 線の描画は viewBox 全体に行う
    line.setAttribute("y1", lat);
    line.setAttribute("x2", right);
    line.setAttribute("y2", lat);
    line.setAttribute("stroke", isEquator ? "#ff0000" : this._options.gridColor);
    line.setAttribute("stroke-width", (isEquator ? 2 : 1) * strokeWidth);
    line.setAttribute("opacity", this._options.gridOpacity);
    // クリックイベントを無効化
    line.setAttribute("pointer-events", "none");

    this._gridGroup.appendChild(line);

    // 緯度ラベル（画面左端に表示）
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", left + 2 * strokeWidth); // 左端からのオフセット
    text.setAttribute("y", lat - 2 * strokeWidth); // 線からのオフセット
    text.setAttribute("font-size", fontSize);
    text.setAttribute("fill", this._options.gridColor);
    text.setAttribute("text-anchor", "start"); // 左揃え
    text.setAttribute("dominant-baseline", "alphabetic"); // ベースライン調整
    // クリックイベントを無効化
    text.setAttribute("pointer-events", "none");
    text.textContent = `${Math.abs(lat)}°${lat > 0 ? 'N' : (lat < 0 ? 'S' : '')}`; // 0度は記号なし

    this._gridGroup.appendChild(text);
  }

  // 経線（縦線）を描画
  for (let lng = lonMin; lng <= lonMax; lng += gridInterval) {
      let currentLng = lng;
      // 経度を -180 から 180 の範囲に正規化
      while (currentLng > 180) currentLng -= 360;
      while (currentLng <= -180) currentLng += 360;

      // 本初子午線（0度）と日付変更線（+/-180度）は強調表示
      const isPrimeMeridian = Math.abs(currentLng) < 0.001;
      const isDateLine = Math.abs(Math.abs(currentLng) - 180) < 0.001;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", lng); // 元の経度値で描画
      line.setAttribute("y1", top); // 線の描画は viewBox 全体に行う
      line.setAttribute("x2", lng);
      line.setAttribute("y2", bottom);
      line.setAttribute("stroke", isPrimeMeridian || isDateLine ? "#ff0000" : this._options.gridColor);
      line.setAttribute("stroke-width", (isPrimeMeridian || isDateLine ? 2 : 1) * strokeWidth);
      line.setAttribute("opacity", this._options.gridOpacity);
      // クリックイベントを無効化
      line.setAttribute("pointer-events", "none");

      this._gridGroup.appendChild(line);

      // 経度ラベル（画面上端に表示）
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", lng + 2 * strokeWidth); // 線からのオフセット
      text.setAttribute("y", top + fontSize); // 上端からのオフセット
      text.setAttribute("font-size", fontSize);
      text.setAttribute("fill", this._options.gridColor);
      text.setAttribute("text-anchor", "start"); // 左揃え
      text.setAttribute("dominant-baseline", "hanging"); // 上揃え
      // クリックイベントを無効化
      text.setAttribute("pointer-events", "none");

      let labelLng = Math.abs(currentLng);
      if (labelLng === 180) labelLng = 180; // 180度は符号なし
      text.textContent = `${labelLng}°${currentLng > 0 && currentLng !== 180 ? 'E' : (currentLng < 0 && currentLng !== -180 ? 'W' : '')}`; // 0度と180度は記号なし

      this._gridGroup.appendChild(text);
  }
}

  /**
   * 点情報を描画
   * @param {Point} point - 点情報
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   * @private
   */
  _renderPoint(point, vertices, currentTime, viewport) {
    const property = point.getPropertyAt(currentTime);
    if (!property) return null;

    // 頂点を取得
    const vertexId = point.vertexId;
    const vertex = vertices.find(v => v.id === vertexId);
    if (!vertex) return null;

    // カテゴリに基づいたスタイルを取得
    const style = this._getPointStyle(property);

    // グループ要素を作成
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `point-${point.id}`);
    group.setAttribute("data-id", point.id);

    // 点を描画
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", this._toScreenX(vertex.x, viewport));
    circle.setAttribute("cy", this._toScreenY(vertex.y, viewport));
    circle.setAttribute("r", style.radius / Math.sqrt(viewport.zoom)); // ズームに応じてサイズ調整
    circle.setAttribute("fill", style.fill);
    circle.setAttribute("stroke", style.stroke);
    circle.setAttribute("stroke-width", style.strokeWidth / viewport.zoom); // ズームに応じて線幅調整

    group.appendChild(circle);

    // ラベルを描画（オプション）
    if (property.name && style.showLabel) {
       const baseFontSize = style.fontSize || 10;
       const fontSize = Math.max(5, Math.min(16, baseFontSize / Math.sqrt(viewport.zoom)));
       const radius = style.radius / Math.sqrt(viewport.zoom);
       const textOffsetY = radius + 2 / viewport.zoom; // ポイントからのオフセット

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", this._toScreenX(vertex.x, viewport));
      text.setAttribute("y", this._toScreenY(vertex.y, viewport) - textOffsetY);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", fontSize);
      text.setAttribute("fill", style.textColor);
       text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff"; // 白い縁取り
      text.textContent = property.name;
       // クリックイベントを透過させる
       text.setAttribute("pointer-events", "none");

      group.appendChild(text);
    }

    return group;
  }

  /**
   * 線情報を描画
   * @param {Line} line - 線情報
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   * @private
   */
  _renderLine(line, vertices, currentTime, viewport) {
    const property = line.getPropertyAt(currentTime);
    if (!property) return null;

    // 頂点を取得
    const lineVertices = line.vertexIds.map(id => vertices.find(v => v.id === id));
    if (lineVertices.some(v => !v) || lineVertices.length < 2) return null; // 頂点が見つからないか、頂点数が不足

    // カテゴリに基づいたスタイルを取得
    const style = this._getLineStyle(property);

    // グループ要素を作成
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `line-${line.id}`);
    group.setAttribute("data-id", line.id);

    // パスを作成
    const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");

    // パスデータを構築
    let pathData = `M ${this._toScreenX(lineVertices[0].x, viewport)} ${this._toScreenY(lineVertices[0].y, viewport)}`;

    for (let i = 1; i < lineVertices.length; i++) {
      pathData += ` L ${this._toScreenX(lineVertices[i].x, viewport)} ${this._toScreenY(lineVertices[i].y, viewport)}`;
    }

    pathElement.setAttribute("d", pathData);
    pathElement.setAttribute("fill", "none");
    pathElement.setAttribute("stroke", style.stroke);
    pathElement.setAttribute("stroke-width", style.strokeWidth / viewport.zoom); // ズームに応じて線幅調整
    pathElement.setAttribute("stroke-dasharray", style.strokeDasharray || "");
    // 破線の場合、パターンもズームに合わせて調整（オプション）
    if (style.strokeDasharray) {
        const pattern = style.strokeDasharray.split(',').map(v => parseFloat(v.trim()) / viewport.zoom).join(',');
        pathElement.setAttribute("stroke-dasharray", pattern);
    }

    group.appendChild(pathElement);

    // ラベルを描画（オプション）
    if (property.name && style.showLabel) {
      // 線の中央位置を計算
      const midIndex = Math.floor(lineVertices.length / 2);
      // 中央の線分の中点を計算
      let midX, midY;
      if(lineVertices.length % 2 === 1 || lineVertices.length === 2) {
         midX = lineVertices[midIndex].x;
         midY = lineVertices[midIndex].y;
      } else {
         midX = (lineVertices[midIndex-1].x + lineVertices[midIndex].x) / 2;
         midY = (lineVertices[midIndex-1].y + lineVertices[midIndex].y) / 2;
      }

       const baseFontSize = style.fontSize || 10;
       const fontSize = Math.max(5, Math.min(16, baseFontSize / Math.sqrt(viewport.zoom)));
       const textOffsetY = 5 / viewport.zoom; // 線からのオフセット

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", this._toScreenX(midX, viewport));
      text.setAttribute("y", this._toScreenY(midY, viewport) - textOffsetY);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", fontSize);
      text.setAttribute("fill", style.textColor);
       text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff"; // 白い縁取り
      text.textContent = property.name;
       // クリックイベントを透過させる
       text.setAttribute("pointer-events", "none");

      group.appendChild(text);
    }

    return group;
  }

  /**
   * 面情報を描画
   * @param {Polygon} polygon - 面情報
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   * @private
   */
  _renderPolygon(polygon, vertices, currentTime, viewport) {
    const property = polygon.getPropertyAt(currentTime);
    if (!property) return null;

    // グループ要素を作成
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `polygon-${polygon.id}`);
    group.setAttribute("data-id", polygon.id);

    // カテゴリに基づいたスタイルを取得
    const style = this._getPolygonStyle(property);

    // 共通スタイル
    const fill = style.fill;
    const stroke = style.stroke;
    const strokeWidth = style.strokeWidth / viewport.zoom; // ズームに応じて線幅調整
    const fillOpacity = style.fillOpacity;

    if (polygon.isMultiPolygon) {
      // 飛び地の描画
      for (const subPoly of polygon.subPolygons) {
        const subVertices = subPoly.vertexIds.map(id => vertices.find(v => v.id === id));
        if (subVertices.some(v => !v) || subVertices.length < 3) continue; // 頂点が見つからないか、頂点数が不足

        const path = this._createPolygonPath(subVertices, subPoly.holesVertexIds, vertices, viewport);
        path.setAttribute("fill", fill);
        path.setAttribute("stroke", stroke);
        path.setAttribute("stroke-width", strokeWidth);
        path.setAttribute("fill-opacity", fillOpacity); // fill-opacityを使用
        path.setAttribute("fill-rule", "evenodd"); // 穴を正しく描画するため

        group.appendChild(path);
      }
    } else if (polygon.vertexIds && polygon.vertexIds.length > 0) {
      // 通常の多角形
      const polyVertices = polygon.vertexIds.map(id => vertices.find(v => v.id === id));
      if (polyVertices.some(v => !v) || polyVertices.length < 3) return null; // 頂点が見つからないか、頂点数が不足

      const path = this._createPolygonPath(polyVertices, polygon.holesVertexIds, vertices, viewport);
      path.setAttribute("fill", fill);
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", strokeWidth);
      path.setAttribute("fill-opacity", fillOpacity); // fill-opacityを使用
      path.setAttribute("fill-rule", "evenodd"); // 穴を正しく描画するため

      group.appendChild(path);
    } else if (polygon.childIds && polygon.childIds.length > 0) {
      // 子ポリゴンから構成される多角形の処理
      // この簡易実装では省略
    }

    // ラベルを描画（オプション）
    if (property.name && style.showLabel) {
      // 多角形の中心を計算（簡易的に最初のサブポリゴンまたは外周の重心）
      let centroidX = 0;
      let centroidY = 0;
      let vertexCount = 0;
      let targetVertices = null;

      if (polygon.isMultiPolygon && polygon.subPolygons.length > 0) {
          targetVertices = polygon.subPolygons[0].vertexIds
              .map(id => vertices.find(v => v.id === id))
              .filter(v => v);
      } else if (polygon.vertexIds && polygon.vertexIds.length > 0) {
          targetVertices = polygon.vertexIds
              .map(id => vertices.find(v => v.id === id))
              .filter(v => v);
      }

      if (targetVertices && targetVertices.length > 0) {
          vertexCount = targetVertices.length;
          for (const vertex of targetVertices) {
              centroidX += vertex.x;
              centroidY += vertex.y;
          }
      }

      if (vertexCount > 0) {
        centroidX /= vertexCount;
        centroidY /= vertexCount;

         const baseFontSize = style.fontSize || 12;
         const fontSize = Math.max(6, Math.min(20, baseFontSize / Math.sqrt(viewport.zoom)));

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", this._toScreenX(centroidX, viewport));
        text.setAttribute("y", this._toScreenY(centroidY, viewport));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle"); // 中央揃え
        text.setAttribute("font-size", fontSize);
        text.setAttribute("fill", style.textColor);
         text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff"; // 白い縁取り
        text.textContent = property.name;
         // クリックイベントを透過させる
         text.setAttribute("pointer-events", "none");

        group.appendChild(text);
      }
    }

    return group;
  }

  /**
   * 多角形パスを作成
   * @param {Vertex[]} vertices - 頂点配列
   * @param {string[][]} holesVertexIds - 穴の頂点IDの配列の配列
   * @param {Vertex[]} allVertices - すべての頂点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} パス要素
   * @private
   */
  _createPolygonPath(vertices, holesVertexIds, allVertices, viewport) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    // 外周のパスデータ
    let pathData = `M ${this._toScreenX(vertices[0].x, viewport)} ${this._toScreenY(vertices[0].y, viewport)}`;

    for (let i = 1; i < vertices.length; i++) {
      pathData += ` L ${this._toScreenX(vertices[i].x, viewport)} ${this._toScreenY(vertices[i].y, viewport)}`;
    }

    pathData += " Z";

    // 穴のパスデータ (逆順で指定すると SVG の fill-rule: evenodd で穴になる)
    for (const holeIds of holesVertexIds) {
      const holeVertices = holeIds.map(id => allVertices.find(v => v.id === id)).filter(v => v);

      if (holeVertices.length > 2) { // 穴は3頂点以上必要
        // 穴の頂点を逆順にする
        const reversedHoleVertices = [...holeVertices].reverse();

        pathData += ` M ${this._toScreenX(reversedHoleVertices[0].x, viewport)} ${this._toScreenY(reversedHoleVertices[0].y, viewport)}`;

        for (let i = 1; i < reversedHoleVertices.length; i++) {
          pathData += ` L ${this._toScreenX(reversedHoleVertices[i].x, viewport)} ${this._toScreenY(reversedHoleVertices[i].y, viewport)}`;
        }

        pathData += " Z";
      }
    }

    path.setAttribute("d", pathData);
    return path;
  }

  /**
   * 世界座標からスクリーン座標へのX変換
   * @param {number} worldX - 世界X座標
   * @param {Object} viewport - ビューポート情報
   * @returns {number} スクリーンX座標
   * @private
   */
  _toScreenX(worldX, viewport) {
    // viewBoxを使用するため、単純にワールド座標をそのまま返す
    return worldX;
  }

  /**
   * 世界座標からスクリーン座標へのY変換
   * @param {number} worldY - 世界Y座標
   * @param {Object} viewport - ビューポート情報
   * @returns {number} スクリーンY座標
   * @private
   */
  _toScreenY(worldY, viewport) {
    // viewBoxを使用するため、単純にワールド座標をそのまま返す
    return worldY;
  }

  /**
 * スクリーン座標から世界座標へのX変換
 * @param {number} screenX - SVG要素上のX座標
 * @param {Object} viewport - ビューポート情報
 * @returns {number} 世界X座標
 */
toWorldX(svgX, viewport) {
  // viewBoxを使用しているため、SVG要素上の座標がそのままワールド座標となる
  return svgX;
}

/**
 * スクリーン座標から世界座標へのY変換
 * @param {number} screenY - SVG要素上のY座標
 * @param {Object} viewport - ビューポート情報
 * @returns {number} 世界Y座標
 */
toWorldY(svgY, viewport) {
  // viewBoxを使用しているため、SVG要素上の座標がそのままワールド座標となる
  return svgY;
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
        strokeWidth: 2,
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      railway: {
        stroke: "#333333",
        strokeWidth: 2,
        strokeDasharray: "5,5",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      river: {
        stroke: "#3388ff",
        strokeWidth: 2,
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      trade_route: {
        stroke: "#ff8800",
        strokeWidth: 2,
        strokeDasharray: "10,2",
        textColor: "#000000",
        fontSize: 10,
        showLabel: true
      },
      border: {
        stroke: "#ff0000",
        strokeWidth: 3,
        strokeDasharray: "",
        textColor: "#000000",
        fontSize: 10,
        showLabel: false
      },
      // デフォルトスタイル
      default: {
        stroke: "#3388ff",
        strokeWidth: 2,
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
        strokeWidth: 2,
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 14,
        showLabel: true
      },
      empire: {
        fill: "#8888ff",
        stroke: "#0000ff",
        strokeWidth: 2,
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 16,
        showLabel: true
      },
      province: {
        fill: "#88ff88",
        stroke: "#008800",
        strokeWidth: 2,
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 12,
        showLabel: true
      },
      ocean: {
        fill: "#3388ff",
        stroke: "#3388ff",
        strokeWidth: 1,
        fillOpacity: 0.4,
        textColor: "#000000",
        fontSize: 14,
        showLabel: true
      },
      lake: {
        fill: "#3388ff",
        stroke: "#3388ff",
        strokeWidth: 1,
        fillOpacity: 0.6,
        textColor: "#000000",
        fontSize: 12,
        showLabel: true
      },
      // デフォルトスタイル
      default: {
        fill: "#ffcc88",
        stroke: "#ff8800",
        strokeWidth: 2,
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
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", this._toScreenX(x, viewport));
    circle.setAttribute("cy", this._toScreenY(y, viewport));
    circle.setAttribute("r", (style.radius || 5) / Math.sqrt(viewport.zoom)); // ズームに応じて調整
    circle.setAttribute("fill", style.fill || "#ff0000");
    circle.setAttribute("stroke", style.stroke || "#000000");
    circle.setAttribute("stroke-width", (style.strokeWidth || 1) / viewport.zoom); // ズームに応じて調整
    // クリックイベントを透過させる
    circle.setAttribute("pointer-events", "none");

    this._mainGroup.appendChild(circle);
    return circle;
  }

  /**
   * 線を描画 (一時要素用)
   * @param {Array<{x: number, y: number}>} points - 点の配列
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  drawLine(points, style, viewport) {
    if (!points || points.length < 2) return null; // 点が2つ以上ないと線は描けない

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");

    let pathData = `M ${this._toScreenX(points[0].x, viewport)} ${this._toScreenY(points[0].y, viewport)}`;

    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${this._toScreenX(points[i].x, viewport)} ${this._toScreenY(points[i].y, viewport)}`;
    }

    line.setAttribute("d", pathData);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", style.stroke || "#000000");
    line.setAttribute("stroke-width", (style.strokeWidth || 2) / viewport.zoom); // ズームに応じて調整
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
    const baseFontSize = style.fontSize || 12;
    const fontSize = Math.max(6, Math.min(18, baseFontSize / Math.sqrt(viewport.zoom)));

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", this._toScreenX(x, viewport));
    text.setAttribute("y", this._toScreenY(y, viewport));
    text.setAttribute("text-anchor", style.textAnchor || "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-size", fontSize);
    text.setAttribute("fill", style.textColor || "#000000");
    text.style.textShadow = "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff"; // 白い縁取り
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
    // 既存の背景要素をクリア
    const existingBackground = this._svg.querySelector('.background-map');
    if (existingBackground) {
      existingBackground.remove();
    }

    // 新しい背景グループ要素を作成
    const backgroundGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    backgroundGroup.setAttribute("class", "background-map");
    // 背景地図がクリックイベントを拾わないようにする
    backgroundGroup.setAttribute("pointer-events", "none");


    // SVG文字列からDOMを解析して挿入
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgElement = svgDoc.documentElement;

    // SVGの内容をグループに追加
    // 注意: importNodeを使用して他のドキュメントからノードをインポート
    for (const child of svgElement.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        backgroundGroup.appendChild(document.importNode(child, true));
      }
    }

    // メイングループの最初の子として挿入 (グリッドより下)
    this._mainGroup.insertBefore(backgroundGroup, this._gridGroup);

    console.log('背景地図を設定しました');
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
