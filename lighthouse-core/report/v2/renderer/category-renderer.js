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

/* globals self */

const RATINGS = {
  PASS: {label: 'pass', minScore: 75},
  AVERAGE: {label: 'average', minScore: 45},
  FAIL: {label: 'fail'}
};

/**
 * Convert a score to a rating label.
 * @param {number} score
 * @return {string}
 */
function calculateRating(score) {
  let rating = RATINGS.FAIL.label;
  if (score >= RATINGS.PASS.minScore) {
    rating = RATINGS.PASS.label;
  } else if (score >= RATINGS.AVERAGE.minScore) {
    rating = RATINGS.AVERAGE.label;
  }
  return rating;
}

/**
 * Format number.
 * @param {number} number
 * @return {string}
 */
function formatNumber(number) {
  return number.toLocaleString(undefined, {maximumFractionDigits: 1});
}

class CategoryRenderer {
  /**
   * @param {!DOM} dom
   * @param {!DetailsRenderer} detailsRenderer
   */
  constructor(dom, detailsRenderer) {
    /** @private {!DOM} */
    this._dom = dom;
    /** @private {!DetailsRenderer} */
    this._detailsRenderer = detailsRenderer;
    /** @private {!Document|!Element} */
    this._templateContext = this._dom.document();
  }

  /**
   * @param {!ReportRenderer.AuditJSON} audit
   * @return {!Element}
   */
  _renderAuditScore(audit) {
    const tmpl = this._dom.cloneTemplate('#tmpl-lh-audit-score', this._templateContext);

    const scoringMode = audit.result.scoringMode;
    const description = audit.result.helpText;
    let title = audit.result.description;

    if (audit.result.displayValue) {
      title += `:  ${audit.result.displayValue}`;
    }
    if (audit.result.optimalValue) {
      title += ` (target: ${audit.result.optimalValue})`;
    }

    // Append audit details to header section so the entire audit is within a <details>.
    const header = /** @type {!HTMLDetailsElement} */ (this._dom.find('.lh-score__header', tmpl));
    header.open = audit.score < 100; // expand failed audits
    if (audit.result.details) {
      header.appendChild(this._detailsRenderer.render(audit.result.details));
    }

    return this._populateScore(tmpl, audit.score, scoringMode, title, description);
  }

  /**
   * @param {!DocumentFragment|!Element} element DOM node to populate with values.
   * @param {number} score
   * @param {string} scoringMode
   * @param {string} title
   * @param {string} description
   * @return {!Element}
   */
  _populateScore(element, score, scoringMode, title, description) {
    // Fill in the blanks.
    const valueEl = this._dom.find('.lh-score__value', element);
    valueEl.textContent = formatNumber(score);
    valueEl.classList.add(`lh-score__value--${calculateRating(score)}`,
        `lh-score__value--${scoringMode}`);

    this._dom.find('.lh-score__title', element).textContent = title;
    this._dom.find('.lh-score__description', element)
        .appendChild(this._dom.createSpanFromMarkdown(description));

    return /** @type {!Element} **/ (element);
  }

  /**
   * @param {!ReportRenderer.CategoryJSON} category
   * @return {!Element}
   */
  _renderCategoryScore(category) {
    const tmpl = this._dom.cloneTemplate('#tmpl-lh-category-score', this._templateContext);
    const score = Math.round(category.score);
    return this._populateScore(tmpl, score, 'numeric', category.name, category.description);
  }

  /**
   * @param {!ReportRenderer.AuditJSON} audit
   * @return {!Element}
   */
  _renderAudit(audit) {
    const element = this._dom.createElement('div', 'lh-audit');
    element.appendChild(this._renderAuditScore(audit));
    return element;
  }

  /**
   * @param {!Document|!Element} context
   */
  setTemplateContext(context) {
    this._templateContext = context;
  }

  /**
   * @param {!ReportRenderer.CategoryJSON} category
   * @param {!Object<string, !ReportRenderer.TagJSON>} tags
   * @return {!Element}
   */
  render(category, tags) {
    switch (category.id) {
      case 'accessibility':
        return this._renderAccessibilityCategory(category, tags);
      default:
        return this._renderDefaultCategory(category);
    }
  }

