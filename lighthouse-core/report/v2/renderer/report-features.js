/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

/* globals self URL Blob Logger */

class ReportUIFeatures {

  /**
   * @param {!DOM} dom
   */
  constructor(dom) {
    this.json = null;
    /** @private {!DOM} */
    this._dom = dom;
    /** @private {!Document} */
    this._document = this._dom.document();
    /** @private {boolean} */
    this._copyAttempt = false;
    /** @type {Element} **/
    this.exportButton = null;

    this.onCopy = this.onCopy.bind(this);
    this.onExportButtonClick = this.onExportButtonClick.bind(this);
    this.onExport = this.onExport.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.printShortCutDetect = this.printShortCutDetect.bind(this);
  }

  /**
   * Adds export button, print, and other functionality to the report. The method
   * should be called whenever the report needs to be re-rendered.
   * @param {!ReportRenderer.ReportJSON} report
   * @param {!Element} container Parent element to render the report into.
   */
  initFeatures(report, container) {
    this.json = report;
    this._setupLogger(container);
    this._setupExportButton();
    this._setUpCollapseDetailsAfterPrinting();
    this._resetUIState();
    this._document.addEventListener('keydown', this.printShortCutDetect);
    this._document.addEventListener('copy', this.onCopy);
  }

  _setupExportButton() {
    this.exportButton = this._dom.find('.lh-export__button', this._document);
    this.exportButton.addEventListener('click', this.onExportButtonClick);

    const dropdown = this._dom.find('.lh-export__dropdown', this._document);
    dropdown.addEventListener('click', this.onExport);
  }

  /**
   * @param {!Element} container Parent element to render the report into.
   */
  _setupLogger(container) {
    const loggerEl = this._dom.createElement('div', null, {id: 'lh-log'});
    container.appendChild(loggerEl);
    this.logger = new Logger(loggerEl);
  }

  /**
   * Handler copy events.
   * @param {!Event} e
   */
  onCopy(e) {
    // Only handle copy button presses (e.g. ignore the user copying page text).
    if (this._copyAttempt) {
      // We want to write our own data to the clipboard, not the user's text selection.
      e.preventDefault();
      e.clipboardData.setData('text/plain', JSON.stringify(this.json, null, 2));
      this.logger.log('Report JSON copied to clipboard');
    }

    this._copyAttempt = false;
  }

  /**
   * Copies the report JSON to the clipboard (if supported by the browser).
   */
  onCopyButtonClick() {
    if (self.ga) {
      self.ga('send', 'event', 'report', 'copy');
    }

    try {
      if (this._document.queryCommandSupported('copy')) {
        this._copyAttempt = true;

        // Note: In Safari 10.0.1, execCommand('copy') returns true if there's
        // a valid text selection on the page. See http://caniuse.com/#feat=clipboard.
        if (!this._document.execCommand('copy')) {
          this._copyAttempt = false; // Prevent event handler from seeing this as a copy attempt.
          this.logger.warn('Your browser does not support copy to clipboard.');
        }
      }
    } catch (/** @type {!Error} */ e) {
      this._copyAttempt = false;
      this.logger.log(e.message);
    }
  }

  closeExportDropdown() {
    this.exportButton.classList.remove('active');
  }

