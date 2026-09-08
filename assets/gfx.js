/* 그래프 그리기 공용 규칙 (graph.html · onboard.html · safari.html 이 같이 쓴다).
   레퍼런스(careerhackeralex.com/memory)의 별자리 룩: 거의 검정 캔버스, 작은 흰 점 노드, 아주 가는 흰 엣지, 라벨은 소수만.
   건수에 따라 노드 반경·엣지 알파·라벨 수를 정하는 축척 규칙이 여기 있다. 수치는 코디네이터 지시값 그대로. */
(function () {
  "use strict";
  const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));

  /* ── 축척 규칙 ── */
  const rBase = N => clamp(1.4, 22 / Math.sqrt(Math.max(1, N)), 5);
  const edgeAlpha = E => clamp(0.10, 2.4 / Math.sqrt(Math.max(1, E)), 0.35);   // E=26k 0.10 · 7k 0.10 · 350 0.13
  const EDGE_WIDTH = 0.8;
  /* 시드끼리 잇는 금색 엣지 알파. mock 처럼 시드가 많으면 개수로 누른다 */
  const seedEdgeAlpha = k => clamp(0.15, 3 / Math.sqrt(Math.max(1, k)), 0.6);
  /* 항상 붙는 라벨 수(시드·추천 외 차수 상위). z 는 줌 배율 */
  const labelBudget = (N, z) => (z >= 3 ? Infinity : z >= 1.8 ? Math.ceil(N / 10) : Math.max(6, Math.ceil(N / 60)));
  /* 피인용을 0~1 로. log 눈금, 상한은 그래프 안 최대 */
  const citesNorm = (cites, maxLog) => (maxLog > 0 ? clamp(0, Math.log10((+cites || 0) + 1) / maxLog, 1) : 0);
  const nodeRadius = (rb, cn) => rb * (0.8 + 0.6 * cn);
  /* 결정적 해시로 노드마다 밝기 0.55~1.0 (별자리 깊이감) */
  function brightness(id) {
    let h = 2166136261; const s = String(id);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 0.55 + ((h % 1000) / 1000) * 0.45;
  }

  /* ── 색 ── */
  const COLORS = {
    bg: "#0f0f0e", bgEdge: "#080808",
    node: "#e9e7df", nodeAlpha: 0.85, label: "#ededed", edge: "#f0efe8",
    model: "#a78bfa", article: "#f59e0b", gold: "#E5B84A", goldDeep: "#A97406", blue: "#7DA2FF", blueDeep: "#2B5FE3", skip: "#8a877e",
    hot: "#E5B84A", search: "#ffffff"
  };
  /* 토픽별 파스텔 (채도 낮게, 12색). 슬러그 순서는 손 코퍼스의 topic 값 */
  const TOPIC_PALETTE = {
    arch: "#9db4e8", moe: "#e8b48f", eff: "#8fd3c8", align: "#e3cf8a", reason: "#c3b1ec", rag: "#93cfe0",
    sys: "#c7b6d8", ssm: "#e69fbb", vis: "#a7d8a0", eval: "#d5d78f", opt: "#e8a3a0", scale: "#b3bccf"
  };
  const topicColor = slug => TOPIC_PALETTE[slug] || "#c9c6bc";

  /* ── 배경 별 점과 비네트 ── */
  function stars(W, H, seed, count) {
    let s = (seed || 7) >>> 0; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const n = count || Math.round(clamp(60, (W * H) / 9000, 120));
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: rnd() * W, y: rnd() * H, r: 0.5 + rnd() * 0.9, a: 0.06 + rnd() * 0.12 });
    return out;
  }
  function paintBackground(ctx, W, H, starList) {
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
    if (starList) for (const st of starList) { ctx.globalAlpha = st.a; ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1;
    // 가장자리로 갈수록 살짝 어두운 비네트
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  /* 글로우: 시드·추천·호버에만 (성능) */
  function glow(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha == null ? 0.35 : alpha;
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── 라벨 배치 (충돌 회피) ──
     labels: [{x, y, rad, text, color, pri}]. 우선순위 큰 것부터: 호버·검색 4 > 추천 3 > 시드 2 > 차수 상위 1 > 나머지 0.
     기본은 노드 오른쪽, 화면 오른쪽을 넘으면 노드 왼쪽, 그래도 넘으면 생략. 이미 그린 라벨(과 avoid 사각형)과 겹치면 생략한다.
     opts: { font, size(기본 11), limit(일반 라벨 pri<=1 예산), total(총 상한), shift(겹치면 한 줄 내려 보기, 전환 장면용), halo(배경색 스트로크) }
     돌려주는 것: { drawn, boxes } */
  function drawLabels(ctx, labels, W, H, avoid, opts) {
    const o = opts || {};
    const font = o.font || "sans-serif", size = o.size || 11;
    const placed = (avoid || []).map(r => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }));
    const boxes = [];
    const hit = r => placed.some(p => !(r.x1 < p.x0 || r.x0 > p.x1 || r.y1 < p.y0 || r.y0 > p.y1));
    labels.sort((a, b) => (b.pri || 0) - (a.pri || 0) || (b.w || 0) - (a.w || 0) || a.y - b.y);
    let drawn = 0, general = 0;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `500 ${size}px ${font}`;
    for (const L of labels) {
      if (o.total != null && drawn >= o.total && !(L.pri >= 4)) break;
      const isGeneral = !(L.pri >= 2);
      if (o.limit != null && isGeneral && general >= o.limit) continue;
      const w = ctx.measureText(L.text).width, h = size + 2;
      let x0 = L.x + L.rad + 5;
      if (x0 + w > W - 6) x0 = L.x - L.rad - 5 - w;
      if (x0 < 6) continue;
      let y = L.y + size * 0.35, ok = false;
      for (let tries = 0; tries < (o.shift ? 2 : 1); tries++) {
        const r = { x0, y0: y - h + 3, x1: x0 + w, y1: y + 3 };
        if (r.y0 < 0 || r.y1 > H) break;
        if (!hit(r)) { placed.push(r); boxes.push(r); ok = true; break; }
        y += h + 2;
      }
      if (!ok) continue;
      if (o.halo) { ctx.lineJoin = "round"; ctx.lineWidth = 2; ctx.strokeStyle = o.halo; ctx.strokeText(L.text, x0, y); }
      ctx.fillStyle = L.color || COLORS.label;
      ctx.fillText(L.text, x0, y);
      drawn++; if (isGeneral) general++;
    }
    return { drawn, boxes };
  }
  /* 정지 상태 라벨 총 상한: 화면 면적 기준 */
  const labelCap = (W, H) => Math.max(8, Math.round((W * H) / 28000));

  /* ── 방사 리매핑 + 격자 충돌 완화 ──
     사전 계산 좌표는 전체 코퍼스 기준이라 부분그래프를 그리면 중심만 촘촘하다.
     무게중심 기준 반지름을 r' = R × ((1-α)·(r/R) + α·(rank/N)^0.66) 로 바꾼다 (α 0.5: 원래 반지름과 순위 기반 반지름을 절반씩).
     각도는 유지되고 군집의 유기적 형태가 절반은 남는다. items: [{x, y}] 를 제자리에서 바꾼다 */
  const REMAP_EXP = 0.66, REMAP_MIX = 0.5;
  function remapRadial(items, R, exp, mix) {
    const n = items.length; if (n < 2) return items;
    const p = exp || REMAP_EXP, a = mix == null ? REMAP_MIX : mix;
    let cx = 0, cy = 0; for (const q of items) { cx += q.x; cy += q.y; } cx /= n; cy /= n;
    const order = items.map((q, i) => ({ i, r: Math.hypot(q.x - cx, q.y - cy), ang: Math.atan2(q.y - cy, q.x - cx) })).sort((u, v) => u.r - v.r);
    const Rmax = R || order[order.length - 1].r || 1, R0 = order[order.length - 1].r || 1;
    order.forEach((o, rank) => {
      const rr = Rmax * ((1 - a) * (o.r / R0) + a * Math.pow((rank + 1) / n, p));
      items[o.i].x = cx + Math.cos(o.ang) * rr; items[o.i].y = cy + Math.sin(o.ang) * rr;
    });
    return items;
  }
  /* 격자 기반 충돌 완화: 노드 간 최소 간격 minDist. 이웃은 격자 셀(3×3)로만 찾아 반복당 O(N). 중심의 겹침만 푼다 */
  function relaxGrid(items, minDist, iters) {
    const n = items.length; if (n < 2 || !(minDist > 0)) return items;
    const cell = minDist;
    for (let it = 0; it < (iters || 30); it++) {
      const grid = new Map();
      for (let i = 0; i < n; i++) { const k = Math.floor(items[i].x / cell) + "," + Math.floor(items[i].y / cell); let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i); }
      let moved = 0;
      for (let i = 0; i < n; i++) {
        const gx = Math.floor(items[i].x / cell), gy = Math.floor(items[i].y / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const b = grid.get((gx + dx) + "," + (gy + dy)); if (!b) continue;
          for (const j of b) {
            if (j <= i) continue;
            let ex = items[j].x - items[i].x, ey = items[j].y - items[i].y; let d = Math.hypot(ex, ey);
            if (d >= minDist) continue;
            if (d < 1e-6) { ex = ((i * 7919 + j) % 13) / 13 - 0.5; ey = ((i * 104729 + j) % 17) / 17 - 0.5; d = Math.hypot(ex, ey) || 1; }
            const push = (minDist - d) / 2 / d;
            items[i].x -= ex * push; items[i].y -= ey * push; items[j].x += ex * push; items[j].y += ey * push; moved++;
          }
        }
      }
      if (!moved) break;
    }
    return items;
  }

  /* ── 오프스크린 엣지 레이어: key 가 같으면 다시 그리지 않는다 ── */
  function EdgeLayer() {
    let cv = null, key = null;
    return {
      /* paint(ctx2d) 는 key 가 바뀌었을 때만 불린다. 돌려주는 캔버스를 drawImage 하면 된다 */
      get(k, W, H, DPR, paint) {
        if (!cv) cv = document.createElement("canvas");
        const pw = Math.max(1, Math.round(W * DPR)), ph = Math.max(1, Math.round(H * DPR));
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; key = null; }
        if (key !== k) {
          const c = cv.getContext("2d");
          c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
          paint(c); key = k;
        }
        return cv;
      },
      invalidate() { key = null; }
    };
  }

  /* 간격 3단: 무게중심 기준 방사 스케일 */
  const SPACING = { narrow: 0.8, normal: 1, wide: 1.3 };
  const FONT = '"IBM Plex Sans KR", sans-serif', LABEL_PX = 11;

  window.CG = Object.assign(window.CG || {}, {
    gfx: { clamp, rBase, edgeAlpha, EDGE_WIDTH, seedEdgeAlpha, labelBudget, labelCap, citesNorm, nodeRadius, brightness, COLORS, TOPIC_PALETTE, topicColor, stars, paintBackground, glow, drawLabels, remapRadial, relaxGrid, EdgeLayer, SPACING, FONT, LABEL_PX }
  });
})();
