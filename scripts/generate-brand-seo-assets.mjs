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

async function renderMark(markSvg, size, markRatio = 0.72) {
  const mark = await sharp(markSvg)
    .resize({ height: Math.round(size * markRatio) })
    .png()
    .toBuffer();
  const metadata = await sharp(mark).metadata();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: palette.accent,
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
  const darkMark = recolorSvg(markSource, palette.background);

  const outputs = await Promise.all([
    renderMark(darkMark, 32),
    renderMark(darkMark, 180),
    renderMark(darkMark, 192),
    renderMark(darkMark, 512),
    renderMark(darkMark, 512, 0.58),
    renderSocialCard(markSource, wordmarkSource),
  ]);

  const [icon32, appleTouchIcon, icon192, icon512, maskable512, socialCard] = outputs;
  await Promise.all([
    writeFile(path.join(brandDirectory, "flamenode-icon-32.png"), icon32),
    writeFile(path.join(brandDirectory, "flamenode-apple-touch-icon.png"), appleTouchIcon),
    writeFile(path.join(brandDirectory, "flamenode-icon-192.png"), icon192),
    writeFile(path.join(brandDirectory, "flamenode-icon-512.png"), icon512),
    writeFile(path.join(brandDirectory, "flamenode-icon-maskable-512.png"), maskable512),
    writeFile(path.join(brandDirectory, "flamenode-social-card.png"), socialCard),
    writeFile(
      path.join(projectRoot, "public", "favicon.ico"),
      buildIco([
        { size: 16, data: await renderMark(darkMark, 16, 0.76) },
        { size: 32, data: icon32 },
        { size: 48, data: await renderMark(darkMark, 48, 0.72) },
      ]),
    ),
  ]);
}

await main();
