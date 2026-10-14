/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El proyecto no necesita optimizaciones de imágenes de Next (las miniaturas
  // se cargan desde CDNs de terceros y se sirven por proxy opcional).
  images: { unoptimized: true },
};

export default nextConfig;
