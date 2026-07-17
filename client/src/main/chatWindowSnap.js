/*
 * Copyright 2026 Cody Park
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

// Pure edge/position math for "snap to edge", kept separate from index.js so
// it's testable without pulling in Electron's app lifecycle side effects
// (see chatWindowSize.js for the same reasoning).

// Distance from each of a window's 4 edges to the matching edge of `rect`.
function edgeDistances(bounds, rect) {
  return {
    left: bounds.x - rect.x,
    right: rect.x + rect.width - (bounds.x + bounds.width),
    top: bounds.y - rect.y,
    bottom: rect.y + rect.height - (bounds.y + bounds.height),
  };
}

// Nearest edge to snap to, weighing two candidate rectangles for the same
// display: its full physical `boundsRect`, and its `workAreaRect` (bounds
// minus a docked/always-visible taskbar). A window released nearer the
// taskbar's line snaps flush against it; one released nearer the true
// screen edge (e.g. the taskbar is auto-hidden, or hidden behind a
// fullscreen app) snaps past it to the physical edge instead - so the
// window doesn't need to know whether the taskbar is actually visible right
// now, just which line the user dragged it closer to. Returns which of the
// 4 edges is nearest AND which rectangle that measurement came from, so
// later reflows (see index.js's reflowSnappedEdge) stay flush against the
// right one. Always resolves to exactly one edge, even near a corner - no
// corner-snapping. Uses absolute distance so a window already overlapping
// one of the lines (e.g. dragged past the workArea line, into where the
// taskbar sits) still correctly prefers whichever line it's numerically
// closer to, rather than "already past it" reading as infinitely near.
export function nearestEdge(bounds, boundsRect, workAreaRect) {
  const candidates = [
    ...Object.entries(edgeDistances(bounds, boundsRect)).map(([edge, distance]) => ({
      edge,
      target: 'bounds',
      distance: Math.abs(distance),
    })),
    ...Object.entries(edgeDistances(bounds, workAreaRect)).map(([edge, distance]) => ({
      edge,
      target: 'workArea',
      distance: Math.abs(distance),
    })),
  ];
  const winner = candidates.reduce((closest, c) => (c.distance < closest.distance ? c : closest));
  return { edge: winner.edge, target: winner.target };
}

// {x, y} that puts `bounds` flush against `edge` of `rect`, clamping the
// other axis so the window can't hang off the rectangle's other two edges.
// `rect` is whichever of a display's `bounds`/`workArea` nearestEdge chose.
export function snappedPosition(bounds, rect, edge) {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  let x = clamp(bounds.x, rect.x, rect.x + rect.width - bounds.width);
  let y = clamp(bounds.y, rect.y, rect.y + rect.height - bounds.height);
  if (edge === 'left') x = rect.x;
  if (edge === 'right') x = rect.x + rect.width - bounds.width;
  if (edge === 'top') y = rect.y;
  if (edge === 'bottom') y = rect.y + rect.height - bounds.height;
  return { x, y };
}