  /**
   * @param {!ReportRenderer.CategoryJSON} category
   * @return {!Element}
   */
  _renderDefaultCategory(category) {
    const element = this._dom.createElement('div', 'lh-category');
    element.appendChild(this._renderCategoryScore(category));

    const passedAudits = category.audits.filter(audit => audit.score === 100);
    const nonPassedAudits = category.audits.filter(audit => !passedAudits.includes(audit));

    for (const audit of nonPassedAudits) {
      element.appendChild(this._renderAudit(audit));
    }

    // don't create a passed section if there are no passed
    if (!passedAudits.length) return element;

    const passedElem = this._dom.createElement('details', 'lh-passed-audits');
    const passedSummary = this._dom.createElement('summary', 'lh-passed-audits-summary');
    passedSummary.textContent = `View ${passedAudits.length} passed items`;
    passedElem.appendChild(passedSummary);

    for (const audit of passedAudits) {
      passedElem.appendChild(this._renderAudit(audit));
    }
    element.appendChild(passedElem);
    return element;
  }

  /**
   * @param {!Array<!ReportRenderer.AuditJSON>} audits
   * @param {!ReportRenderer.TagJSON} tag
   * @return {!Element}
   */
  _renderAuditGroup(audits, tag) {
      const auditGroupElem = this._dom.createElement('details',
          'lh-audit-group lh-expandable-details');
      const auditGroupHeader = this._dom.createElement('div',
          'lh-audit-group__header lh-expandable-details__header');
      auditGroupHeader.textContent = tag.title;

      const auditGroupDescription = this._dom.createElement('div', 'lh-audit-group__description');
      auditGroupDescription.textContent = tag.description;

      const auditGroupSummary = this._dom.createElement('summary',
          'lh-audit-group__summary lh-expandable-details__summary');
      const auditGroupArrow = this._dom.createElement('div', 'lh-expandable-details__arrow', {
        title: 'See audits',
      });
      auditGroupSummary.appendChild(auditGroupHeader);
      auditGroupSummary.appendChild(auditGroupArrow);

      auditGroupElem.appendChild(auditGroupSummary);
      auditGroupElem.appendChild(auditGroupDescription);
      audits.forEach(audit => auditGroupElem.appendChild(this._renderAudit(audit)));
      return auditGroupElem;
  }

  /**
   * @param {!ReportRenderer.CategoryJSON} category
   * @param {!Object<string, !ReportRenderer.TagJSON>} tags
   * @return {!Element}
   */
  _renderAccessibilityCategory(category, tags) {
    const element = this._dom.createElement('div', 'lh-category');
    element.appendChild(this._renderCategoryScore(category));

    const auditsGroupedByTag = category.audits.reduce((indexed, audit) => {
      const tagId = audit.tags[0];
      const groups = indexed[tagId] || {passed: [], failed: []};

      if (audit.score === 100) {
        groups.passed.push(audit);
      } else {
        groups.failed.push(audit);
      }

      indexed[tagId] = groups;
      return indexed;
    }, {});

    const passedElements = [];
    Object.keys(auditsGroupedByTag).forEach(tagId => {
      const tag = tags[tagId];
      const groups = auditsGroupedByTag[tagId];
      if (groups.failed.length) {
        const auditGroupElem = this._renderAuditGroup(groups.failed, tag);
        auditGroupElem.open = true;
        element.appendChild(auditGroupElem);
      }

      if (groups.passed.length) {
        const auditGroupElem = this._renderAuditGroup(groups.passed, tag);
        passedElements.push(auditGroupElem);
      }
    });

    // don't create a passed section if there are no passed
    if (!passedElements.length) return element;

    const passedElem = this._dom.createElement('details', 'lh-passed-audits');
    const passedSummary = this._dom.createElement('summary', 'lh-passed-audits-summary');
    passedElem.appendChild(passedSummary);
    passedSummary.textContent = `View ${passedElements.length} passed items`;
    passedElements.forEach(elem => passedElem.appendChild(elem));
    element.appendChild(passedElem);
    return element;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CategoryRenderer;
} else {
  self.CategoryRenderer = CategoryRenderer;
}
