// CSS 쌓임 맥락은 원자적으로 비교한다. 자식 z-index가 부모의 층을 벗어나지 않는다.
type Layer = readonly [phase: number, z: number, order: number];
function stacking(style: CSSStyleDeclaration, element: Element): boolean {
  const parentDisplay = element.parentElement ? getComputedStyle(element.parentElement).display : "";
  return element === document.documentElement || ["fixed", "sticky"].includes(style.position)
    || (style.zIndex !== "auto" && style.zIndex !== "" && (style.position !== "static" && style.position !== "" || /flex|grid/.test(parentDisplay)))
    || Number(style.opacity || 1) < 1 || style.isolation === "isolate"
    || [style.transform, style.filter, style.perspective, style.backdropFilter].some((value) => value && value !== "none")
    || /paint|layout|strict|content/.test(style.contain)
    || /transform|opacity|filter|perspective/.test(style.willChange)
    || Boolean(style.mixBlendMode && style.mixBlendMode !== "normal");
}
function phase(style: CSSStyleDeclaration, context: boolean): number {
  const z = Number(style.zIndex) || 0;
  if (context && z < 0) return 1;
  if (context && z > 0) return 6;
  if (context || (style.position && style.position !== "static")) return 5;
  if (style.cssFloat && style.cssFloat !== "none") return 3;
  return style.display.startsWith("inline") || style.display === "contents" ? 4 : 2;
}

export function topPainted(elements: HTMLElement[]): HTMLElement | undefined {
  const order = new Map<Element, number>();
  Array.from(document.querySelectorAll("*")).forEach((element, index) => order.set(element, index));
  const keys = new Map<Element, Layer[]>();
  const key = (element: Element): Layer[] => {
    const cached = keys.get(element); if (cached) return cached;
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    const result: Layer[] = [];
    for (const node of ancestors) {
      const style = getComputedStyle(node), context = stacking(style, node);
      // 보통 블록은 새 쌓임 맥락이 아니다. positioned/floating 그룹은 자기 자식의 순서를 유지한다.
      if (node === element || context || phase(style, false) === 5 || phase(style, false) === 3)
        result.push([phase(style, context), context ? Number(style.zIndex) || 0 : 0, order.get(node) ?? 0]);
    }
    keys.set(element, result); return result;
  };
  return elements.sort((a, b) => {
    const ak = key(a), bk = key(b);
    for (let i = 0; i < Math.min(ak.length, bk.length); i++) {
      for (let j = 0; j < 3; j++) { const delta = ak[i][j] - bk[i][j]; if (delta) return delta; }
    }
    return ak.length - bk.length;
  }).at(-1);
}
