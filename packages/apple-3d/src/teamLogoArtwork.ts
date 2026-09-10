type LogoPixels = Pick<ImageData, "data" | "width" | "height">;

export function removeEmbeddedTeamLogoTrademark(source: string, teamId: number) {
  // The Cubs' TM sits on the opaque white disc, so alpha-component cleanup
  // cannot separate it. Remove only the known TM path from that source SVG.
  if (teamId !== 112) return source;
  return source.replace(/<path\b[^>]*\bd=(['"])M174\.54 141\.79h[^'"]*\1[^>]*\/>/, "");
}

function artworkBounds({ data, width, height }: LogoPixels) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (data[pixel * 4 + 3] < 24) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

export function prepareTeamLogoPixels(image: LogoPixels) {
  const { data, width, height } = image;
  const bounds = artworkBounds(image);
  if (!bounds) return { x: 0, y: 0 };

  const visited = new Uint8Array(width * height);
  const components: number[][] = [];
  let opaquePixels = 0;

  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || data[start * 4 + 3] === 0) continue;

    const component = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const pixel = component[cursor];
      const x = pixel % width;
      const y = Math.floor(pixel / width);

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (visited[next] || data[next * 4 + 3] === 0) continue;
          visited[next] = 1;
          component.push(next);
        }
      }
    }
    opaquePixels += component.length;
    components.push(component);
  }

  const largestComponent = Math.max(0, ...components.map((component) => component.length));
  const smallComponentLimit = Math.max(48, Math.floor(opaquePixels * 0.025));
  const artworkWidth = bounds.maxX - bounds.minX + 1;
  const artworkHeight = bounds.maxY - bounds.minY + 1;

  components.forEach((component) => {
    if (component.length === largestComponent || component.length > smallComponentLimit) return;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    component.forEach((pixel) => {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });

    // TM and registered marks are tiny detached shapes in the lower half of
    // the artwork. Measure against the artwork, not the padded square canvas:
    // narrow logos and marks below the center otherwise evade the cleanup.
    const inLowerHalf = minY >= bounds.minY + artworkHeight * 0.5;
    const trademarkSized = maxX - minX + 1 <= artworkWidth * 0.15 && maxY - minY + 1 <= artworkHeight * 0.1;
    if (!inLowerHalf || !trademarkSized) return;

    // Include translucent edge pixels so the removed mark leaves no halo.
    component.forEach((pixel) => {
      data[pixel * 4 + 3] = 0;
    });
  });

  const cleanedBounds = artworkBounds(image);
  if (!cleanedBounds) return { x: 0, y: 0 };
  // Translate without rescaling or distorting the artwork. The remaining
  // visible pixels, rather than the original SVG viewport, determine its center.
  return {
    x: Math.round((width - 1 - cleanedBounds.minX - cleanedBounds.maxX) / 2),
    y: Math.round((height - 1 - cleanedBounds.minY - cleanedBounds.maxY) / 2),
  };
}
