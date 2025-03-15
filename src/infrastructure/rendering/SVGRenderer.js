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
    this._svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  /**
   * 地図を描画
   * @param {Object} world - 世界データ
   * @param {Object} viewport - ビューポート情報 { x, y, zoom, width, height }
   * @param {TimePoint} currentTime - 現在の時間点
   */
  render(world, viewport, currentTime) {
    // グリッドを描画
    this._renderGrid(viewport);
    
    // 地物を描画
    this._clearFeatures();
    
    // レイヤーを順序でソート
    const sortedLayers = [...world.layers].sort((a, b) => a.order - b.order);
    
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
      
      // 地物を種類別に分けて描画順序を制御
      const polygons = layerFeatures.filter(f => f instanceof Polygon);
      const lines = layerFeatures.filter(f => f instanceof Line);
      const points = layerFeatures.filter(f => f instanceof Point);
      
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
    
    const { x, y, zoom, width, height } = viewport;
    
    // グリッド間隔（度単位）
    const gridInterval = this._options.gridInterval;
    
    // 描画領域の範囲（経度・緯度）
    const left = x - width / 2 / zoom;
    const right = x + width / 2 / zoom;
    const top = y - height / 2 / zoom;
    const bottom = y + height / 2 / zoom;
    
    // 緯線（横線）を描画
    const latStep = gridInterval;
    for (let lat = Math.floor(top / latStep) * latStep; lat <= bottom; lat += latStep) {
      // 赤道（0度）は強調表示
      const isEquator = Math.abs(lat) < 0.001;
      
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", this._toScreenX(left, viewport));
      line.setAttribute("y1", this._toScreenY(lat, viewport));
      line.setAttribute("x2", this._toScreenX(right, viewport));
      line.setAttribute("y2", this._toScreenY(lat, viewport));
      line.setAttribute("stroke", isEquator ? "#ff0000" : this._options.gridColor);
      line.setAttribute("stroke-width", isEquator ? 2 : 1);
      line.setAttribute("opacity", this._options.gridOpacity);
      
      this._gridGroup.appendChild(line);
      
      // 緯度ラベル
      if (Math.abs(lat) > 0.001) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", this._toScreenX(left + 1, viewport));
        text.setAttribute("y", this._toScreenY(lat, viewport) - 5);
        text.setAttribute("font-size", "10");
        text.setAttribute("fill", this._options.gridColor);
        text.textContent = `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`;
        
        this._gridGroup.appendChild(text);
      }
    }
    
    // 経線（縦線）を描画
    const lngStep = gridInterval;
    for (let lng = Math.floor(left / lngStep) * lngStep; lng <= right; lng += lngStep) {
      // 本初子午線（0度）と日付変更線（180度）は強調表示
      const isPrimeMeridian = Math.abs(lng) < 0.001;
      const isDateLine = Math.abs(Math.abs(lng) - 180) < 0.001;
      
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", this._toScreenX(lng, viewport));
      line.setAttribute("y1", this._toScreenY(top, viewport));
      line.setAttribute("x2", this._toScreenX(lng, viewport));
      line.setAttribute("y2", this._toScreenY(bottom, viewport));
      line.setAttribute("stroke", isPrimeMeridian || isDateLine ? "#ff0000" : this._options.gridColor);
      line.setAttribute("stroke-width", isPrimeMeridian || isDateLine ? 2 : 1);
      line.setAttribute("opacity", this._options.gridOpacity);
      
      this._gridGroup.appendChild(line);
      
      // 経度ラベル
      if (!isPrimeMeridian) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", this._toScreenX(lng, viewport) + 5);
        text.setAttribute("y", this._toScreenY(top + 1, viewport));
        text.setAttribute("font-size", "10");
        text.setAttribute("fill", this._options.gridColor);
        text.textContent = `${Math.abs(lng)}°${lng >= 0 ? 'E' : 'W'}`;
        
        this._gridGroup.appendChild(text);
      }
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
    circle.setAttribute("r", style.radius);
    circle.setAttribute("fill", style.fill);
    circle.setAttribute("stroke", style.stroke);
    circle.setAttribute("stroke-width", style.strokeWidth);
    
    group.appendChild(circle);
    
    // ラベルを描画（オプション）
    if (property.name && style.showLabel) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", this._toScreenX(vertex.x, viewport));
      text.setAttribute("y", this._toScreenY(vertex.y, viewport) - style.radius - 5);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", style.fontSize);
      text.setAttribute("fill", style.textColor);
      text.textContent = property.name;
      
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
    if (lineVertices.some(v => !v)) return null;
    
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
    pathElement.setAttribute("stroke-width", style.strokeWidth);
    pathElement.setAttribute("stroke-dasharray", style.strokeDasharray || "");
    
    group.appendChild(pathElement);
    
    // ラベルを描画（オプション）
    if (property.name && style.showLabel) {
      // 線の中央位置を計算
      const midIndex = Math.floor(lineVertices.length / 2);
      const x = this._toScreenX(lineVertices[midIndex].x, viewport);
      const y = this._toScreenY(lineVertices[midIndex].y, viewport);
      
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x);
      text.setAttribute("y", y - 5);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", style.fontSize);
      text.setAttribute("fill", style.textColor);
      text.textContent = property.name;
      
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
    
    if (polygon.isMultiPolygon) {
      // 飛び地の描画
      for (const subPoly of polygon.subPolygons) {
        const subVertices = subPoly.vertexIds.map(id => vertices.find(v => v.id === id));
        if (subVertices.some(v => !v)) continue;
        
        const path = this._createPolygonPath(subVertices, subPoly.holesVertexIds, vertices, viewport);
        path.setAttribute("fill", style.fill);
        path.setAttribute("stroke", style.stroke);
        path.setAttribute("stroke-width", style.strokeWidth);
        path.setAttribute("opacity", style.fillOpacity);
        
        group.appendChild(path);
      }
    } else if (polygon.vertexIds && polygon.vertexIds.length > 0) {
      // 通常の多角形
      const polyVertices = polygon.vertexIds.map(id => vertices.find(v => v.id === id));
      if (polyVertices.some(v => !v)) return null;
      
      const path = this._createPolygonPath(polyVertices, polygon.holesVertexIds, vertices, viewport);
      path.setAttribute("fill", style.fill);
      path.setAttribute("stroke", style.stroke);
      path.setAttribute("stroke-width", style.strokeWidth);
      path.setAttribute("opacity", style.fillOpacity);
      
      group.appendChild(path);
    } else if (polygon.childIds && polygon.childIds.length > 0) {
      // 子ポリゴンから構成される多角形の処理
      // この簡易実装では省略
    }
    
    // ラベルを描画（オプション）
    if (property.name && style.showLabel) {
      // 多角形の中心を計算
      let centroidX = 0;
      let centroidY = 0;
      let vertexCount = 0;
      
      // 通常ポリゴンの場合
      if (!polygon.isMultiPolygon && polygon.vertexIds && polygon.vertexIds.length > 0) {
        const polyVertices = polygon.vertexIds.map(id => vertices.find(v => v.id === id)).filter(v => v);
        vertexCount = polyVertices.length;
        
        for (const vertex of polyVertices) {
          centroidX += vertex.x;
          centroidY += vertex.y;
        }
      } 
      // 飛び地の場合、最初のサブポリゴンの中心を使用
      else if (polygon.isMultiPolygon && polygon.subPolygons.length > 0) {
        const subVertices = polygon.subPolygons[0].vertexIds
          .map(id => vertices.find(v => v.id === id))
          .filter(v => v);
        
        vertexCount = subVertices.length;
        
        for (const vertex of subVertices) {
          centroidX += vertex.x;
          centroidY += vertex.y;
        }
      }
      
      if (vertexCount > 0) {
        centroidX /= vertexCount;
        centroidY /= vertexCount;
        
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", this._toScreenX(centroidX, viewport));
        text.setAttribute("y", this._toScreenY(centroidY, viewport));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", style.fontSize);
        text.setAttribute("fill", style.textColor);
        text.textContent = property.name;
        
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
    
    // 穴のパスデータ
    for (const holeIds of holesVertexIds) {
      const holeVertices = holeIds.map(id => allVertices.find(v => v.id === id)).filter(v => v);
      
      if (holeVertices.length > 0) {
        pathData += ` M ${this._toScreenX(holeVertices[0].x, viewport)} ${this._toScreenY(holeVertices[0].y, viewport)}`;
        
        for (let i = 1; i < holeVertices.length; i++) {
          pathData += ` L ${this._toScreenX(holeVertices[i].x, viewport)} ${this._toScreenY(holeVertices[i].y, viewport)}`;
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
    const { x, zoom, width } = viewport;
    return (worldX - x) * zoom + width / 2;
  }

  /**
   * 世界座標からスクリーン座標へのY変換
   * @param {number} worldY - 世界Y座標
   * @param {Object} viewport - ビューポート情報
   * @returns {number} スクリーンY座標
   * @private
   */
  _toScreenY(worldY, viewport) {
    const { y, zoom, height } = viewport;
    return (worldY - y) * zoom + height / 2;
  }

  /**
   * スクリーン座標から世界座標へのX変換
   * @param {number} screenX - スクリーンX座標
   * @param {Object} viewport - ビューポート情報
   * @returns {number} 世界X座標
   */
  toWorldX(screenX, viewport) {
    const { x, zoom, width } = viewport;
    return (screenX - width / 2) / zoom + x;
  }

  /**
   * スクリーン座標から世界座標へのY変換
   * @param {number} screenY - スクリーンY座標
   * @param {Object} viewport - ビューポート情報
   * @returns {number} 世界Y座標
   */
  toWorldY(screenY, viewport) {
    const { y, zoom, height } = viewport;
    return (screenY - height / 2) / zoom + y;
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
   * 点を描画
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
    circle.setAttribute("r", style.radius || 5);
    circle.setAttribute("fill", style.fill || "#ff0000");
    circle.setAttribute("stroke", style.stroke || "#000000");
    circle.setAttribute("stroke-width", style.strokeWidth || 1);
    
    this._mainGroup.appendChild(circle);
    return circle;
  }

  /**
   * 線を描画
   * @param {Array<{x: number, y: number}>} points - 点の配列
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  drawLine(points, style, viewport) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    
    let pathData = `M ${this._toScreenX(points[0].x, viewport)} ${this._toScreenY(points[0].y, viewport)}`;
    
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${this._toScreenX(points[i].x, viewport)} ${this._toScreenY(points[i].y, viewport)}`;
    }
    
    line.setAttribute("d", pathData);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", style.stroke || "#000000");
    line.setAttribute("stroke-width", style.strokeWidth || 2);
    line.setAttribute("stroke-dasharray", style.strokeDasharray || "");
    
    this._mainGroup.appendChild(line);
    return line;
  }

  /**
   * テキストを描画
   * @param {number} x - 世界X座標
   * @param {number} y - 世界Y座標
   * @param {string} content - テキスト内容
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  drawText(x, y, content, style, viewport) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", this._toScreenX(x, viewport));
    text.setAttribute("y", this._toScreenY(y, viewport));
    text.setAttribute("text-anchor", style.textAnchor || "middle");
    text.setAttribute("font-size", style.fontSize || 12);
    text.setAttribute("fill", style.textColor || "#000000");
    text.textContent = content;
    
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
    
    // メイングループの最初の子として挿入
    this._mainGroup.insertBefore(backgroundGroup, this._mainGroup.firstChild);
    
    console.log('背景地図を設定しました');
  }
}