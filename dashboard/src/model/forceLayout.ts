/**
 * 노트-링크 그래프의 점 위치를 계산한다(Obsidian 그래프 보기와 비슷한 힘 배치).
 * Obsidian은 점 위치를 파일에 저장하지 않으므로 같은 데이터로 여기서 다시 배치한다.
 * 같은 입력이면 같은 배치가 나오도록 초기 위치를 결정적으로 정한다.
 */
export interface LayoutNode { id: string; degree: number; x: number; y: number }

export function forceLayout(
  nodes: { id: string; degree: number }[],
  links: { source: string; target: string }[],
  { width, height, iterations = 260 }: { width: number; height: number; iterations?: number },
): LayoutNode[] {
  const n = nodes.length
  if (n === 0) return []
  const index = new Map(nodes.map((nd, i) => [nd.id, i]))
  const xs = new Float64Array(n), ys = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const r = 10 * Math.sqrt(i + 0.5)
    xs[i] = Math.cos(i * golden) * r
    ys[i] = Math.sin(i * golden) * r
  }
  const edges = links.map((l) => [index.get(l.source), index.get(l.target)] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined)
  const linkDist = 46, charge = 900, gravity = 0.012
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[i]! - xs[j]!, dy = ys[i]! - ys[j]!
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) { dx = 0.1; dy = 0.1; d2 = 0.02 }
        if (d2 > 90000) continue
        const f = (charge / d2) * alpha
        const d = Math.sqrt(d2)
        vx[i]! += (dx / d) * f; vy[i]! += (dy / d) * f
        vx[j]! -= (dx / d) * f; vy[j]! -= (dy / d) * f
      }
    }
    for (const [a, b] of edges) {
      const dx = xs[b]! - xs[a]!, dy = ys[b]! - ys[a]!
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = ((d - linkDist) / d) * 0.06 * alpha
      vx[a]! += dx * f; vy[a]! += dy * f
      vx[b]! -= dx * f; vy[b]! -= dy * f
    }
    for (let i = 0; i < n; i++) {
      vx[i]! -= xs[i]! * gravity * alpha; vy[i]! -= ys[i]! * gravity * alpha
      vx[i]! *= 0.6; vy[i]! *= 0.6
      xs[i]! += vx[i]!; ys[i]! += vy[i]!
    }
  }
  // 화면 크기에 맞춰 늘리거나 줄인다(가로세로 비율 유지, 여백 8%).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) { minX = Math.min(minX, xs[i]!); maxX = Math.max(maxX, xs[i]!); minY = Math.min(minY, ys[i]!); maxY = Math.max(maxY, ys[i]!) }
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((width * 0.84) / spanX, (height * 0.84) / spanY, 4)
  const ox = (width - spanX * scale) / 2 - minX * scale, oy = (height - spanY * scale) / 2 - minY * scale
  return nodes.map((nd, i) => ({ id: nd.id, degree: nd.degree, x: xs[i]! * scale + ox, y: ys[i]! * scale + oy }))
}
