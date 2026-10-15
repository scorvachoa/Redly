/**
 * Extrae los iconos que usa Red.ly desde react-icons/fa6 y genera
 * components/icons.tsx con SVG propios (sin dependencia en tiempo de build).
 */
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { join } = require("path");

const WANTED = [
  // Marcas (PlatformIcon)
  "FaTiktok",
  "FaYoutube",
  "FaFacebookF",
  "FaInstagram",
  "FaXTwitter",
  "FaThreads",
  // Genéricos (features y pasos de la portada)
  "FaBolt",
  "FaFolderOpen",
  "FaLayerGroup",
  "FaLink",
  "FaListUl",
  "FaLock",
  "FaRotateRight",
  "FaShieldHalved",
  // Descargador: estado, modos y acciones
  "FaCircleCheck",
  "FaCircleInfo",
  "FaTriangleExclamation",
  "FaVideo",
  "FaDownload",
  "FaFolderTree",
];

const root = process.argv[2] ?? ".";
const iconSource = join(root, "node_modules/react-icons/fa6/index.mjs");
if (!existsSync(iconSource)) {
  console.error(
    `No se encuentra ${iconSource}\n` +
      "react-icons sólo hace falta para regenerar (se quitó del build a propósito):\n" +
      "  npm i -D react-icons   y, al terminar,   npm rm -D react-icons",
  );
  process.exit(1);
}
const src = readFileSync(iconSource, "utf8");

/** Atributo JSX: las claves con guion van en camelCase (fill-rule -> fillRule). */
function jsxAttr(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Convierte el árbol de GenIcon a JSX. */
function toJsx(node, indent) {
  const pad = " ".repeat(indent);
  const attrs = Object.entries(node.attr || {})
    .map(([k, v]) => `\n${pad}  ${jsxAttr(k)}=${JSON.stringify(String(v))}`)
    .join("");
  const kids = node.child || [];
  if (kids.length === 0) return `${pad}<${node.tag}${attrs} />`;
  const inner = kids.map((k) => toJsx(k, indent + 4)).join("\n");
  return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
}

const found = [];
for (const name of WANTED) {
  const start = src.indexOf(`export function ${name} `);
  if (start < 0) throw new Error(`No encontrado: ${name}`);
  const open = src.indexOf("GenIcon(", start) + "GenIcon(".length;
  // La definición es GenIcon({...json...})(props);
  let depth = 0;
  let end = open;
  for (; end < src.length; end += 1) {
    const ch = src[end];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  const data = JSON.parse(src.slice(open, end));
  found.push({ name, data });
}

// Comprobación de atributos que JSX no admite tal cual.
for (const { name, data } of found) {
  const walk = (n) => {
    for (const k of Object.keys(n.attr || {})) {
      if (k.includes("-")) throw new Error(`${name}: atributo con guion "${k}"`);
    }
    (n.child || []).forEach(walk);
  };
  walk(data);
}

const components = found
  .map(({ name, data }) => {
    const fn = name.replace(/^Fa/, "");
    const body = data.child
      .map((c) => toJsx(c, 6))
      .join("\n");
    return `export function ${fn}({ size = "1em", ...props }: IconProps) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox=${JSON.stringify(data.attr.viewBox)}
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
${body}
    </svg>
  );
}`;
  })
  .join("\n\n");

const out = `/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Iconos incrustados (paths de Font Awesome 6, licencia CC BY 4.0).
 * Se generaron desde react-icons/fa6 para no arrastrar su barril de
 * exports al build: Next genera un chunk de proveedor que a veces no
 * emite y la página fallaba con "Cannot find module vendor-chunks/react-icons".
 * Regenerar: node scripts/extract-icons.cjs
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

${components}
`;

writeFileSync(join(root, "components/icons.tsx"), out, "utf8");
console.log(`Generados ${found.length} iconos -> components/icons.tsx`);
console.log(found.map((f) => f.name.replace(/^Fa/, "")).join(", "));
