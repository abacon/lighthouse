/**
 * @license
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

const ComputedArtifact = require('./computed-artifact');
const TracingProcessor = require('../../lib/traces/tracing-processor');

const LONG_TASK_THRESHOLD = 50;

const MAX_TASK_CLUSTER_DURATION = 250;
const MIN_TASK_CLUSTER_PADDING = 1000;
const MIN_TASK_CLUSTER_FMP_DISTANCE = 5000;

const MAX_QUIET_WINDOW_SIZE = 5000;
const TRACE_BUSY_MSG = 'trace was busy the entire time';

/**
 * @fileoverview This artifact identifies the time the page is "first interactive" as defined below
 * @see https://docs.google.com/document/d/1GGiI9-7KeY3TPqS3YT271upUVimo-XiL5mwWorDUD4c/edit#
 *
 * First Interactive marks the first moment when a website is minimally interactive:
 *    > Enough (but maybe not all) UI components shown on the screen are interactive
 *      DISCLAIMER: This is assumed by virtue of the fact that the CPU is idle, actual event
 *      listeners are not examined, server-side rendering and extreme network latency can dupe this
 *      definition.
 *    > The page responds to user input in a reasonable time on average, but it’s ok if this
 *      response is not always immediate.
 *
 * First Interactive is defined as the first period after FMP of N-seconds that has no bad task
 * clusters.
 *
 *    > t = time in seconds since FMP
 *    > N = f(t) = 4 * e^(-0.045 * t) + 1
 *      5 = f(0) = 4 + 1
 *      3 ~= f(15) ~= 2 + 1
 *      1 ~= f(∞) ~= 0 + 1
 *    > a "bad task cluster" is a cluster of 1 or more long tasks with no more than 1s of idle time
 *      between each task that does one of the following
 *        > Starts within the first 5s after FMP.
 *        > Spans more than 250ms from the start of the earliest task in the cluster to the end of the
 *          latest task in the cluster.
 *
 * If this timestamp is earlier than DOMContentLoaded, use DOMContentLoaded as firstInteractive.
 */
class FirstInteractive extends ComputedArtifact {
  get name() {
    return 'FirstInteractive';
  }

  /**
   * @param {number} t The time passed since FMP in miliseconds.
   * @return {number}
   */
  static getRequiredWindowSizeInMs(t) {
    const tInSeconds = t / 1000;
    const exponentiationComponent = Math.exp(-.045 * tInSeconds);
    return (4 * exponentiationComponent + 1) * 1000;
  }

  /**
   * @param {!Array<{start: number, end: number}>} tasks
   * @param {number} startIndex
   * @param {number} windowEnd
   * @return {!Array<{start: number, end: number, duration: number}>}
   */
  static getTaskClustersInWindow(tasks, startIndex, windowEnd) {
    const clusters = [];

    let previousTaskEndTime = -Infinity;
    let currentCluster = null;

    // Examine all tasks that could possibly be part of a cluster starting before windowEnd.
    // Consider the case where window end is 15s, there's a 100ms task from 14.9-15s and a 500ms
    // task from 15.5-16s, we need that later task to be clustered with the first so we can properly
    // identify that main thread isn't quiet.
    const clusteringWindowEnd = windowEnd + MIN_TASK_CLUSTER_PADDING;
    const couldTaskBelongToCluster = task => task && task.start < clusteringWindowEnd;
    for (let i = startIndex; couldTaskBelongToCluster(tasks[i]); i++) {
      const task = tasks[i];

      // if enough time has elapsed, we'll create a new cluster
      if (task.start - previousTaskEndTime > MIN_TASK_CLUSTER_PADDING) {
        if (currentCluster) {
          clusters.push(currentCluster);
        }

        currentCluster = [];
      }

      currentCluster.push(task);
      previousTaskEndTime = task.end;
    }

    if (currentCluster) {
      clusters.push(currentCluster);
    }

    return clusters
      // add some useful information about the cluster
      .map(tasks => {
        const start = tasks[0].start;
        const end = tasks[tasks.length - 1].end;
        const duration = end - start;
        return {start, end, duration, tasks};
      })
      // filter out clusters that started after the window because of our clusteringWindowEnd
      .filter(cluster => cluster.start < windowEnd);
  }

  /**
   * @param {number} FMP
   * @param {number} traceEnd
   * @param {!Array<{start: number, end: number>}} longTasks
   * @return {number}
   */
  static findQuietWindow(FMP, traceEnd, longTasks) {
    if (longTasks.length === 0 ||
        longTasks[0].start > FMP + MAX_QUIET_WINDOW_SIZE) {
      return FMP;
    }

    // FirstInteractive must start at the end of a long task, consider each long task and
    // examine the window that follows it.
    for (let i = 0; i < longTasks.length; i++) {
      const event = longTasks[i];
      const windowStart = event.end;
      const windowSize = FirstInteractive.getRequiredWindowSizeInMs(windowStart - FMP);
      const windowEnd = windowStart + windowSize;

      // Check that we have a long enough trace
      if (windowEnd > traceEnd) {
        throw new Error(TRACE_BUSY_MSG);
      }

      const isTooCloseToFMP = cluster => cluster.start < FMP + MIN_TASK_CLUSTER_FMP_DISTANCE;
      const isTooLong = cluster => cluster.duration > MAX_TASK_CLUSTER_DURATION;
      const isBadCluster = cluster => isTooCloseToFMP(cluster) || isTooLong(cluster);

      const taskClusters = FirstInteractive.getTaskClustersInWindow(longTasks, i + 1, windowEnd);
      const hasBadTaskClusters = taskClusters.find(isBadCluster);

      if (!hasBadTaskClusters) {
        return windowStart;
      }
    }

    throw new Error(TRACE_BUSY_MSG);
  }

  /**
   * @param {!Trace} trace
   * @param {!tr.Model} traceModel
   * @param {!TraceOfTabArtifact} traceOfTab
   * @return {{timeInMs: number, timestamp: number}}
   */
  computeWithArtifacts(trace, traceModel, traceOfTab) {
    const navStart = traceOfTab.timestamps.navigationStart;
    const FMP = traceOfTab.timings.firstMeaningfulPaint;
    const DCL = traceOfTab.timings.domContentLoaded;
    const traceEnd = traceOfTab.timings.traceEnd;

    if (traceEnd - FMP < MAX_QUIET_WINDOW_SIZE) {
      throw new Error('trace not at least 5 seconds longer than FMP');
    }

    const longTasksAfterFMP = TracingProcessor.getMainThreadTopLevelEvents(traceModel, trace, FMP)
        .filter(evt => evt.end - evt.start >= LONG_TASK_THRESHOLD && evt.end > FMP);
    const firstInteractive = FirstInteractive.findQuietWindow(FMP, traceEnd, longTasksAfterFMP);

    const valueInMs = Math.max(firstInteractive, DCL);
    return {
      timeInMs: valueInMs,
      timestamp: (valueInMs + navStart) * 1000,
    };
  }

  /**
   * @param {!Object} trace
   * @param {!Object} artifacts
   * @return {!Object}
   */
  compute_(trace, artifacts) {
    return Promise.all([
      artifacts.requestTracingModel(trace),
      artifacts.requestTraceOfTab(trace),
    ]).then(([traceModel, traceOfTab]) => {
      return this.computeWithArtifacts(trace, traceModel, traceOfTab);
    });
  }
}

module.exports = FirstInteractive;