  /**
   * Click handler for export button.
   * @param {!Event} e
   */
  onExportButtonClick(e) {
    e.preventDefault();
    const el = /** @type {!Element} */ (e.target);
    el.classList.toggle('active');
    this._document.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * Resets the state of page before capturing the page for export.
   * When the user opens the exported HTML page, certain UI elements should
   * be in their open state (not opened) and the templates should be refreshly
   * stamped.
   */
  _resetUIState() {
    this.logger.hide();
    this.closeExportDropdown();
    this._dom.findAll('template[data-stamped]', this._document).forEach(t => {
      t.removeAttribute('data-stamped');
    });
  }

  /**
   * Handler for "export as" button.
   * @param {!Event} e
   */
  onExport(e) {
    e.preventDefault();

    const el = /** @type {!Element} */ (e.target);

    if (!el.hasAttribute('data-action')) {
      return;
    }

    switch (el.getAttribute('data-action')) {
      case 'copy':
        this.onCopyButtonClick();
        break;
      case 'open-viewer':
        this.sendJSONReport();
        break;
      case 'print':
        this.expandAllDetails();
        self.print();
        break;
      case 'save-json': {
        const jsonStr = JSON.stringify(this.json, null, 2);
        this._saveFile(new Blob([jsonStr], {type: 'application/json'}));
        break;
      }
      case 'save-html': {
        this._resetUIState();

        const htmlStr = this._document.documentElement.outerHTML;
        try {
          this._saveFile(new Blob([htmlStr], {type: 'text/html'}));
        } catch (/** @type {!Error} */ e) {
          this.logger.error('Could not export as HTML. ' + e.message);
        }
        break;
      }
    }

    this.closeExportDropdown();
    this._document.removeEventListener('keydown', this.onKeyDown);
  }

  /**
   * Keydown handler for the document.
   * @param {!Event} e
   */
  onKeyDown(e) {
    if (e.keyCode === 27) { // ESC
      this.closeExportDropdown();
    }
  }

  /**
   * Opens a new tab to the online viewer and sends the local page's JSON results
   * to the online viewer using postMessage.
   */
  sendJSONReport() {
    const VIEWER_ORIGIN = 'https://googlechrome.github.io';
    const VIEWER_URL = `${VIEWER_ORIGIN}/lighthouse/viewer/`;

    // Chrome doesn't allow us to immediately postMessage to a popup right
    // after it's created. Normally, we could also listen for the popup window's
    // load event, however it is cross-domain and won't fire. Instead, listen
    // for a message from the target app saying "I'm open".
    self.addEventListener('message', function msgHandler(/** @type {!Event} */ evt) {
      const e = /** @type {!MessageEvent} */ (evt);

      if (e.origin !== VIEWER_ORIGIN) {
        return;
      }

      if (e.data['opened']) {
        popup.postMessage({lhresults: this.json}, VIEWER_ORIGIN);
        self.removeEventListener('message', msgHandler);
      }
    }.bind(this));

    const popup = self.open(VIEWER_URL, '_blank');
  }

  /**
   * Expands audit details when user prints via keyboard shortcut.
   * @param {!Event} e
   */
  printShortCutDetect(e) {
    if ((e.ctrlKey || e.metaKey) && e.keyCode === 80) { // Ctrl+P
      this.expandAllDetails();
    }
  }

  /**
   * Expands all audit `<details>`.
   * Ideally, a print stylesheet could take care of this, but CSS has no way to
   * open a `<details>` element.
   */
  expandAllDetails() {
    const details = this._dom.findAll('.lh-categories details', this._document);
    details.map(detail => detail.open = true);
  }

  /**
   * Collapses all audit `<details>`.
   * open a `<details>` element.
   */
  collapseAllDetails() {
    const details = this._dom.findAll('.lh-categories details', this._document);
    details.map(detail => detail.open = false);
  }

  /**
   * Sets up listeners to collapse audit `<details>` when the user closes the
   * print dialog, all `<details>` are collapsed.
   */
  _setUpCollapseDetailsAfterPrinting() {
    // FF and IE implement these old events.
    if ('onbeforeprint' in self) {
      self.addEventListener('afterprint', this.collapseAllDetails);
    } else {
      // Note: FF implements both window.onbeforeprint and media listeners. However,
      // it doesn't matchMedia doesn't fire when matching 'print'.
      self.matchMedia('print').addListener(mql => {
        if (mql.matches) {
          this.expandAllDetails();
        } else {
          this.collapseAllDetails();
        }
      });
    }
  }
  /**
   * Downloads a file (blob) using a[download].
   * @param {!Blob|!File} blob The file to save.
   */
  _saveFile(blob) {
    const filename = self.getFilenamePrefix({
      url: this.json.url,
      generatedTime: this.json.generatedTime
    });

    const ext = blob.type.match('json') ? '.json' : '.html';
    const href = URL.createObjectURL(blob);

    const a = this._dom.createElement('a');
    a.download = `${filename}${ext}`;
    a.href = href;
    this._document.body.appendChild(a); // Firefox requires anchor to be in the DOM.
    a.click();

    // cleanup.
    this._document.body.removeChild(a);
    setTimeout(_ => URL.revokeObjectURL(href), 500);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportUIFeatures;
} else {
  self.ReportUIFeatures = ReportUIFeatures;
}

/** @type {function({url: string, generatedTime: string}): string} */
self.getFilenamePrefix; // eslint-disable-line no-unused-expressions
