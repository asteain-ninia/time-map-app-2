// src/presentation/views/map/MapContextMenu.js

export class MapContextMenu {
  constructor() {
    this._menuElement = document.createElement('div');
    this._menuElement.className = 'map-context-menu';
    this._menuElement.style.cssText = [
      'position: fixed',
      'z-index: 1000',
      'display: none',
      'min-width: 180px',
      'background: #ffffff',
      'border: 1px solid rgba(0,0,0,0.15)',
      'border-radius: 4px',
      'box-shadow: 0 4px 16px rgba(0,0,0,0.2)',
      'padding: 4px 0',
      'font-family: "Segoe UI", sans-serif',
      'font-size: 14px',
      'color: #333333'
    ].join(';');

    this._listElement = document.createElement('ul');
    this._listElement.style.cssText = 'list-style: none; margin: 0; padding: 0;';
    this._menuElement.appendChild(this._listElement);

    document.body.appendChild(this._menuElement);

    this._outsideClickHandler = this._handleOutsideClick.bind(this);
    this._escapeHandler = this._handleKeyDown.bind(this);
    this._isVisible = false;
  }

  show(screenX, screenY, items) {
    this.hide();
    if (!items || items.length === 0) return;

    this._listElement.innerHTML = '';

    items.forEach(item => {
      if (item.type === 'separator') {
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; margin: 4px 0; background: rgba(0,0,0,0.1);';
        this._listElement.appendChild(separator);
        return;
      }

      const entry = document.createElement('li');
      entry.textContent = item.label;
      entry.style.cssText = [
        'padding: 6px 16px',
        'cursor: pointer',
        'white-space: nowrap',
        'user-select: none'
      ].join(';');

      if (item.disabled) {
        entry.style.color = '#999999';
        entry.style.cursor = 'default';
      } else {
        entry.addEventListener('mouseenter', () => {
          entry.style.backgroundColor = 'rgba(0,0,0,0.05)';
        });
        entry.addEventListener('mouseleave', () => {
          entry.style.backgroundColor = 'transparent';
        });
        entry.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          this.hide();
          if (typeof item.action === 'function') {
            try {
              await Promise.resolve(item.action());
            } catch (error) {
              console.error('Context menu action failed', error);
            }
          }
        });
      }

      if (item.danger) {
        entry.style.color = '#d93026';
      }

      this._listElement.appendChild(entry);
    });

    this._menuElement.style.display = 'block';
    this._menuElement.style.left = `${screenX}px`;
    this._menuElement.style.top = `${screenY}px`;

    const rect = this._menuElement.getBoundingClientRect();
    let left = screenX;
    let top = screenY;
    const padding = 8;

    if (rect.right + padding > window.innerWidth) {
      left = Math.max(padding, window.innerWidth - rect.width - padding);
    }
    if (rect.bottom + padding > window.innerHeight) {
      top = Math.max(padding, window.innerHeight - rect.height - padding);
    }

    this._menuElement.style.left = `${left}px`;
    this._menuElement.style.top = `${top}px`;

    this._isVisible = true;
    setTimeout(() => {
      document.addEventListener('mousedown', this._outsideClickHandler, true);
      document.addEventListener('contextmenu', this._outsideClickHandler, true);
      document.addEventListener('keydown', this._escapeHandler, true);
    }, 0);
  }

  hide() {
    if (!this._isVisible) return;
    this._isVisible = false;
    this._menuElement.style.display = 'none';
    document.removeEventListener('mousedown', this._outsideClickHandler, true);
    document.removeEventListener('contextmenu', this._outsideClickHandler, true);
    document.removeEventListener('keydown', this._escapeHandler, true);
  }

  _handleOutsideClick(event) {
    if (!this._menuElement.contains(event.target)) {
      this.hide();
    }
  }

  _handleKeyDown(event) {
    if (event.key === 'Escape') {
      this.hide();
    }
  }
}
