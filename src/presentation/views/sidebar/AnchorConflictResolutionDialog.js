function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class AnchorConflictResolutionDialog {
  constructor() {
    this._activeDialog = null;
  }

  /**
   * @param {{
   *   conflicts: Array<{id:string,timeLabel?:string,featureIdA:string,featureIdB:string}>,
   *   resolveFeatureLabel: (featureId: string) => string
   * }} options
   * @returns {Promise<Object<string, {preferFeatureId: string}>|null>}
   */
  show(options) {
    const conflicts = Array.isArray(options?.conflicts) ? options.conflicts : [];
    if (conflicts.length === 0) {
      return Promise.resolve({});
    }

    if (this._activeDialog) {
      this._activeDialog.remove();
      this._activeDialog = null;
    }

    const resolveFeatureLabel = typeof options?.resolveFeatureLabel === 'function'
      ? options.resolveFeatureLabel
      : (featureId => `ID: ${featureId}`);

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'anchor-conflict-resolution-dialog';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      `;

      const panel = document.createElement('div');
      panel.style.cssText = `
        width: min(760px, 92vw);
        max-height: 82vh;
        overflow: auto;
        background: #fff;
        border: 1px solid #ccc;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        padding: 16px;
      `;

      const title = document.createElement('h3');
      title.textContent = '競合解決';
      title.style.margin = '0 0 10px 0';
      panel.appendChild(title);

      const lead = document.createElement('p');
      lead.textContent = '競合ごとに優先する地物を選択してください。すべて選択するまで確定できません。';
      lead.style.margin = '0 0 12px 0';
      panel.appendChild(lead);

      const list = document.createElement('div');
      list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
      panel.appendChild(list);

      const selectedByConflict = new Map();
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.textContent = '解決を適用して編集を確定';
      confirmButton.disabled = true;

      const refreshConfirmState = () => {
        confirmButton.disabled = selectedByConflict.size !== conflicts.length;
      };

      conflicts.forEach(conflict => {
        const row = document.createElement('div');
        row.style.cssText = 'border: 1px solid #ddd; border-radius: 4px; padding: 10px;';

        const timeLabel = conflict.timeLabel || '不明時刻';
        const labelA = resolveFeatureLabel(conflict.featureIdA);
        const labelB = resolveFeatureLabel(conflict.featureIdB);
        row.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 6px;">時刻: ${escapeHtml(timeLabel)}</div>
          <div style="font-size: 0.92em; margin-bottom: 6px;">重なり: ${escapeHtml(labelA)} / ${escapeHtml(labelB)}</div>
        `;

        const radioRow = document.createElement('div');
        radioRow.style.cssText = 'display: flex; gap: 12px; flex-wrap: wrap;';

        const createOption = (featureId, label) => {
          const wrapper = document.createElement('label');
          wrapper.style.cssText = 'display: inline-flex; align-items: center; gap: 4px;';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = `conflict-${conflict.id}`;
          input.value = featureId;
          input.addEventListener('change', () => {
            selectedByConflict.set(conflict.id, { preferFeatureId: featureId });
            refreshConfirmState();
          });
          const text = document.createElement('span');
          text.textContent = `${label} を優先`;
          wrapper.appendChild(input);
          wrapper.appendChild(text);
          return wrapper;
        };

        radioRow.appendChild(createOption(conflict.featureIdA, labelA));
        radioRow.appendChild(createOption(conflict.featureIdB, labelB));
        row.appendChild(radioRow);
        list.appendChild(row);
      });

      const actionRow = document.createElement('div');
      actionRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;';
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = 'キャンセル';
      cancelButton.dataset.action = 'cancel';
      cancelButton.addEventListener('click', () => {
        overlay.remove();
        this._activeDialog = null;
        resolve(null);
      });

      confirmButton.addEventListener('click', () => {
        if (selectedByConflict.size !== conflicts.length) {
          return;
        }
        const resolutions = {};
        conflicts.forEach(conflict => {
          const selected = selectedByConflict.get(conflict.id);
          if (selected) {
            resolutions[conflict.id] = selected;
          }
        });
        overlay.remove();
        this._activeDialog = null;
        resolve(resolutions);
      });
      confirmButton.dataset.action = 'confirm';

      actionRow.appendChild(cancelButton);
      actionRow.appendChild(confirmButton);
      panel.appendChild(actionRow);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      this._activeDialog = overlay;
      refreshConfirmState();
    });
  }
}
