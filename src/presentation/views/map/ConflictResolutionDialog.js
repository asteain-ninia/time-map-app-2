function buildPath(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return '';
  }
  let path = `M ${points[0].x} ${-points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${-points[i].y}`;
  }
  path += ' Z';
  return path;
}

function getBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(point => {
    if (!point) return;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

export class ConflictResolutionDialog {
  constructor() {
    this._activeDialog = null;
  }

  showSplitSelection(container, { ringA, ringB, smallerIndex }) {
    if (!container) {
      return Promise.reject(new Error('Dialog container is missing.'));
    }
    if (this._activeDialog) {
      this._activeDialog.remove();
      this._activeDialog = null;
    }

    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'conflict-resolution-dialog';
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 40;
      `;

      const panel = document.createElement('div');
      panel.style.cssText = `
        background: #ffffff;
        border: 1px solid #ccc;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        padding: 16px;
        width: min(520px, 92%);
      `;

      const title = document.createElement('div');
      title.textContent = 'プロパティ継承先の選択';
      title.style.cssText = 'font-weight: bold; margin-bottom: 10px;';
      panel.appendChild(title);

      const previewWrap = document.createElement('div');
      previewWrap.style.cssText = `
        position: relative;
        width: 100%;
        height: 260px;
        aspect-ratio: 4 / 3;
        border: 1px solid #ccc;
        background: #f6f6f6;
        overflow: hidden;
      `;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      const smallerRing = smallerIndex === 1 ? ringB : ringA;
      const bbox = getBoundingBox(smallerRing) || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
      const width = Math.max(1, bbox.maxX - bbox.minX);
      const height = Math.max(1, bbox.maxY - bbox.minY);
      const marginX = width * 0.15;
      const marginY = height * 0.15;
      const viewBoxMinX = bbox.minX - marginX;
      const viewBoxMinY = -bbox.maxY - marginY;
      const viewBoxWidth = width + marginX * 2;
      const viewBoxHeight = height + marginY * 2;
      svg.setAttribute('viewBox', `${viewBoxMinX} ${viewBoxMinY} ${viewBoxWidth} ${viewBoxHeight}`);

      const pathA = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathA.setAttribute('d', buildPath(ringA));
      const pathB = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathB.setAttribute('d', buildPath(ringB));

      const baseStyle = {
        fill: 'rgba(0, 140, 255, 0.25)',
        stroke: '#0066aa',
        strokeWidth: '1'
      };
      const highlightStyle = {
        fill: 'rgba(255, 120, 0, 0.35)',
        stroke: '#ff6600',
        strokeWidth: '2'
      };

      const setPathStyle = (path, style) => {
        path.setAttribute('fill', style.fill);
        path.setAttribute('stroke', style.stroke);
        path.setAttribute('stroke-width', style.strokeWidth);
      };

      setPathStyle(pathA, baseStyle);
      setPathStyle(pathB, baseStyle);
      pathA.style.cursor = 'pointer';
      pathB.style.cursor = 'pointer';

      svg.appendChild(pathA);
      svg.appendChild(pathB);
      previewWrap.appendChild(svg);

      const buttonA = document.createElement('button');
      buttonA.textContent = 'こちらに引き継ぐ';
      buttonA.style.cssText = 'position: absolute; top: 8px; left: 8px;';
      const buttonB = document.createElement('button');
      buttonB.textContent = 'こちらに引き継ぐ';
      buttonB.style.cssText = 'position: absolute; top: 8px; right: 8px;';

      previewWrap.appendChild(buttonA);
      previewWrap.appendChild(buttonB);
      panel.appendChild(previewWrap);

      const buttonsRow = document.createElement('div');
      buttonsRow.style.cssText = 'margin-top: 12px; text-align: right;';
      const confirmButton = document.createElement('button');
      confirmButton.textContent = '確定';
      confirmButton.dataset.action = 'confirm';
      confirmButton.disabled = true;
      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'キャンセル';
      cancelButton.dataset.action = 'cancel';
      cancelButton.style.marginLeft = '10px';
      buttonsRow.appendChild(confirmButton);
      buttonsRow.appendChild(cancelButton);
      panel.appendChild(buttonsRow);

      overlay.appendChild(panel);
      container.appendChild(overlay);
      this._activeDialog = overlay;
      overlay.tabIndex = -1;
      overlay.focus();

      let selectedIndex = null;
      const applySelection = (index) => {
        selectedIndex = index;
        setPathStyle(pathA, index === 0 ? highlightStyle : baseStyle);
        setPathStyle(pathB, index === 1 ? highlightStyle : baseStyle);
        confirmButton.disabled = selectedIndex === null;
      };

      const handleSelect = (index) => applySelection(index);
      buttonA.addEventListener('click', () => handleSelect(0));
      buttonB.addEventListener('click', () => handleSelect(1));
      pathA.addEventListener('click', () => handleSelect(0));
      pathB.addEventListener('click', () => handleSelect(1));

      confirmButton.addEventListener('click', () => {
        if (selectedIndex === null) return;
        overlay.remove();
        this._activeDialog = null;
        resolve(selectedIndex);
      });

      cancelButton.addEventListener('click', () => {
        overlay.remove();
        this._activeDialog = null;
        reject(new Error('cancelled'));
      });
    });
  }
}
