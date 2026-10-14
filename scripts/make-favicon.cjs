/**
 * Genera todos los iconos derivados de `app/icon.svg`:
 *
 *   app/apple-icon.png        180x180, opaco (iOS aplica su propia máscara)
 *   app/favicon.ico           16 + 32 + 48, con transparencia
 *   public/icons/icon-192.png 192x192, transparente (manifest)
 *   public/icons/icon-512.png 512x512, transparente (manifest)
 *   public/icons/maskable-512.png  512x512, opaco, zona segura (Android)
 *
 * El SVG es la fuente de verdad: si cambia el diseño, editar ese archivo y
 * volver a lanzar el script. Usa `sharp`, que Next.js ya trae en
 * `node_modules` como dependencia de optimización de imágenes, así que no
 * hace falta declararla en `package.json`.
 *
 *   node scripts/make-favicon.cjs
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const APP_DIR = path.join(__dirname, "..", "app");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ICONS_DIR = path.join(PUBLIC_DIR, "icons");
const SVG = fs.readFileSync(path.join(APP_DIR, "icon.svg"));

/** Fondo del icono de Apple: el `--surface` del tema oscuro (#17171c). */
const APPLE_BG = { r: 0x17, g: 0x17, b: 0x1c };
const ICO_SIZES = [16, 32, 48];
const MANIFEST_SIZES = [192, 512];

/**
 * Zona segura para iconos maskables: Android recorta el icono en un círculo
 * del 80 % del lienzo. El contenido debe caber dentro, así que se escala al
 * 66 % y se centra sobre un fondo opaco.
 */
const MASKABLE_FILL = 0.66;

/**
 * Rasteriza el SVG con holgura y luego reduce al tamaño pedido, para que los
 * bordes queden nítidos en vez de interpolados.
 */
function rasterize(size) {
  return sharp(SVG, { density: 600 }).resize(size, size, { fit: "fill" });
}

/** Contenedor ICO con PNGs incrustados (válido desde Vista). */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: icono
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  pngs.forEach((png, i) => {
    const size = ICO_SIZES[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // ancho
    entry.writeUInt8(size === 256 ? 0 : size, 1); // alto
    entry.writeUInt8(0, 2); // paleta
    entry.writeUInt8(0, 3); // reservado
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por píxel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  });

  return Buffer.concat([header, ...entries, ...pngs]);
}

async function write(file, buffer, note) {
  fs.writeFileSync(file, buffer);
  console.log(path.relative(process.cwd(), file).padEnd(30) + buffer.length + " bytes  " + note);
}

async function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  // Apple: iOS exige un icono opaco, así que la transparencia del SVG se
  // sustituye por el fondo del tema oscuro.
  const apple = await rasterize(180).flatten({ background: APPLE_BG }).png().toBuffer();
  await write(path.join(APP_DIR, "apple-icon.png"), apple, "(180x180, opaco)");

  // favicon.ico: transparencia intacta, legible sobre pestaña clara u oscura.
  const pngs = [];
  for (const size of ICO_SIZES) {
    pngs.push(await rasterize(size).png().toBuffer());
  }
  const ico = buildIco(pngs);
  await write(path.join(APP_DIR, "favicon.ico"), ico, "(16+32+48)");

  // Iconos del manifiesto PWA: transparencia, se usan sobre cualquier fondo.
  for (const size of MANIFEST_SIZES) {
    const png = await rasterize(size).png().toBuffer();
    await write(path.join(ICONS_DIR, `icon-${size}.png`), png, `(${size}x${size})`);
  }

  // Maskable: fondo opaco + contenido dentro de la zona segura del 80 %.
  const maskableSize = 512;
  const inner = Math.round(maskableSize * MASKABLE_FILL);
  const offset = Math.round((maskableSize - inner) / 2);
  const flame = await rasterize(inner).png().toBuffer();
  const maskable = await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: APPLE_BG,
    },
  })
    .composite([{ input: flame, left: offset, top: offset }])
    .png()
    .toBuffer();
  await write(path.join(ICONS_DIR, "maskable-512.png"), maskable, "(512x512, maskable)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
