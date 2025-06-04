// src/infrastructure/rendering/SVGRendererFeatures.js

import { getPointStyle, getLineStyle, getPolygonStyle } from './RenderStyleProvider.js';

export function applyFeatureMethods(SVGRenderer) {

  /**
   * 点情報を描画
   * @param {Point} point - 点情報
   * @param {Vertex[]} vertices - 頂点配列
   * @param {TimePoint} currentTime - 現在の時間点
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement | null} SVG要素
   * @private
   */
  SVGRenderer.prototype._renderPoint = function(point, vertices, currentTime, viewport) {
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
  SVGRenderer.prototype._renderLine = function(line, vertices, currentTime, viewport) {
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
  SVGRenderer.prototype._renderPolygon = function(polygon, vertices, currentTime, viewport) {
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
  SVGRenderer.prototype._toScreenX = function(worldX, viewport) {
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
  SVGRenderer.prototype._toScreenY = function(worldY, viewport) {
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
  SVGRenderer.prototype._getPointStyle = function(property) {
    return getPointStyle(property);
  }

  /**
   * 線のスタイルを取得
   * @param {Property} property - プロパティ
   * @returns {Object} スタイル情報
   * @private
   */
  SVGRenderer.prototype._getLineStyle = function(property) {
    return getLineStyle(property);
  }

  /**
   * 面のスタイルを取得
   * @param {Property} property - プロパティ
   * @returns {Object} スタイル情報
   * @private
   */
  SVGRenderer.prototype._getPolygonStyle = function(property) {
    return getPolygonStyle(property);
  }

  /**
   * 点を描画 (一時要素用)
   * @param {number} x - 世界X座標
   * @param {number} y - 世界Y座標
   * @param {Object} style - スタイル情報
   * @param {Object} viewport - ビューポート情報
   * @returns {SVGElement} SVG要素
   */
  SVGRenderer.prototype.drawPoint = function(x, y, style, viewport) {
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
  SVGRenderer.prototype.drawLine = function(points, style, viewport) {
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
  SVGRenderer.prototype.drawText = function(x, y, content, style, viewport) {
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
  SVGRenderer.prototype.removeElement = function(element) {
    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }
  /**
 * 背景地図を読み込む
 * @param {string} svgContent - SVG形式の地図内容
 */
  SVGRenderer.prototype.loadBackgroundMap = function(svgContent) {
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
  SVGRenderer.prototype.toggleGrid = function(show) {
    this._options.showGrid = show;
    // 再描画をトリガーする必要がある
    // このメソッドは直接 render を呼ばず、状態変更のみ行う
    // 描画は次の render サイクルで行われる
  }
}
