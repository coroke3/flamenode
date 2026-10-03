import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDirectory = path.join(projectRoot, "public", "brand");
const markPath = path.join(brandDirectory, "flamenode-mark.svg");
const wordmarkPath = path.join(brandDirectory, "flamenode-wordmark.svg");

const palette = {
  background: "#10120f",
  foreground: "#e5e8da",
  accent: "#c8f21f",
};

function recolorSvg(source, color) {
  const css = `<style>path,polygon,rect,circle{fill:${color}!important}</style>`;
  return Buffer.from(source.toString("utf8").replace(/(<svg\b[^>]*>)/, `$1${css}`));
}

async function renderMark(markSvg, size, markRatio = 0.72, backgroundColor = null) {
  const mark = await sharp(markSvg)
    .resize({ height: Math.round(size * markRatio) })
    .png()
    .toBuffer();
  const metadata = await sharp(mark).metadata();

  const background = backgroundColor
    ? backgroundColor
    : { r: 0, g: 0, b: 0, alpha: 0 };

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([
      {
        input: mark,
        left: Math.round((size - (metadata.width ?? 0)) / 2),
        top: Math.round((size - (metadata.height ?? 0)) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const directory = Buffer.alloc(headerSize + entrySize * images.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach(({ size, data }, index) => {
    const entryOffset = headerSize + entrySize * index;
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(data.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += data.length;
  });

  return Buffer.concat([directory, ...images.map(({ data }) => data)]);
}

async function renderSocialCard(markSvg, wordmarkSvg) {
  const width = 1200;
  const height = 630;
  const foregroundMark = await sharp(recolorSvg(markSvg, palette.accent))
    .resize({ height: 236 })
    .png()
    .toBuffer();
  const foregroundWordmark = await sharp(recolorSvg(wordmarkSvg, palette.foreground))
    .resize({ width: 720 })
    .png()
    .toBuffer();
  const watermark = await sharp(recolorSvg(markSvg, palette.accent))
    .resize({ height: 560 })
    .ensureAlpha()
    .linear([1, 1, 1, 0.08], [0, 0, 0, 0])
    .png()
    .toBuffer();

  const markMetadata = await sharp(foregroundMark).metadata();
  const wordmarkMetadata = await sharp(foregroundWordmark).metadata();
  const watermarkMetadata = await sharp(watermark).metadata();
  const lockupWidth = (markMetadata.width ?? 0) + 62 + (wordmarkMetadata.width ?? 0);
  const lockupLeft = Math.round((width - lockupWidth) / 2);

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: palette.background,
    },
  })
    .composite([
      {
        input: watermark,
        left: width - Math.round((watermarkMetadata.width ?? 0) * 0.58),
        top: Math.round((height - (watermarkMetadata.height ?? 0)) / 2),
      },
      {
        input: foregroundMark,
        left: lockupLeft,
        top: Math.round((height - (markMetadata.height ?? 0)) / 2),
      },
      {
        input: foregroundWordmark,
        left: lockupLeft + (markMetadata.width ?? 0) + 62,
        top: Math.round((height - (wordmarkMetadata.height ?? 0)) / 2),
      },
      {
        input: Buffer.from(
          `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="614" width="1200" height="16" fill="${palette.accent}"/></svg>`,
        ),
        left: 0,
        top: 0,
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  await mkdir(brandDirectory, { recursive: true });
  const [markSource, wordmarkSource] = await Promise.all([
    readFile(markPath),
    readFile(wordmarkPath),
  ]);
  const accentMark = recolorSvg(markSource, palette.accent);

  // Favicon (透過背景・外枠なし・フラットなアクセントカラーの細い線マーク)
  const icon16 = await renderMark(accentMark, 16, 0.82, null);
  const icon32 = await renderMark(accentMark, 32, 0.78, null);
  const icon48 = await renderMark(accentMark, 48, 0.75, null);

  // Apple Touch Icon: 180x180 (iOSホーム画面用。外枠なし、ブランドダーク基調のフラット背景、中央にマーク)
  const appleTouchIcon = await renderMark(accentMark, 180, 0.62, palette.background);

  // PWA icons (192, 512 は透過背景でフラット、maskable はダーク背景に中央配置)
  const icon192 = await renderMark(accentMark, 192, 0.75, null);
  const icon512 = await renderMark(accentMark, 512, 0.75, null);
  const maskable512 = await renderMark(accentMark, 512, 0.56, palette.background);
  const socialCard = await renderSocialCard(markSource, wordmarkSource);

  // SVG ファビコン（外枠なし・ベクターでシャープな細い線のフラットマーク）
  const svgFavicon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 344.57 452.94">
  <style>
    path, polygon, rect, circle { fill: #c8f21f; }
  </style>
  <rect x="163.39" y="372.83" width="20.03" height="67.73" transform="translate(612.31 459.88) rotate(120)"/>
  <circle cx="121.37" cy="376.66" r="16.2"/>
  <circle cx="225.43" cy="436.74" r="16.2"/>
  <rect x="111.36" y="282.72" width="20.03" height="67.73"/>
  <circle cx="121.37" cy="256.51" r="16.2"/>
  <rect x="163.39" y="192.61" width="20.03" height="67.73" transform="translate(63.97 489.87) rotate(-120)"/>
  <circle cx="225.43" cy="196.43" r="16.2"/>
  <rect x="267.44" y="192.61" width="20.03" height="67.73" transform="translate(612.31 99.42) rotate(120)"/>
  <circle cx="329.48" cy="256.51" r="16.2"/>
  <rect x="319.47" y="282.72" width="20.03" height="67.73"/>
  <circle cx="329.48" cy="376.66" r="16.2"/>
  <rect x="215.41" y="342.8" width="20.03" height="67.73"/>
  <circle cx="225.43" cy="316.58" r="16.2"/>
  <rect x="267.44" y="372.83" width="20.03" height="67.73" transform="translate(63.97 850.33) rotate(-120)"/>
  <rect x="267.44" y="252.68" width="20.03" height="67.73" transform="translate(168.03 670.1) rotate(-120)"/>
  <rect x="163.39" y="252.68" width="20.03" height="67.73" transform="translate(508.25 279.65) rotate(120)"/>
  <rect x="59.33" y="192.61" width="20.03" height="67.73" transform="translate(300.14 279.65) rotate(120)"/>
  <circle cx="17.31" cy="196.43" r="16.2"/>
  <rect x="7.3" y="102.49" width="20.03" height="67.73"/>
  <circle cx="17.31" cy="76.28" r="16.2"/>
  <rect x="59.33" y="12.38" width="20.03" height="67.73" transform="translate(63.97 129.41) rotate(-120)"/>
  <circle cx="121.37" cy="16.2" r="16.2"/>
  <rect x="163.39" y="12.38" width="20.03" height="67.73" transform="translate(300.14 -80.81) rotate(120)"/>
  <circle cx="225.43" cy="76.28" r="16.2"/>
  <rect x="215.41" y="102.49" width="20.03" height="67.73"/>
  <rect x="111.36" y="162.57" width="20.03" height="67.73"/>
  <circle cx="121.37" cy="136.36" r="16.2"/>
  <rect x="163.39" y="72.45" width="20.03" height="67.73" transform="translate(168.02 309.64) rotate(-120)"/>
  <rect x="59.33" y="72.45" width="20.03" height="67.73" transform="translate(196.09 99.42) rotate(120)"/>
</svg>`;

  await Promise.all([
    writeFile(path.join(brandDirectory, "flamenode-icon-32.png"), icon32),
    writeFile(path.join(brandDirectory, "flamenode-apple-touch-icon.png"), appleTouchIcon),
    writeFile(path.join(brandDirectory, "flamenode-icon-192.png"), icon192),
    writeFile(path.join(brandDirectory, "flamenode-icon-512.png"), icon512),
    writeFile(path.join(brandDirectory, "flamenode-icon-maskable-512.png"), maskable512),
    writeFile(path.join(brandDirectory, "flamenode-social-card.png"), socialCard),
    writeFile(path.join(brandDirectory, "flamenode-favicon.svg"), svgFavicon),
    writeFile(
      path.join(projectRoot, "public", "favicon.ico"),
      buildIco([
        { size: 16, data: icon16 },
        { size: 32, data: icon32 },
        { size: 48, data: icon48 },
      ]),
    ),
  ]);
}

await main();
