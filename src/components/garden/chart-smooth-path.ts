// Cardinal-spline-to-bezier smoothing: each segment's control points are
// derived from the line between its neighbors, so the resulting curve bends
// through every point without the sharp corners a plain polyline would have.
// Standard technique for sparkline-style charts — kept as a standalone pure
// function (no SVG/React) so the math is independently testable.

export interface ChartPoint {
  x: number;
  y: number;
}

const SMOOTHING = 0.2;

function controlPoint(current: ChartPoint, previous: ChartPoint | undefined, next: ChartPoint | undefined, reverse: boolean): ChartPoint {
  const p = previous ?? current;
  const n = next ?? current;
  const lengthX = n.x - p.x;
  const lengthY = n.y - p.y;
  const angle = Math.atan2(lengthY, lengthX) + (reverse ? Math.PI : 0);
  const length = Math.hypot(lengthX, lengthY) * SMOOTHING;
  return {
    x: current.x + Math.cos(angle) * length,
    y: current.y + Math.sin(angle) * length,
  };
}

export function buildSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M ${points[0].x},${points[0].y}`;
  }

  return points.reduce((path, point, i, all) => {
    if (i === 0) {
      return `M ${point.x},${point.y}`;
    }
    const start = controlPoint(all[i - 1], all[i - 2], point, false);
    const end = controlPoint(point, all[i - 1], all[i + 1], true);
    return `${path} C ${start.x},${start.y} ${end.x},${end.y} ${point.x},${point.y}`;
  }, "");
}
